/**
 * What a tap on the video means.
 *
 * A touchscreen has no hover and no right button, so the video surface has to
 * carry three gestures at once: reveal the controls, seek, and play/pause.
 * Every mobile player resolves that the same way — one tap toggles the chrome,
 * two taps near an edge jump — and this module is the part of that worth
 * testing without a browser.
 *
 * The catch is that a first tap and the first half of a double tap are the
 * same event. Deciding what a tap meant therefore needs the tap before it,
 * which is what `classifyTap` takes.
 */

export type TapZone = 'left' | 'center' | 'right'

/** How long a second tap has to land to count as a double tap. */
export const DOUBLE_TAP_MS = 300

/** Seconds a double tap jumps, matching the on-screen skip buttons. */
export const TAP_SEEK_SECONDS = 10

/**
 * How much of each side seeks. The middle third is left alone: that is where a
 * thumb rests, and where an accidental jump would be most annoying.
 */
const EDGE_FRACTION = 0.35

export function tapZone(x: number, width: number): TapZone {
  if (!(width > 0)) return 'center'
  const fraction = x / width
  if (fraction < EDGE_FRACTION) return 'left'
  if (fraction > 1 - EDGE_FRACTION) return 'right'
  return 'center'
}

export interface TapState {
  zone: TapZone
  /** Event timestamp, in milliseconds. */
  at: number
  /** How many taps this burst is up to. */
  count: number
}

export type TapAction =
  /** Might still become a double tap. Act only once the window closes. */
  | { type: 'wait' }
  | { type: 'seek'; seconds: number }
  | { type: 'toggle' }

/**
 * Classify a tap against the one before it.
 *
 * A repeat tap has to land in the *same* zone: a left-then-right pair is two
 * people-changed-their-mind taps, not a gesture, and seeking backwards then
 * forwards would leave the viewer exactly where they started but confused.
 *
 * Bursts keep counting, so a third tap jumps another ten seconds rather than
 * resetting — holding a thumb on the right edge scrubs forward, which is what
 * anyone who has used a phone player expects.
 */
export function classifyTap(
  previous: TapState | null,
  zone: TapZone,
  at: number,
  windowMs = DOUBLE_TAP_MS,
): { action: TapAction; state: TapState } {
  const repeat = previous !== null && previous.zone === zone && at - previous.at <= windowMs

  if (!repeat) return { action: { type: 'wait' }, state: { zone, at, count: 1 } }

  const state: TapState = { zone, at, count: previous.count + 1 }
  if (zone === 'center') return { action: { type: 'toggle' }, state }
  return {
    action: { type: 'seek', seconds: zone === 'left' ? -TAP_SEEK_SECONDS : TAP_SEEK_SECONDS },
    state,
  }
}
