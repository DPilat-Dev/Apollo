import { useEffect, useRef } from 'react'
import { orientationLockTarget, shouldEnterFullscreen } from './orientation'

/**
 * The Screen Orientation API, minus the parts that throw.
 *
 * `lock` is not in the DOM lib's `ScreenOrientation` in every TS version, and
 * it is genuinely absent from iOS Safari, so it is reached for defensively
 * rather than declared.
 */
type Lockable = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>
  unlock?: () => void
}

const orientation = (): Lockable | null =>
  typeof screen !== 'undefined' && screen.orientation ? (screen.orientation as Lockable) : null

const coarsePointer = () =>
  typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

/**
 * Rotates a phone into landscape for the duration of a fullscreen video, and
 * lets it go afterwards.
 *
 * Every failure here is silent on purpose. A browser that refuses is a
 * browser where the viewer rotates the handset themselves, exactly as they
 * did before — which is a worse experience, not a broken one, and not worth
 * an error in front of someone trying to watch something.
 */
export function useOrientationLock({
  enabled,
  fullscreen,
  playing,
  enterFullscreen,
}: {
  enabled: boolean
  fullscreen: boolean
  playing: boolean
  /** The same call the fullscreen button makes, so both routes behave alike. */
  enterFullscreen: () => Promise<void> | void
}) {
  useEffect(() => {
    const target = orientationLockTarget({
      enabled,
      fullscreen,
      supported: Boolean(orientation()?.lock),
      coarsePointer: coarsePointer(),
    })
    if (!target) return

    void orientation()?.lock?.(target).catch(() => {})

    /*
      Unlock on the way out, not just on leaving fullscreen. A lock outlives
      the element that asked for it, so a player left without unlocking pins
      the whole site sideways — including the pages the viewer goes back to.
    */
    return () => {
      try {
        orientation()?.unlock?.()
      } catch {
        // Already unlocked, or never locked. Neither is a problem.
      }
    }
  }, [enabled, fullscreen])

  // Fullscreen is a precondition of rotating, so on a phone the two are one
  // action. Tried once per player; see `shouldEnterFullscreen`.
  const tried = useRef(false)
  useEffect(() => {
    if (
      !shouldEnterFullscreen({
        enabled,
        coarsePointer: coarsePointer(),
        playing,
        alreadyFullscreen: Boolean(document.fullscreenElement),
        alreadyTried: tried.current,
      })
    )
      return
    tried.current = true
    // Rejected without a recent user gesture, which is common and fine: the
    // fullscreen button is still right there.
    void Promise.resolve(enterFullscreen()).catch(() => {})
  }, [enabled, playing, enterFullscreen])
}
