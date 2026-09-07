import { describe, expect, it } from 'vitest'
import type { SubtitleTrack } from '../playback'
import {
  browserCanRenderPgs,
  canRenderPgs,
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
