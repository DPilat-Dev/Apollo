/**
 * What a *press* on the video means, as opposed to a tap.
 *
 * `tapGesture` answers "what did that tap do"; this answers the question one
 * level below it — whether the finger that just lifted was ever a tap at all.
 * Three gestures now share the same `pointerdown`: a tap, a vertical drag for
 * volume, and a press-and-hold for double speed. They are told apart by how
 * far the finger moved and how long it stayed down, and only one of them can
 * win, because a swipe that also toggled the controls on release reads as the
 * player fighting you.
 *
 * The state is deliberately monotonic: a press starts as a candidate tap and
 * can leave for a swipe or a hold, but never comes back. Without that, lifting
 * a finger back to where it started — which is exactly what a flick does —
 * would look like a tap that had never moved.
 */

export type SwipeAxis = 'vertical' | 'horizontal'

export type PressKind =
  /** Still a candidate tap. Nothing has ruled it out yet. */
  | 'tap'
  | 'swipe'
  | 'hold'

export interface PressProgress {
  kind: PressKind
  /**
   * Which way a swipe went. Null until one axis clearly wins, because a thumb
   * arcs and the first samples of a sideways drag are diagonal.
   */
  axis: SwipeAxis | null
}

/**
 * How far a finger may wander and still count as a tap. Generous, because a
 * tap on a phone held one-handed always drags a few pixels; too tight and
 * every second double tap would be eaten as a swipe.
 */
export const TAP_SLOP_PX = 12

/**
 * How long a press has to be held to mean "speed up". Comfortably longer than
 * `DOUBLE_TAP_MS`, so neither half of a double tap can reach it — the two
 * gestures would otherwise be racing for the same finger.
 */
export const LONG_PRESS_MS = 500

/** The rate a hold runs at, matching the gesture people know from YouTube. */
export const HOLD_RATE = 2

/**
 * Fraction of the video's height that covers the whole volume range. Measured
 * against the element rather than in pixels so the gesture feels the same on a
 * phone and on a desktop window; less than the full height because a drag that
 * has to start at the very top to reach silence is unusable one-handed.
 */
export const VOLUME_SWIPE_FRACTION = 0.6

/** A press that has just begun: no movement, no time on the glass. */
export const PRESS_START: PressProgress = { kind: 'tap', axis: null }

/** Where a swipe is allowed to do something. */
export type SwipeRegion = 'volume' | 'inert'

/**
 * Volume lives on the right half, as it does in VLC and Plex.
 *
 * The left half is inert on purpose. Its conventional job is brightness, and
 * the web has no screen-brightness API at all — dimming with a black overlay
 * would darken the picture while the backlight, and the battery drain that
 * goes with it, stayed exactly where they were. Better to do nothing than to
 * mime it.
 */
export function swipeRegion(x: number, width: number): SwipeRegion {
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0) return 'inert'
  return x / width > 0.5 ? 'volume' : 'inert'
}

/**
 * Advance a press by the latest sample of where the finger is and how long it
 * has been down. `dx`/`dy` are measured from where the press started, not from
 * the previous sample, so a sequence of these is idempotent and a dropped
 * pointermove cannot lose part of the movement.
 *
 * Movement is checked before time: a finger still travelling when the hold
 * deadline passes is dragging, not holding, and running the video at 2× under
 * a volume swipe would be two gestures answering one press.
 */
export function advancePress(
  progress: PressProgress,
  sample: { dx: number; dy: number; elapsedMs: number },
  { slop = TAP_SLOP_PX, holdMs = LONG_PRESS_MS }: { slop?: number; holdMs?: number } = {},
): PressProgress {
  // A hold is already doing something visible; letting a stray move cancel it
  // would drop the speed back mid-scene while the finger was still down.
  if (progress.kind === 'hold') return progress

  const { dx, dy, elapsedMs } = sample
  const moved = Number.isFinite(dx) && Number.isFinite(dy) ? Math.hypot(dx, dy) : 0

  if (progress.kind === 'swipe' || moved > slop) {
    return { kind: 'swipe', axis: progress.axis ?? dominantAxis(dx, dy) }
  }

  if (Number.isFinite(elapsedMs) && elapsedMs >= holdMs) return { kind: 'hold', axis: null }

  return progress.kind === 'tap' ? progress : { kind: 'tap', axis: null }
}

/**
 * Which way the finger is going, or null while it is ambiguous. Ties stay
 * undecided rather than guessing: a 45° drag is as likely to become sideways
 * as vertical, and guessing wrong yanks the volume.
 */
function dominantAxis(dx: number, dy: number): SwipeAxis | null {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null
  if (Math.abs(dy) > Math.abs(dx)) return 'vertical'
  if (Math.abs(dx) > Math.abs(dy)) return 'horizontal'
  return null
}

/**
 * Whether the release of this press should still be handed to the tap
 * gestures. Everything that is not a plain tap swallows its own release —
 * a swipe or a hold that also toggled the controls on the way out would look
 * like the player acting on its own.
 */
export function firesTap(progress: PressProgress): boolean {
  return progress.kind === 'tap'
}

/**
 * The level a volume swipe has reached, given where it started and how far the
 * finger has come. Dragging up is louder, so the screen-coordinate `dy` — which
 * grows downwards — is subtracted.
 *
 * Everything unusable falls back to the starting level rather than throwing:
 * a non-finite number assigned to `video.volume` raises a TypeError in every
 * browser, which would take the pointermove handler down with it, and a
 * zero-height element means the layout has not settled yet.
 */
export function volumeAfterDrag(startVolume: number, dy: number, height: number): number {
  const start = clamp01(startVolume)
  if (!Number.isFinite(dy) || !Number.isFinite(height) || height <= 0) return start
  return clamp01(start - dy / (height * VOLUME_SWIPE_FRACTION))
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}
