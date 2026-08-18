import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { episodeCode } from './format'

/**
 * What the operating system shows while Apollo is playing: the lock screen,
 * the notification shade, the car stereo, the macOS Now Playing widget.
 *
 * Everything here is pure so the shape handed to the browser can be tested.
 * The wiring lives in `useMediaSession`.
 */

export interface Artwork {
  src: string
  sizes: string
  type?: string
}

export interface Metadata {
  title: string
  artist: string
  album: string
  artwork: Artwork[]
}

export interface PositionState {
  duration: number
  position: number
  playbackRate: number
}

/**
 * Three lines of text, mapped the way a music player would read them, because
 * that is what the OS widgets are laid out for.
 *
 * An episode is the interesting case: the *series* is the recognisable name, so
 * it takes the "artist" slot where every widget shows it largest, and the
 * episode title leads. A film has no such hierarchy, so the year fills the
 * second line rather than leaving it blank.
 */
export function mediaMetadata(item: BaseItemDto, artwork: Artwork[] = []): Metadata {
  if (item.Type === 'Episode') {
    const code = episodeCode(item)
    return {
      title: item.Name ?? 'Episode',
      artist: item.SeriesName ?? '',
      album: [item.SeasonName, code].filter(Boolean).join(' · '),
      artwork,
    }
  }
  return {
    title: item.Name ?? 'Untitled',
    artist: item.ProductionYear ? String(item.ProductionYear) : '',
    album: item.Type === 'Movie' ? '' : (item.SeriesName ?? ''),
    artwork,
  }
}

/**
 * The scrubber the OS draws, or nothing.
 *
 * `setPositionState` throws a TypeError on any inconsistency — a NaN duration
 * before metadata loads, a rate of zero while paused, or a position past the
 * end — and an exception thrown from a timeupdate handler would take the
 * player's clock down with it. Every one of those is reachable here: duration
 * is NaN until `durationchange` fires, and `absoluteTime` is measured against
 * the file while `absoluteDuration` comes from the server's RunTimeTicks, so
 * the two disagree by a second or so at the end of most episodes.
 *
 * Returning null means "say nothing this time" rather than guessing.
 */
export function positionState(
  duration: number,
  position: number,
  playbackRate: number,
): PositionState | null {
  if (!Number.isFinite(duration) || duration <= 0) return null
  return {
    duration,
    position: Math.min(Math.max(position, 0), duration),
    // Zero is what a paused <video> reports in some browsers, and the spec
    // rejects it. Anything unusable becomes normal speed.
    playbackRate:
      Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
  }
}

/**
 * Artwork at the sizes the widgets pick from — a phone lock screen reaches for
 * the largest, a notification row for the smallest.
 *
 * `sizes` has to be true twice over. Widgets lay out against the number rather
 * than the pixels, so declaring a 2:3 poster as square leaves it stretched —
 * hence a square crop and one edge length rather than a width. And the number
 * has to be what the server will actually send: the image URL builder scales
 * by device pixel ratio and snaps to a bucket, so a request for 512 comes back
 * as 640 on a desktop and 1280 on a phone. Declaring the request instead of the
 * result understates every candidate, worst on exactly the small screens whose
 * lock screens want the biggest one.
 *
 * `resolve` maps a requested edge to the delivered one; the default suits a
 * source that honours the request exactly.
 */
export function artworkSizes(
  square: (edge: number) => string | null,
  resolve: (edge: number) => number = (edge) => edge,
  edges = [96, 256, 512],
): Artwork[] {
  return edges
    .map((edge) => {
      const actual = resolve(edge)
      return { src: square(edge), sizes: `${actual}x${actual}` }
    })
    .filter((a): a is Artwork => Boolean(a.src))
}
