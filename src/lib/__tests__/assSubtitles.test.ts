import { describe, expect, it } from 'vitest'
import {
  ASS_STREAM_FORMAT,
  FALLBACK_FONT_LIST_PATH,
  MAX_FALLBACK_FONTS,
  assRenderTimeOffset,
  assStreamPath,
  assTrackFor,
  canRenderAss,
  fallbackFontPath,
  isAssCodec,
  pickFallbackFonts,
  scaleAssFontSizes,
} from '../assSubtitles'
import type { SubtitleTrack } from '../playback'

const track = (over: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  index: 2,
  label: 'English',
  isDefault: false,
  codec: 'ass',
  url: 'http://s/Videos/i/m/Subtitles/2/0/Stream.vtt',
  assUrl: 'http://s/Videos/i/m/Subtitles/2/0/Stream.ass',
  ...over,
})

/*
  The counted codecs of one real library: ass 179, subrip 554, pgssub 1356,
  dvdsub 3. Only the first of those has typesetting a WebVTT track cannot
  express, and only the first is worth a megabyte of WebAssembly.
*/
describe('isAssCodec', () => {
  it('claims ASS and its older SSA spelling', () => {
    expect(isAssCodec('ass')).toBe(true)
    expect(isAssCodec('ssa')).toBe(true)
  })

  it('leaves SubRip alone, which <track> already renders correctly', () => {
    expect(isAssCodec('subrip')).toBe(false)
    expect(isAssCodec('srt')).toBe(false)
    expect(isAssCodec('webvtt')).toBe(false)
  })

  it('leaves the image formats alone, which the server burns in', () => {
    expect(isAssCodec('pgssub')).toBe(false)
    expect(isAssCodec('dvdsub')).toBe(false)
  })

  it('is not fooled by case or the padding a server may send', () => {
    expect(isAssCodec('ASS')).toBe(true)
    expect(isAssCodec(' Ssa ')).toBe(true)
  })

  it('answers no rather than throwing when the stream names no codec', () => {
    expect(isAssCodec(undefined)).toBe(false)
    expect(isAssCodec(null)).toBe(false)
    expect(isAssCodec('')).toBe(false)
  })
})

describe('assStreamPath', () => {
  it('asks for the raw file, header and all', () => {
    // Stream.vtt is the converted copy with the header thrown away; .ass is
    // the file itself, which is the only thing libass can lay out.
    expect(assStreamPath('item-1', 'src-1', 3)).toBe(
      `/Videos/item-1/src-1/Subtitles/3/0/Stream.${ASS_STREAM_FORMAT}`,
    )
  })

  it('starts at tick zero, so the file covers the whole timeline', () => {
    expect(assStreamPath('i', 'm', 0)).toContain('/Subtitles/0/0/Stream.')
  })

  it('escapes ids rather than letting them shape the path', () => {
    expect(assStreamPath('a/b', 'c d', 1)).toBe('/Videos/a%2Fb/c%20d/Subtitles/1/0/Stream.ass')
  })
})

describe('fallbackFontPath', () => {
  it('names a font under the list it came from', () => {
    expect(FALLBACK_FONT_LIST_PATH).toBe('/FallbackFont/Fonts')
    expect(fallbackFontPath('NotoSansJP-Regular.ttf')).toBe(
      '/FallbackFont/Fonts/NotoSansJP-Regular.ttf',
    )
  })

  it('escapes a name with a space in it', () => {
    expect(fallbackFontPath('Noto Sans.ttf')).toBe('/FallbackFont/Fonts/Noto%20Sans.ttf')
  })
})

/*
  Every font in this list is fetched before the first subtitle is drawn, and a
  server whose fallback folder holds the whole Noto family would spend the
  opening scene downloading it.
*/
describe('pickFallbackFonts', () => {
  it('keeps the font files and drops anything else in the folder', () => {
    const names = pickFallbackFonts([
      { Name: 'NotoSansJP-Regular.ttf' },
      { Name: 'readme.txt' },
      { Name: 'Roboto.otf' },
      { Name: 'Subset.woff2' },
      { Name: 'Legacy.woff' },
      { Name: 'Collection.ttc' },
    ])
    expect(names).toEqual([
      'NotoSansJP-Regular.ttf',
      'Roboto.otf',
      'Subset.woff2',
      'Legacy.woff',
      'Collection.ttc',
    ])
  })

  it('caps the list, because every one of them is a request', () => {
    const many = Array.from({ length: MAX_FALLBACK_FONTS + 20 }, (_, i) => ({
      Name: `Font${i}.ttf`,
    }))
    expect(pickFallbackFonts(many)).toHaveLength(MAX_FALLBACK_FONTS)
  })

  it('survives a server that has no fallback fonts configured', () => {
    // The commonest case by far: the setting is opt-in and most servers never
    // touch it. libass still has its own bundled default to fall back on.
    expect(pickFallbackFonts([])).toEqual([])
    expect(pickFallbackFonts(null)).toEqual([])
    expect(pickFallbackFonts(undefined)).toEqual([])
    expect(pickFallbackFonts([{ Name: null }, {}])).toEqual([])
  })
})

