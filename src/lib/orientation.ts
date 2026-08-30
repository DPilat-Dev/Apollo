/**
 * Turning the phone sideways for you.
 *
 * A 16:9 picture in a portrait window uses about a third of the glass, and
 * the remedy — rotate the handset — is one every viewer already knows and
 * nobody enjoys doing. Every video app on a phone does this for them.
 *
 * The catch is that `screen.orientation.lock()` is only allowed while
 * fullscreen, and is missing entirely from iOS Safari. Both are ordinary
 * states rather than errors, so the decision of whether to ask at all is
 * pulled out here where it can be tested without a phone.
 */

export interface OrientationEnv {
  /** `screen.orientation.lock` exists in this browser. */
  supported: boolean
  /** A touchscreen. A monitor does not rotate, so locking one is nonsense. */
  coarsePointer: boolean
  fullscreen: boolean
  /** The viewer's setting. */
  enabled: boolean
}

export type LockTarget = 'landscape' | null

/**
 * Whether to lock, and to what.
 *
 * Returning null rather than throwing on every unsupported case matters: the
 * lock rejects outside fullscreen, and an unconditional call would put an
 * unhandled rejection in the console of every player that opens on a laptop.
 */
export function orientationLockTarget(env: OrientationEnv): LockTarget {
  if (!env.enabled || !env.supported || !env.coarsePointer) return null
  if (!env.fullscreen) return null
  return 'landscape'
}

/**
 * Whether to take the player fullscreen on its own.
 *
 * Rotating needs fullscreen, so on a phone the two are really one gesture the
 * viewer should not have to make. `alreadyTried` is what keeps this from
 * becoming a trap: without it, leaving fullscreen immediately puts you back
 * in, and there is no way out of the player at all.
 */
export function shouldEnterFullscreen(input: {
  enabled: boolean
  coarsePointer: boolean
  playing: boolean
  alreadyFullscreen: boolean
  alreadyTried: boolean
}): boolean {
  if (!input.enabled || !input.coarsePointer) return false
  if (input.alreadyFullscreen || input.alreadyTried) return false
  return input.playing
}
