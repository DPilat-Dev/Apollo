import { describe, expect, it } from 'vitest'
import type { SubtitleTrack } from '../playback'
import {
  EXTRACTION_BUDGET_SECONDS,
  EXTRACTION_SECONDS_PER_GB,
  browserCanRenderPgs,
  canRenderPgs,
  extractionSeconds,
  pgsDelivery,
  subtitleNeedsBurnIn,
  isPgsCodec,
  PGS_STREAM_FORMAT,
  PGS_SUBTITLE_PROFILE,
  pgsAspectMode,
  pgsRenderTimeOffset,
  pgsStreamPath,
  pgsTrackFor,
} from '../pgsSubtitles'

const track = (over: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  index: 3,
  label: 'English (PGS)',
  codec: 'pgssub',
  isDefault: false,
  isForced: false,
  pgsUrl: 'https://server/Videos/i/s/Subtitles/3/0/Stream.pgssub',
  ...over,
})

describe('isPgsCodec', () => {
  it('accepts what Jellyfin calls it', () => {
    expect(isPgsCodec('pgssub')).toBe(true)
  })

  it('accepts the names a remux might leave behind', () => {
    // The same stream turns up under ffmpeg's naming when a file has been
    // through another tool.
    expect(isPgsCodec('PGS')).toBe(true)
    expect(isPgsCodec('hdmv_pgs_subtitle')).toBe(true)
    expect(isPgsCodec('  pgssub  ')).toBe(true)
  })

  it('rejects the other picture format, which libpgs cannot read', () => {
    // VOBSUB is a different bitmap format; it still has to be burned in, and
    // claiming it here would leave a viewer with no subtitles at all.
    expect(isPgsCodec('dvdsub')).toBe(false)
    expect(isPgsCodec('vobsub')).toBe(false)
  })

  it('rejects text formats and nothing', () => {
    for (const c of ['ass', 'subrip', 'vtt', '', null, undefined]) {
      expect(isPgsCodec(c)).toBe(false)
    }
  })
})

describe('PGS_SUBTITLE_PROFILE', () => {
  it('declares the format the renderer actually reads', () => {
    // The profile and the renderer must agree. Promising the server a format
    // nothing here can draw removes the burn-in without replacing it.
    expect(PGS_SUBTITLE_PROFILE.Format).toBe(PGS_STREAM_FORMAT)
    expect(isPgsCodec(PGS_SUBTITLE_PROFILE.Format)).toBe(true)
  })

  it('asks for the file rather than an encode', () => {
    expect(PGS_SUBTITLE_PROFILE.Method).toBe('External')
  })
})

describe('pgsStreamPath', () => {
  it('addresses the stream from tick zero, so it covers the episode', () => {
    expect(pgsStreamPath('item', 'source', 3)).toBe(
      '/Videos/item/source/Subtitles/3/0/Stream.pgssub',
    )
  })

  it('escapes ids rather than interpolating them', () => {
    // They come from the server, and a path segment is not the place to find
    // out one of them contained a slash.
    expect(pgsStreamPath('a/b', 'c d', 1)).toBe('/Videos/a%2Fb/c%20d/Subtitles/1/0/Stream.pgssub')
  })
})

describe('canRenderPgs', () => {
  it('needs a canvas and a worker', () => {
    expect(canRenderPgs({ canvas: true, worker: true })).toBe(true)
    expect(canRenderPgs({ canvas: false, worker: true })).toBe(false)
    expect(canRenderPgs({ canvas: true, worker: false })).toBe(false)
  })

  it('is a lower bar than libass, which needs WebAssembly and OffscreenCanvas', () => {
    // Nothing here mentions either: libpgs decodes on the main thread when it
    // has to, so the only browsers excluded cannot play video anyway.
    expect(Object.keys({ canvas: true, worker: true })).toEqual(['canvas', 'worker'])
  })

  it('says no where there is no window at all', () => {
    expect(browserCanRenderPgs()).toBe(false)
  })
})

describe('pgsTrackFor', () => {
  it('picks the chosen PGS track', () => {
    expect(
      pgsTrackFor({ subtitles: [track()], textTrackIndex: 3, burnedSubIndex: undefined, supported: true })?.index,
    ).toBe(3)
  })

  it('leaves it alone when the browser cannot draw it', () => {
    expect(
      pgsTrackFor({ subtitles: [track()], textTrackIndex: 3, burnedSubIndex: undefined, supported: false }),
    ).toBeNull()
  })

  it('stands aside once the server has burned something in', () => {
    // Those frames already carry the subtitles; a second copy over the top is
    // two sets of words rather than an improvement.
    expect(
      pgsTrackFor({ subtitles: [track()], textTrackIndex: 3, burnedSubIndex: 3, supported: true }),
    ).toBeNull()
  })

  it('does nothing with no track chosen', () => {
    expect(
      pgsTrackFor({ subtitles: [track()], textTrackIndex: null, burnedSubIndex: undefined, supported: true }),
    ).toBeNull()
  })

  it('refuses a PGS track the server would not hand over', () => {
    // No pgsUrl means the stream is not available as a file, and the burn-in
    // path is the only one left.
    expect(
      pgsTrackFor({
        subtitles: [track({ pgsUrl: undefined })],
        textTrackIndex: 3,
        burnedSubIndex: undefined,
        supported: true,
      }),
    ).toBeNull()
  })

  it('refuses a track that is not PGS even if it somehow has a url', () => {
    expect(
      pgsTrackFor({
        subtitles: [track({ codec: 'dvdsub' })],
        textTrackIndex: 3,
        burnedSubIndex: undefined,
        supported: true,
      }),
    ).toBeNull()
  })

  it('index zero is a real track', () => {
    expect(
      pgsTrackFor({
        subtitles: [track({ index: 0 })],
        textTrackIndex: 0,
        burnedSubIndex: undefined,
        supported: true,
      })?.index,
    ).toBe(0)
  })
})

