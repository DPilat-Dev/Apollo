import { assRenderTimeOffset } from './assSubtitles'
import type { SubtitleTrack } from './playback'

/**
 * PGS subtitles, drawn here instead of burned into the video by the server.
 *
 * ── What this replaces ─────────────────────────────────────────────────────
 *
 * PGS and VOBSUB are pictures, not text. There is no way to hand a picture to
 * a `<track>` element, so Apollo did what it could: it asked the server to
 * paint the subtitles into the frames. That means re-encoding the whole video.
 * Choosing one showed a bare spinner for twenty seconds on a large file, cost
 * the server its CPU for as long as the episode ran, and ruled out direct play
 * entirely.
 *
 * It is also avoidable, and the server was willing all along. A client
 * declares in its device profile which subtitle formats it can take as files.
 * Apollo declared `vtt`, `ass`, `ssa` and `subrip` — and not `pgssub`, so the
 * server concluded it had to burn them in. Measured against one real library:
 *
 *                            without pgssub      with pgssub
 *   DeliveryMethod           Encode              External
 *   SupportsDirectPlay       false               true
 *   TranscodingUrl           present             none
 *
 * With the format declared, the same track arrives as a `.sup` file and is
 * drawn on a canvas over the video — no re-encode, no reload, and switching
 * between tracks is instant.
 *
 * ── What still burns in ────────────────────────────────────────────────────
 *
 * VOBSUB (`dvdsub`). It is a different bitmap format and libpgs does not read
 * it; three streams in the library this was built against, against 1,356 PGS.
 * Those keep the old path, which is why the burn-in code is still here.
 */

/** The extension the server exposes the untouched bitmap stream under. */
export const PGS_STREAM_FORMAT = 'pgssub'

/*
  What the server calls it, and what a container might. `pgssub` is Jellyfin's
  name; the others turn up when a file was remuxed by something that used
  ffmpeg's naming instead.
*/
const PGS_CODECS = new Set(['pgssub', 'pgs', 'hdmv_pgs_subtitle'])

export function isPgsCodec(codec: string | null | undefined): boolean {
  return PGS_CODECS.has((codec ?? '').trim().toLowerCase())
}

/**
 * The declaration that stops the server re-encoding.
 *
 * Exported so the device profile and this renderer cannot disagree: promising
 * the server a format nothing here can draw would leave a viewer with no
 * subtitles and no burn-in either, which is worse than the wait it replaced.
 */
export const PGS_SUBTITLE_PROFILE = { Format: PGS_STREAM_FORMAT, Method: 'External' } as const

export function pgsStreamPath(itemId: string, mediaSourceId: string, index: number): string {
  return `/Videos/${encodeURIComponent(itemId)}/${encodeURIComponent(mediaSourceId)}/Subtitles/${index}/0/Stream.${PGS_STREAM_FORMAT}`
}

export interface PgsCapabilities {
  worker: boolean
  canvas: boolean
}

/**
 * Whether this browser can draw PGS at all.
 *
 * A far lower bar than libass: there is no WebAssembly and no OffscreenCanvas
 * requirement, because libpgs falls back to decoding on the main thread when a
 * worker cannot take it. Only a browser with no canvas at all is excluded, and
 * that browser cannot play video either.
 */
export function canRenderPgs(caps: PgsCapabilities): boolean {
  return caps.canvas && caps.worker
}

export function browserCanRenderPgs(): boolean {
  if (typeof window === 'undefined') return false
  return canRenderPgs({
    worker: typeof Worker !== 'undefined',
    canvas: typeof HTMLCanvasElement !== 'undefined',
  })
}

/*
  ── Drawing it here, or asking the server to burn it in ────────────────────

  Apollo can render a PGS track itself, which is instant to switch, adjustable,
  and costs the server nothing. Getting hold of it is the problem: the first
  request for a subtitle stream inside a Matroska file makes Jellyfin extract
  it, and it sends nothing until that finishes. Measured against 10.11.8, the
  extraction reads the whole container at a steady rate — the codec makes no
  difference at all:

    subrip  0.37 GB   4.3 s      ass  0.41 GB   3.6 s      pgssub  1.00 GB   8.7 s
    subrip  0.86 GB   7.4 s      ass  1.47 GB  12.6 s      pgssub  1.03 GB   8.9 s
    subrip  4.10 GB  35.1 s                                pgssub  5.74 GB  48.8 s

  About 8.6 seconds per gigabyte, every time. Which means the wait is decided
  by the file, not the format — and PGS only ever feels slow because PGS only
  exists in Blu-ray remuxes. Of the 394 items carrying one here, the 297 that
  extract in under thirty seconds are every last episode; the rest are films,
  up to 73.9 GB and ten minutes.

  Burn-in has none of that cost. The server overlays the subtitle stream while
  it encodes, so nothing is extracted and playback starts in seconds. What it
  costs instead is a re-encode, a reload to change track, and a fixed size.

  So the choice is worth making per file rather than once. It is also the
  choice jellyfin-web already made: it has this same renderer, behind
  `subtitlerenderpgs`, and ships it off — every PGS track burns in unless
  somebody opts in. This keeps the good half of that, for the files where the
  wait is a few seconds rather than a few minutes.
*/