/*
  libass is asked to draw one number: where in the subtitle file we are. Two
  separate corrections land on it, and they are in different units and point in
  different directions.
*/
describe('assRenderTimeOffset', () => {
  it('is zero when nothing needs correcting', () => {
    expect(assRenderTimeOffset({ streamStartOffsetSeconds: 0, subtitleOffsetMs: 0 })).toBe(0)
  })

  it('subtracts a delay, because the renderer is told a time, not a shift', () => {
    // The <track> path adds the delay to every cue's start. libass is handed
    // the moment to draw instead, so asking for subtitles a second later means
    // drawing what was showing a second ago.
    expect(assRenderTimeOffset({ subtitleOffsetMs: 1000 })).toBe(-1)
    expect(assRenderTimeOffset({ subtitleOffsetMs: -400 })).toBe(0.4)
  })

  it('adds back what a transcode cut off the front', () => {
    /*
      A non-HLS transcode is cut to start at the resume point, so the video
      element's clock restarts at zero while the subtitle file still runs on
      the episode's own timeline. Without this the subtitles are as far out as
      the viewer was into the episode.
    */
    expect(assRenderTimeOffset({ streamStartOffsetSeconds: 600 })).toBe(600)
  })

  it('applies both at once', () => {
    expect(
      assRenderTimeOffset({ streamStartOffsetSeconds: 600, subtitleOffsetMs: 500 }),
    ).toBe(599.5)
  })

  it('works in whole milliseconds, so a reset lands back on zero', () => {
    // 0.1 + 0.2 arithmetic on a number that goes straight into a renderer.
    expect(assRenderTimeOffset({ subtitleOffsetMs: 300 })).toBe(-0.3)
    expect(assRenderTimeOffset({ streamStartOffsetSeconds: 12.3, subtitleOffsetMs: 100 })).toBe(12.2)
  })

  it('treats missing corrections as none', () => {
    expect(assRenderTimeOffset({})).toBe(0)
    expect(
      assRenderTimeOffset({ streamStartOffsetSeconds: NaN, subtitleOffsetMs: NaN }),
    ).toBe(0)
  })
})

/*
  The single most important rule of this feature: a viewer never ends up with
  no subtitles because the fancy renderer could not start. Every one of these
  answers "no" and leaves the <track> element showing.
*/
describe('canRenderAss', () => {
  const able = {
    worker: true,
    wasm: true,
    offscreenCanvas: true,
    transferControlToOffscreen: true,
  }

  it('says yes when the browser has all four pieces', () => {
    expect(canRenderAss(able)).toBe(true)
  })

  it('says no without Workers, which is where libass runs', () => {
    expect(canRenderAss({ ...able, worker: false })).toBe(false)
  })

  it('says no without WebAssembly, which is what libass is', () => {
    expect(canRenderAss({ ...able, wasm: false })).toBe(false)
  })

  it('says no without OffscreenCanvas, which is how the worker draws', () => {
    expect(canRenderAss({ ...able, offscreenCanvas: false })).toBe(false)
    expect(canRenderAss({ ...able, transferControlToOffscreen: false })).toBe(false)
  })
})

describe('assTrackFor', () => {
  const base = {
    subtitles: [track()],
    textTrackIndex: 2,
    burnedSubIndex: undefined,
    supported: true,
  }

  it('picks the showing track when it is ASS and the browser can draw it', () => {
    expect(assTrackFor(base)?.index).toBe(2)
  })

  it('declines when subtitles are off', () => {
    expect(assTrackFor({ ...base, textTrackIndex: null })).toBeNull()
  })

  it('declines for SubRip, which <track> already gets right', () => {
    const subs = [track({ codec: 'subrip', assUrl: undefined })]
    expect(assTrackFor({ ...base, subtitles: subs })).toBeNull()
  })

  it('declines while the server is burning a picture track in', () => {
    // Those frames already have the subtitles painted on; a second copy over
    // the top would be two sets of words at once.
    expect(assTrackFor({ ...base, burnedSubIndex: 5 })).toBeNull()
  })

  it('declines when the browser is missing a piece', () => {
    expect(assTrackFor({ ...base, supported: false })).toBeNull()
  })

  it('declines when the chosen index names no track', () => {
    expect(assTrackFor({ ...base, textTrackIndex: 99 })).toBeNull()
  })

  it('declines an ASS stream the server would not hand over raw', () => {
    const subs = [track({ assUrl: undefined })]
    expect(assTrackFor({ ...base, subtitles: subs })).toBeNull()
  })
})

const SAMPLE = `[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,48,&H00FFFFFF,0,0,10,10,20,1
Style: Sign,Times New Roman,30.5,&H00FFFFFF,0,0,10,10,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello there
Dialogue: 0,0:00:04.00,0:00:06.00,Sign,,0,0,0,,{\\fad(200,1)\\fs72\\pos(688,214)}Fifth Epoch
`

