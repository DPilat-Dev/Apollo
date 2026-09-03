import { useEffect, useRef, useState } from 'react'

/** Fast at first and easing out, so a number lands rather than stopping dead. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Counts a number up from zero.
 *
 * Worth the code only because a recap is the one page where the numbers *are*
 * the content — a total that ticks up is read, and a total that is simply
 * printed is skimmed past.
 *
 * Returns the target immediately when motion is not wanted, so the setting is
 * honoured by the value rather than by a wrapper somebody can forget.
 */
export function useCountUp(target: number, opts: { enabled?: boolean; durationMs?: number } = {}) {
  const { enabled = true, durationMs = 1100 } = opts
  const [value, setValue] = useState(enabled ? 0 : target)
  const frame = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!enabled || !Number.isFinite(target)) {
      setValue(target)
      return
    }
    const started = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - started) / durationMs)
      setValue(Math.round(target * easeOut(progress)))
      // Landing on the target exactly matters: an eased value one short of the
      // real one is a number that is quietly wrong for as long as it is on screen.
      if (progress < 1) frame.current = requestAnimationFrame(step)
      else setValue(target)
    }
    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
    }
  }, [target, enabled, durationMs])

  return value
}