/** What the extraction costs, per gigabyte of container. */
export const EXTRACTION_SECONDS_PER_GB = 8.6

/**
 * The longest extraction worth waiting through.
 *
 * Thirty seconds is roughly a title sequence: long enough that every ordinary
 * episode stays on the renderer that switches instantly, short enough that
 * nobody watches a blank lower third while a film is read end to end.
 */
export const EXTRACTION_BUDGET_SECONDS = 30

/** How long the server will take to hand this track over, or null if unknown. */
export function extractionSeconds(sizeBytes: number | null | undefined): number | null {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes <= 0) return null
  return (sizeBytes / 1e9) * EXTRACTION_SECONDS_PER_GB
}

/**
 * Where a PGS track should be rendered.
 *
 * An unknown size draws here, which is both the old behaviour and the safer
 * guess: burning in is a re-encode, and imposing one on the strength of a
 * missing field would be a worse mistake than a wait that `usePgsSubtitles`
 * now sits through gracefully.
 */
export function pgsDelivery(sizeBytes: number | null | undefined): 'render' | 'burn-in' {
  const seconds = extractionSeconds(sizeBytes)
  if (seconds === null) return 'render'
  return seconds > EXTRACTION_BUDGET_SECONDS ? 'burn-in' : 'render'
}

/**
 * Whether choosing this track means going back to the server.
 *
 * The menu, the deep link and the automatic selection all have to agree about
 * this, and they used to answer it three different ways — which is how a
 * `?subtitle=` link to a PGS track ended up being burned in while the menu
 * swapped to the same track instantly.
 */
export function subtitleNeedsBurnIn(
  track: Pick<SubtitleTrack, 'url' | 'pgsUrl' | 'codec'> | null | undefined,
  sizeBytes: number | null | undefined,
): boolean {
  if (!track) return false
  // A WebVTT conversion is small and already made; nothing here applies to it.
  if (track.url) return false
  if (!track.pgsUrl) return true
  return pgsDelivery(sizeBytes) === 'burn-in'
}

/**
 * The track libpgs should draw, or null to leave it alone.
 *
 * `burnedSubIndex` still wins outright, for the same reason it does for ASS:
 * those frames already carry the subtitles, and drawing a second copy over the
 * top is two sets of words rather than an improvement.
 */
export function pgsTrackFor({
  subtitles,
  textTrackIndex,
  burnedSubIndex,
  supported,
}: {
  subtitles: SubtitleTrack[] | undefined
  textTrackIndex: number | null
  burnedSubIndex: number | undefined
  supported: boolean
}): SubtitleTrack | null {
  if (!supported || burnedSubIndex != null || textTrackIndex == null) return null
  const track = subtitles?.find((s) => s.index === textTrackIndex)
  if (!track?.pgsUrl || !isPgsCodec(track.codec)) return null
  return track
}

/**
 * The canvas aspect mode matching the player's own.
 *
 * libpgs positions each bitmap inside the video's frame, so it has to be told
 * how the picture is fitted or every sign lands somewhere else. This is the
 * thing libass could not be told — which is why ASS typesetting carries a
 * known limitation under Fill and Stretch and PGS does not.
 */
export function pgsAspectMode(aspect: string): 'contain' | 'cover' | 'fill' {
  if (aspect === 'fill') return 'cover'
  if (aspect === 'stretch') return 'fill'
  return 'contain'
}

/**
 * Where in the subtitle file to draw from.
 *
 * libpgs renders at `video.currentTime + timeOffset`, which is the same
 * question libass is asked, so the arithmetic is shared rather than written
 * twice with one of them getting a sign wrong.
 */
export const pgsRenderTimeOffset = assRenderTimeOffset
