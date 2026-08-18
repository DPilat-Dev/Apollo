import { useEffect } from 'react'

/**
 * Keeps the screen on while something is playing.
 *
 * A phone or tablet dims and locks after 30 seconds of no touches, and a video
 * playing in a browser tab does not count as activity the way a native player
 * does. Without this, watching on a phone means tapping the screen every half
 * minute.
 *
 * The lock is released by the browser itself whenever the tab is hidden, and
 * is *not* restored when it comes back — so returning to the tab has to ask
 * again. That reacquisition is the part everyone forgets, and it is why the
 * screen still sleeps after answering a message mid-episode.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return

    let sentinel: WakeLockSentinel | null = null
    let released = false

    const acquire = async () => {
      if (released || document.visibilityState !== 'visible') return
      try {
        sentinel = await navigator.wakeLock.request('screen')
        // The effect may have been cleaned up while the request was in flight.
        if (released) void sentinel.release().catch(() => {})
      } catch {
        // Denied — a low battery or a policy. Nothing here is worth an error
        // in front of the viewer; the screen simply behaves as it did before.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release().catch(() => {})
    }
  }, [active])
}