describe('pgsAspectMode', () => {
  it('matches the canvas to how the video is fitted', () => {
    // libpgs positions each bitmap inside the frame, so a mismatch sends every
    // sign somewhere else. This is what libass cannot be told.
    expect(pgsAspectMode('fit')).toBe('contain')
    expect(pgsAspectMode('fill')).toBe('cover')
    expect(pgsAspectMode('stretch')).toBe('fill')
  })

  it('falls back to the player’s own default', () => {
    expect(pgsAspectMode('')).toBe('contain')
    expect(pgsAspectMode('something-new')).toBe('contain')
  })
})

describe('pgsRenderTimeOffset', () => {
  it('asks for an earlier moment when subtitles should come later', () => {
    // libpgs renders at `currentTime + offset`, the same question libass is
    // asked — so wanting them a second later means asking what was showing a
    // second ago.
    expect(pgsRenderTimeOffset({ subtitleOffsetMs: 1000 })).toBe(-1)
  })

  it('adds back what a transcode cut off the front', () => {
    expect(pgsRenderTimeOffset({ streamStartOffsetSeconds: 600 })).toBe(600)
  })

  it('is zero when nothing applies', () => {
    expect(pgsRenderTimeOffset({})).toBe(0)
  })
})

describe('where a PGS track gets rendered', () => {
  const GB = 1e9

  it('estimates the extraction from the container, not the codec', () => {
    /*
      Measured against 10.11.8 across all three formats: a 0.37 GB SubRip took
      4.3 s, a 1.47 GB ASS took 12.6 s, a 5.74 GB PGS took 48.8 s. The rate is
      the same to within a few percent every time, because what the server is
      doing is reading the whole container.
    */
    expect(extractionSeconds(1 * GB)).toBeCloseTo(EXTRACTION_SECONDS_PER_GB, 5)
    expect(extractionSeconds(5.74 * GB)).toBeCloseTo(49.4, 0)
    expect(extractionSeconds(30.8 * GB)).toBeCloseTo(265, 0)
  })

  it('says nothing when the size is not known', () => {
    for (const bad of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(extractionSeconds(bad)).toBeNull()
    }
  })

  it('draws an episode here and burns a remux in', () => {
    // The files these numbers came from: a 1 GB episode, and the 30.8 GB
    // Imitation Game remux that took four and a half minutes to extract.
    expect(pgsDelivery(1.03 * GB)).toBe('render')
    expect(pgsDelivery(30.8 * GB)).toBe('burn-in')
    expect(pgsDelivery(73.9 * GB)).toBe('burn-in')
  })

  it('puts the line where thirty seconds of extraction falls', () => {
    const edge = (EXTRACTION_BUDGET_SECONDS / EXTRACTION_SECONDS_PER_GB) * GB
    expect(pgsDelivery(edge * 0.99)).toBe('render')
    expect(pgsDelivery(edge * 1.01)).toBe('burn-in')
  })

  it('draws it here when the size is missing, rather than imposing a re-encode', () => {
    // The old behaviour, and the safer guess: burning in costs a transcode and
    // a reload, which is a worse thing to do on the strength of a missing field
    // than a wait the renderer now sits through gracefully.
    expect(pgsDelivery(undefined)).toBe('render')
    expect(pgsDelivery(0)).toBe('render')
  })
})

describe('subtitleNeedsBurnIn', () => {
  const track = (over: Partial<SubtitleTrack>): SubtitleTrack =>
    ({ index: 2, label: 'English', isDefault: false, isForced: false, ...over }) as SubtitleTrack
  const GB = 1e9

  it('never burns in something already converted to WebVTT', () => {
    // Size is irrelevant here: the conversion is small and already made.
    expect(subtitleNeedsBurnIn(track({ url: '/x.vtt' }), 73.9 * GB)).toBe(false)
  })

  it('always burns in a picture format it cannot draw', () => {
    // VOBSUB: no url, no pgsUrl. Nothing here can render it at any size.
    expect(subtitleNeedsBurnIn(track({ codec: 'DVDSUB' }), 0.5 * GB)).toBe(true)
  })

  it('decides a PGS track on the size of its file', () => {
    const pgs = (size: number) =>
      subtitleNeedsBurnIn(track({ codec: 'PGSSUB', pgsUrl: '/x.sup' }), size)
    expect(pgs(1.03 * GB)).toBe(false)
    expect(pgs(30.8 * GB)).toBe(true)
  })

  it('answers for nothing at all without throwing', () => {
    expect(subtitleNeedsBurnIn(null, 1 * GB)).toBe(false)
    expect(subtitleNeedsBurnIn(undefined, 1 * GB)).toBe(false)
  })
})
