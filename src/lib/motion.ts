/**
 * Whether to animate, and who decides.
 *
 * Apollo has had a "Reduce motion" switch since the recap screens were built,
 * and it worked — but it was the only thing consulted. Someone who had turned
 * reduced motion on for their whole system still got the full recap sequence
 * unless they came here and found this switch too, which is the one place a
 * person who dislikes motion is least likely to go looking.
 *
 * So the operating system is now the default answer rather than no answer, and
 * the setting became three-way. `system` follows the machine, and the other two
 * are deliberate overrides in either direction — including "full", because a
 * person who turned the system preference on for one badly-behaved app should
 * not have to turn it off there to watch a recap here.
 */

export type MotionPreference = 'system' | 'full' | 'reduced'

export const MOTION_PREFERENCES: readonly MotionPreference[] = ['system', 'full', 'reduced']

/** The media query the OS preference is read from. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export function isMotionPreference(value: unknown): value is MotionPreference {
  return typeof value === 'string' && (MOTION_PREFERENCES as readonly string[]).includes(value)
}

/** Whether motion should be reduced, given the preference and the machine. */
export function resolveMotion(
  preference: MotionPreference,
  systemPrefersReduced: boolean,
): boolean {
  if (preference === 'reduced') return true
  if (preference === 'full') return false
  return systemPrefersReduced
}

/**
 * The stored preference, including one saved before this was three-way.
 *
 * The old field was a boolean. `true` was a deliberate choice and survives as
 * `reduced`; `false` was almost always nobody having touched it, so it becomes
 * `system` rather than being read as "this person wants animation regardless of
 * what their machine says". Whoever genuinely wants that can now say so.
 */
export function migrateMotion(stored: {
  motion?: unknown
  reduceMotion?: unknown
}): MotionPreference {
  if (isMotionPreference(stored.motion)) return stored.motion
  if (stored.reduceMotion === true) return 'reduced'
  return 'system'
}

/**
 * What to stamp on the document, so stylesheets can answer the same question.
 *
 * CSS could ask the media query itself, but then it would answer differently
 * from the rest of the app the moment someone overrides the system preference —
 * a recap that respects the override while its own skeletons and gesture pills
 * ignore it. One resolved answer, published once, keeps them together.
 */
export function motionAttribute(reduced: boolean): 'reduced' | 'full' {
  return reduced ? 'reduced' : 'full'
}

export const MOTION_LABELS: Record<MotionPreference, { label: string; hint: string }> = {
  system: { label: 'Match my system', hint: 'Follows the reduced-motion setting on this device.' },
  full: { label: 'Full motion', hint: 'Animations play even if this device asks for less.' },
  reduced: { label: 'Reduce motion', hint: 'Skips crossfades, count-ups and the recap sequence.' },
}
