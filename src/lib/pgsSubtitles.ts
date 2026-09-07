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
