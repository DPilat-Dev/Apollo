/**
 * Keyboard seeking on the seek bar.
 *
 * Left and Right are left where they are documented: the player's shortcut
 * handler listens on `window`, so it fires whatever is focused and seeks ten
 * seconds there, sixty with Shift. Claiming them here as well would move the
 * film twice for one press.
 *
 * Up and Down are a different matter, and are the reason this is not just the
 * ends and the pages. The window handler takes them for the volume, so a
 * control announced to the viewer as a slider answered half the arrow keys it
 * promises: Left and Right seeked, Up and Down silently moved the sound. They
 * are handled here, and the bar stops them reaching the window — which is the
 * only key it does that for.
 */

/** One press of Page Up or Page Down, matching Shift + arrow in the player. */
export const SCRUBBER_PAGE_SECONDS = 60

/**
 * One press of Up or Down, matching a bare arrow in the player.
 *
 * The same ten seconds Left and Right are worth, because a slider whose four
 * arrows move it by different amounts is a slider nobody can aim.
 */
export const SCRUBBER_STEP_SECONDS = 10

/**
 * Whether there is a position on the bar to seek to at all.
 *
 * A duration of zero is a stream that has not said how long it is yet, and an
 * infinite one is live — in both, every point on the bar means nothing, and a
 * `NaN` reaching `video.currentTime` throws. One rule rather than two: the
 * component asks this to decide what to announce, and the seek below asks it to
 * decide whether to answer at all.
 */
export function durationKnown(duration: number): boolean {
  return Number.isFinite(duration) && duration > 0
}

/**
 * Where a keypress on the bar should land, in seconds, or null when the key is
 * not one of the bar's own.
 */
export function scrubberKeySeek(
  key: string,
  position: { current: number; duration: number },
  modifiers: { shift?: boolean } = {},
): number | null {
  const { current, duration } = position
  if (!durationKnown(duration)) return null
  const at = Number.isFinite(current) ? current : 0
  const clamp = (seconds: number) => Math.min(Math.max(seconds, 0), duration)
  const step = modifiers.shift ? SCRUBBER_PAGE_SECONDS : SCRUBBER_STEP_SECONDS

  switch (key) {
    case 'Home':
      return 0
    // The end of the bar is the end of the title, which plays out exactly as
    // watching to it does — including handing over to the next episode.
    case 'End':
      return duration
    case 'PageUp':
      return clamp(at + SCRUBBER_PAGE_SECONDS)
    case 'PageDown':
      return clamp(at - SCRUBBER_PAGE_SECONDS)
    // Shift matches the horizontal arrows' sixty seconds, since the window
    // handler never sees these and cannot apply its own.
    case 'ArrowUp':
      return clamp(at + step)
    case 'ArrowDown':
      return clamp(at - step)
    default:
      return null
  }
}
