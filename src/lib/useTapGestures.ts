import { useCallback, useEffect, useRef } from 'react'
import { classifyTap, DOUBLE_TAP_MS, tapZone, type TapState, type TapZone } from './tapGesture'

export interface TapFeedback {
  zone: TapZone
  seconds: number
  /** Changes on every jump, so a repeat in the same direction still animates. */
  key: number
}

/**
 * Touch gestures for the video surface.
 *
 * Returns a `pointerup` handler. Mouse and pen are deliberately untouched — a
 * click still toggles playback the instant it lands, because deferring it by
 * the double-tap window to watch for a second click would make every desktop
 * pause feel broken.
 */
export function useTapGestures({
  onSeekBy,
  onTogglePlay,
  onSingleTap,
  onFeedback,
}: {
  onSeekBy: (seconds: number) => void
  onTogglePlay: () => void
  /** A tap that turned out to be alone. */
  onSingleTap: () => void
  onFeedback?: (feedback: TapFeedback | null) => void
}) {
  const last = useRef<TapState | null>(null)
  const timer = useRef<number | undefined>(undefined)

  // Held in a ref so the returned handler is stable: it goes straight onto the
  // video element, and a new identity every render would re-bind it constantly.
  const cbs = useRef({ onSeekBy, onTogglePlay, onSingleTap, onFeedback })
  cbs.current = { onSeekBy, onTogglePlay, onSingleTap, onFeedback }

  useEffect(() => () => window.clearTimeout(timer.current), [])

  return useCallback((e: React.PointerEvent<HTMLElement>) => {
    // Right and middle buttons belong to the browser's own menu, not to us.
    if (e.button !== 0) return

    if (e.pointerType !== 'touch') {
      cbs.current.onTogglePlay()
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const zone = tapZone(e.clientX - rect.left, rect.width)
    const { action, state } = classifyTap(last.current, zone, e.timeStamp)
    last.current = state

    window.clearTimeout(timer.current)

    if (action.type === 'wait') {
      timer.current = window.setTimeout(() => {
        last.current = null
        cbs.current.onSingleTap()
      }, DOUBLE_TAP_MS)
      return
    }

    if (action.type === 'toggle') {
      cbs.current.onTogglePlay()
      return
    }

    cbs.current.onSeekBy(action.seconds)
    cbs.current.onFeedback?.({ zone, seconds: action.seconds, key: state.at })
  }, [])
}