/*
  What "subtitle size" can honestly mean once libass is drawing.

  ASS carries its own sizes, in the script's own coordinate space, and the
  positions in \pos are in that same space — so the coordinates cannot be
  touched without moving every sign off the thing it is labelling. Multiplying
  the sizes and leaving the geometry alone is the one change that means
  "bigger text" and nothing else.
*/
describe('scaleAssFontSizes', () => {
  it('hands the file back untouched at 100%', () => {
    // Identity, so nothing reloads the track when the setting is the default.
    expect(scaleAssFontSizes(SAMPLE, 100)).toBe(SAMPLE)
  })

  it('hands back the exact bytes at 100%, not a re-rendering of them', () => {
    /*
      Multiplying by one is not the same as leaving the file alone: a size
      written 20.0 comes back 20, and a file the default setting quietly
      rewrites is a file whose author's formatting Apollo does not respect.
      The short circuit is what makes the common case genuinely a no-op.
    */
    const decimals = `[V4+ Styles]
Format: Name, Fontname, Fontsize, Encoding
Style: Default,Arial,20.0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\fs20.0}Hi
`
    expect(scaleAssFontSizes(decimals, 100)).toBe(decimals)
  })

  it('scales the size in each style', () => {
    const out = scaleAssFontSizes(SAMPLE, 150)
    expect(out).toContain('Style: Default,Arial,72,')
    expect(out).toContain('Style: Sign,Times New Roman,45.75,')
  })

  it('scales the \\fs overrides too, which outnumber the styles', () => {
    // 1386 \fs tags against 505 italic/bold ones in one measured library —
    // scaling only the styles would leave most of the typesetting untouched.
    expect(scaleAssFontSizes(SAMPLE, 150)).toContain('\\fs108\\pos(688,214)')
  })

  it('leaves the tags that only start like \\fs alone', () => {
    // \fsp is letter spacing and \fscx a horizontal scale percentage; both
    // would be nonsense multiplied by a font size.
    const line = 'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\fsp4\\fscx120\\fs20}Hi'
    const out = scaleAssFontSizes(`[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${line}\n`, 200)
    expect(out).toContain('{\\fsp4\\fscx120\\fs40}Hi')
  })

  it('leaves the geometry exactly where the typesetter put it', () => {
    const out = scaleAssFontSizes(SAMPLE, 200)
    expect(out).toContain('PlayResX: 1280')
    expect(out).toContain('PlayResY: 720')
    expect(out).toContain('\\pos(688,214)')
  })

  it('reads the Fontsize column off the Format line rather than counting to three', () => {
    // The column order is per-file, and an SSA file written by another tool
    // may not put Fontsize where a V4+ file does.
    const odd = `[V4+ Styles]
Format: Name, Fontsize, Fontname, Encoding
Style: Default,48,Arial,1
`
    expect(scaleAssFontSizes(odd, 200)).toContain('Style: Default,96,Arial,1')
  })

  it('leaves a styles section whose Format line names no Fontsize alone', () => {
    const odd = `[V4+ Styles]
Format: Name, Fontname, Encoding
Style: Default,Arial,1
`
    expect(scaleAssFontSizes(odd, 200)).toBe(odd)
  })

  it('keeps the line endings the file arrived with', () => {
    // libass copes either way, but a file that comes back with its CRLFs
    // rewritten is a diff nobody asked for and a hint the parse is lossy.
    const crlf = SAMPLE.replace(/\n/g, '\r\n')
    const out = scaleAssFontSizes(crlf, 150)
    expect(out).toContain('\r\n')
    expect(out).toContain('Style: Default,Arial,72,')
  })

  it('keeps the carriage return on a line whose last column is the one rewritten', () => {
    /*
      The column order is per-file, and when Fontsize is last the CR sits on
      the very field being replaced. Anything that reads the line without
      taking the CR off first writes the new size over it and hands libass a
      file that is CRLF everywhere except the lines it touched.
    */
    const crlf = '[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize\r\nStyle: Default,Arial,20\r\n'
    expect(scaleAssFontSizes(crlf, 200)).toBe(
      '[V4+ Styles]\r\nFormat: Name, Fontname, Fontsize\r\nStyle: Default,Arial,40\r\n',
    )
  })

  it('rounds to something an ASS parser will read back', () => {
    // 48 × 1.3 is 62.400000000000006 in this arithmetic, and that string in a
    // Fontsize field is at best noise and at worst unparsed.
    const odd = `[V4+ Styles]
Format: Name, Fontname, Fontsize, Encoding
Style: Default,Arial,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\fs48}Hi
`
    const out = scaleAssFontSizes(odd, 130)
    expect(out).toContain('Style: Default,Arial,62.4,1')
    expect(out).toContain('{\\fs62.4}Hi')
  })

  it('clamps a stored size the same way the controls do', () => {
    // Both the Settings slider and the player menu clamp; a value that got
    // past them must not reach libass as a 40x font.
    expect(scaleAssFontSizes(SAMPLE, 9999)).toContain('Style: Default,Arial,144,')
    expect(scaleAssFontSizes(SAMPLE, 0)).toContain('Style: Default,Arial,24,')
  })

  it('does not touch a Fontsize-looking field outside the styles section', () => {
    const out = scaleAssFontSizes(SAMPLE, 200)
    expect(out).toContain('Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Hello there')
  })
})
