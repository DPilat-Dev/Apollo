import { clampSubtitleSize } from './settings'
import type { SubtitleTrack } from './playback'

/**
 * Deciding when to hand a subtitle track to libass, and what to hand it.
 *
 * Jellyfin converts ASS/SSA to WebVTT for the `<track>` element, and WebVTT
 * has nowhere to put most of what an ASS file says. `subtitleText` salvages
 * what it can — italics, bold, `\an` alignment — but measured across eight
 * files of one real library, 25,983 lines with 2,314 carrying override tags,
 * roughly 420 of those lines use effects WebVTT cannot express at any price:
 *
 *   \fs font size        1386      outline / \bord   147
 *   \fad \blur            391      \fn font name      76
 *   \pos absolute place   146      \c colour          67
 *   rotate / scale         27      \move animation     2
 *
 * `\pos` is the one that matters most and the one that could never be fixed
 * client-side: its coordinates are in the script's own space, and the WebVTT
 * the server hands over has dropped the header that declares it. The files in
 * that library alone range from 1280x720 to 3840x2160, so there is no
 * resolution to assume. A sign typeset onto a shop front lands wherever the
 * dialogue goes instead.
 *
 * libass reads the file itself, header included, and draws it. Everything in
 * here is the arithmetic and the decisions around that; the renderer glue,
 * which is a worker and a canvas and cannot be exercised without a browser,
 * lives in `assRenderer.ts` and `useAssSubtitles.ts`.
 */

/** The extension the server exposes the untouched file under. */
export const ASS_STREAM_FORMAT = 'ass'

/*
  SSA is ASS's predecessor and libass reads both. Nothing else belongs here:
  SubRip has no typesetting to lose, and the picture formats (pgssub, dvdsub —
  1,359 of the 2,092 subtitle streams in that library) are burned into the
  frames by the server before they are sent.
*/
const ASS_CODECS = new Set(['ass', 'ssa'])

export function isAssCodec(codec: string | null | undefined): boolean {
  return ASS_CODECS.has((codec ?? '').trim().toLowerCase())
}

/**
 * The raw file, at tick zero so it covers the whole episode.
 *
 * The ids are escaped rather than interpolated: they come from the server, and
 * a path segment is not the place to find out one of them contained a slash.
 */
export function assStreamPath(itemId: string, mediaSourceId: string, index: number): string {
  return `/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSourceId)}/Subtitles/${index}/0/Stream.${ASS_STREAM_FORMAT}`
}

/**
 * Jellyfin's fallback fonts, which Apollo had never asked for before this.
 *
 * The eight ASS files measured carry no `[Fonts]` section at all, so every
 * font they name has to come from somewhere else. libass ships with Liberation
 * Sans, which is metrically an Arial and covers Latin; a server that has the
 * fallback folder configured is usually where the CJK coverage is.
 */
export const FALLBACK_FONT_LIST_PATH = '/FallbackFont/Fonts'

export function fallbackFontPath(name: string): string {
  return `${FALLBACK_FONT_LIST_PATH}/${encodeURIComponent(name)}`
}

/**
 * Every font here is fetched before the first subtitle is drawn, so the list is
 * capped. A fallback folder holding the whole Noto family would otherwise spend
 * the opening scene downloading it.
 */
export const MAX_FALLBACK_FONTS = 12

const FONT_FILE = /\.(ttf|otf|ttc|woff2?)$/i

export function pickFallbackFonts(
  files: { Name?: string | null }[] | null | undefined,
): string[] {
  return (files ?? [])
    .map((f) => f.Name)
    .filter((name): name is string => typeof name === 'string' && FONT_FILE.test(name))
    .slice(0, MAX_FALLBACK_FONTS)
}

/**
 * The one number libass is given: where in the subtitle file to draw from.
 *
 * Two unrelated corrections land on it, and neither is a shift in the sense
 * the `<track>` path uses. That path adds a delay to each cue's own start
 * time; libass is asked for a moment instead, so wanting the subtitles a
 * second later means asking for what was showing a second ago — the sign flips.
 *
 * The other correction is the transcode's. A non-HLS transcode is cut to begin
 * at the resume point, so the video element's clock restarts at zero while the
 * subtitle file still runs on the episode's timeline; without adding that back
 * the subtitles are out by however far into the episode the viewer was.
 */
export function assRenderTimeOffset({
  streamStartOffsetSeconds = 0,
  subtitleOffsetMs = 0,
}: {
  streamStartOffsetSeconds?: number
  subtitleOffsetMs?: number
}): number {
  const start = Number.isFinite(streamStartOffsetSeconds) ? streamStartOffsetSeconds : 0
  const delay = Number.isFinite(subtitleOffsetMs) ? subtitleOffsetMs : 0
  // Whole milliseconds, because seconds-plus-a-fraction is exactly the
  // arithmetic that turns a reset to zero into 2.7755575615628914e-17.
  return Math.round(start * 1000 - delay) / 1000
}

export interface AssCapabilities {
  worker: boolean
  wasm: boolean
  offscreenCanvas: boolean
  transferControlToOffscreen: boolean
}

