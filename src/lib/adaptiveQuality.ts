import { formatMbps } from './bandwidth'

/**
 * When to stop asking for a quality this connection has already failed to
 * carry.
 *
 * A measurement made before the first frame is a snapshot, and a connection is
 * not a constant: someone else in the house starts a download, the Wi-Fi drops
 * a band, the evening happens. `bandwidth.ts` picks the opening ceiling; this
 * decides when the opening ceiling has been disproved.
 *
 * The evidence is stalls — `waiting` on the video element, the same signal the
 * spinner already uses. Two patterns count as disproof:
 *
 * - `REPEATED_STALLS` of them inside `STALL_WINDOW_MS`. Any one stall is
 *   ordinary; three in a minute is a stream that does not fit.
 * - One stall longer than `LONG_STALL_MS`. A five-second freeze is not a dip,
 *   and waiting for two more of them before acting wastes two more minutes of
 *   someone's evening.
 *
 * What does *not* count is as important. A stall while seeking is the seek, and
 * a stall before the first frame is the file opening — counting either would
 * walk the quality down for scrubbing through an episode on a connection that
 * was never in trouble.
 *
 * This only ever steps down, and only in Auto. Stepping back up mid-episode
 * would mean re-testing, re-resolving the stream and re-buffering to find out
 * whether the thing that just failed has stopped failing, and a picture that
 * changes quality in both directions on its own is worse to watch than one
 * that settles.
 */

export const STALL_WINDOW_MS = 60_000
export const REPEATED_STALLS = 3
export const LONG_STALL_MS = 5_000

export interface Stall {
  /** When the picture froze, in epoch milliseconds. */
  at: number
  /** How long it stayed frozen. An ongoing stall reports how long so far. */
  durationMs: number
  /**
   * What the player was doing. `seek` and `startup` are reported rather than
   * filtered at the source so the rule that discards them is the testable part.
   */
  cause: 'playback' | 'seek' | 'startup'
}

export interface Assessment {
  drop: boolean
  reason: 'repeated' | 'long' | null
}

/** A seek's own buffering, and a file opening, are not quality problems. */
export function countsAgainstQuality(stall: Stall): boolean {
  return stall.cause === 'playback'
}

/** The stalls still inside the window, in the order they happened. */
export function recentStalls(stalls: readonly Stall[], now: number): Stall[] {
  return stalls.filter((s) => s.cause === 'playback' && now - s.at <= STALL_WINDOW_MS)
}

export function assessStalls(stalls: readonly Stall[], now: number): Assessment {
  const recent = recentStalls(stalls, now)
  if (recent.some((s) => s.durationMs >= LONG_STALL_MS)) return { drop: true, reason: 'long' }
  if (recent.length >= REPEATED_STALLS) return { drop: true, reason: 'repeated' }
  return { drop: false, reason: null }
}

/**
 * The highest offered quality strictly below the one in use, or null at the
 * bottom of the menu — where there is nothing left to try and a notice saying
 * so would be the fourth one in three minutes.
 *
 * A ceiling of 0 is Jellyfin's "no limit", which is above every option rather
 * than below all of them.
 */
export function nextStepDown(options: readonly number[], ceilingBps: number): number | null {
  const ceiling = ceilingBps > 0 ? ceilingBps : Infinity
  const below = options.filter((value) => value > 0 && value < ceiling)
  return below.length ? Math.max(...below) : null
}

/**
 * What the viewer is told. It names the figure because the alternative — a
 * picture that quietly gets softer — is the thing people describe as the app
 * being broken.
 */
export function dropMessage(bps: number): string {
  return `Lowered quality to ${formatMbps(bps)} — the video kept buffering.`
}