/**
 * Whether this browser can run libass at all.
 *
 * Checked before the import rather than after it, so a browser that would only
 * throw never fetches two megabytes to find out. Every answer of `false` here
 * leaves the `<track>` element showing, which is the whole point: a viewer must
 * never end up with no subtitles because the better renderer could not start.
 */
export function canRenderAss(caps: AssCapabilities): boolean {
  return caps.worker && caps.wasm && caps.offscreenCanvas && caps.transferControlToOffscreen
}

/** The same question asked of the browser this is running in. */
export function browserCanRenderAss(): boolean {
  if (typeof window === 'undefined') return false
  return canRenderAss({
    worker: typeof Worker !== 'undefined',
    wasm: typeof WebAssembly !== 'undefined',
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    transferControlToOffscreen:
      typeof HTMLCanvasElement !== 'undefined' &&
      typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function',
  })
}

/**
 * The track libass should draw, or null to leave the `<track>` element to it.
 *
 * `burnedSubIndex` wins outright: those frames already have the subtitles
 * painted on, and drawing a second copy over the top is two sets of words at
 * once rather than an improvement.
 */
export function assTrackFor({
  subtitles,
  textTrackIndex,
  burnedSubIndex,
  supported,
  enabled,
}: {
  subtitles: SubtitleTrack[] | undefined
  textTrackIndex: number | null
  burnedSubIndex: number | undefined
  supported: boolean
  /*
    The viewer's choice, separate from whether the browser can do it at all.

    Worth having for three reasons that have nothing to do with each other: it
    is two megabytes of WebAssembly nobody should be made to fetch, the canvas
    is laid out for the player's Fit aspect and so cannot follow a cropped
    picture under Fill or Stretch, and a weak device may simply do better with
    plain text. Off, an ASS track falls back to the same cleaned-up `<track>`
    path SubRip uses.
  */
  enabled: boolean
}): SubtitleTrack | null {
  if (!enabled || !supported || burnedSubIndex != null || textTrackIndex == null) return null
  const track = subtitles?.find((s) => s.index === textTrackIndex)
  if (!track?.assUrl || !isAssCodec(track.codec)) return null
  return track
}

/*
  ── Subtitle size, once ASS is doing the typesetting ──────────────────────

  An ASS file carries its own font sizes, and they are in the script's own
  coordinate space — the same space `\pos` measures in. So the coordinates
  cannot be scaled to make text bigger: halving PlayResY doubles the apparent
  font size and simultaneously sends every sign to a different part of the
  frame. Scaling the canvas has the same problem from the other end.

  Multiplying the sizes and leaving every coordinate alone is the one edit that
  means "bigger text" and nothing else. It reaches both places a size is
  written: the Fontsize column of each style, and the `\fs` overrides in the
  events — which outnumber the styles by a wide margin, so doing only the
  former would leave most of a heavily typeset file untouched.
*/

/** Section headers, so a `Format:` line is read in the section it belongs to. */
const SECTION = /^\s*\[([^\]]*)\]\s*$/
const STYLES_SECTION = /^v4\+?\s*styles$/

export function scaleAssFontSizes(content: string, percent: number): string {
  const scale = clampSubtitleSize(percent) / 100
  // Identity at the default, so nothing reloads a track that does not change.
  if (scale === 1) return content

  let inStyles = false
  let fontsizeColumn = -1

  return content.split('\n').map((raw) => {
    // Split on \n alone and put the \r back, so a CRLF file comes back a CRLF
    // file rather than quietly rewritten.
    const cr = raw.endsWith('\r')
    const line = cr ? raw.slice(0, -1) : raw
    const scaled = scaleLine(line)
    return cr ? `${scaled}\r` : scaled
  }).join('\n')

  function scaleLine(line: string): string {
    const section = SECTION.exec(line)
    if (section) {
      inStyles = STYLES_SECTION.test(section[1].trim().toLowerCase())
      fontsizeColumn = -1
      return line
    }

    if (inStyles && line.toLowerCase().startsWith('format:')) {
      fontsizeColumn = line
        .slice('format:'.length)
        .split(',')
        .findIndex((name) => name.trim().toLowerCase() === 'fontsize')
      return line
    }

    if (inStyles && fontsizeColumn >= 0 && line.toLowerCase().startsWith('style:')) {
      const head = line.slice(0, 'style:'.length)
      const fields = line.slice('style:'.length).split(',')
      const size = Number(fields[fontsizeColumn])
      if (!Number.isFinite(size)) return line
      fields[fontsizeColumn] = String(round(size * scale))
      return head + fields.join(',')
    }

    /*
      `\fs` and nothing else. `\fsp` is letter spacing and `\fscx`/`\fscy` are
      percentages of the glyph's own width — all three start the same way, and
      all three are nonsense multiplied by a font size. Requiring a digit
      immediately after separates them.
    */
    return line.replace(/\\fs(\d+(?:\.\d+)?)/g, (_, n: string) =>
      `\\fs${round(Number(n) * scale)}`,
    )
  }
}

// Two decimals is more precision than any ASS file is authored with, and it
// keeps 20 × 1.1 out of the file as 22.000000000000004.
const round = (n: number) => Math.round(n * 100) / 100
