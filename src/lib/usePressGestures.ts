import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { RefObject } from 'react'
import {
  advancePress,
  firesTap,
  HOLD_RATE,
  LONG_PRESS_MS,
  PRESS_START,
  swipeRegion,
  volumeAfterDrag,
  type PressProgress,
  type SwipeRegion,
} from './pressGesture'

export type PressFeedback =
  /** `level` is what the element actually reports, not what was asked for. */
  | { kind: 'volume'; level: number }
  | { kind: 'speed'; rate: number }

/**
 * Drag-and-hold gestures for the video surface.
 *
 * Sits in front of `useTapGestures` rather than beside it: every press starts
 * as a candidate tap, and only the release that is still a tap is handed on.
 * A swipe or a hold that also toggled the controls on the way out would look
 * like the player doing two things to one finger.
 *
 * Touch only, deliberately. A mouse has a wheel and a volume slider, and
 * making a click-drag change the volume would mean a stray drag off the play
 * button silently muted the film.
 */
export function usePressGestures({
  videoRef,
  onTap,
  onFeedback,
}: {
  videoRef: RefObject<HTMLVideoElement | null>
  /** The release of a press that stayed a tap. */
  onTap: (e: React.PointerEvent<HTMLElement>) => void
  onFeedback?: (feedback: PressFeedback | null) => void
}) {
  const start = useRef<{
    x: number
    y: number
    at: number
    height: number
    volume: number
    region: SwipeRegion
  } | null>(null)
  const progress = useRef<PressProgress>(PRESS_START)
  /** Last known travel, so the hold timer can re-ask the classifier. */
  const travel = useRef({ dx: 0, dy: 0 })
  const holdTimer = useRef<number | undefined>(undefined)
  /**
   * The rate to go back to. Read off the element rather than assumed to be 1:
   * someone watching at 1.25× has to get 1.25× back, not a silent reset.
   */
  const restoreRate = useRef<number | null>(null)

  // Same reason as in `useTapGestures`: these go straight onto the video
  // element, so the handlers have to keep one identity for the whole session.
  const cbs = useRef({ onTap, onFeedback })
  cbs.current = { onTap, onFeedback }

  useEffect(() => () => window.clearTimeout(holdTimer.current), [])

  const beginHold = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    restoreRate.current = video.playbackRate || 1
    video.playbackRate = HOLD_RATE
    cbs.current.onFeedback?.({ kind: 'speed', rate: HOLD_RATE })
  }, [videoRef])

  const endHold = useCallback(() => {
    const video = videoRef.current
    if (video && restoreRate.current != null) video.playbackRate = restoreRate.current
    restoreRate.current = null
  }, [videoRef])

  /** Move the press to its new state and act on whatever it just became. */
  const commit = useCallback(
    (next: PressProgress) => {
      const previous = progress.current
      progress.current = next
      if (previous.kind === next.kind) return
      // A finger that is travelling is not resting on the glass.
      if (next.kind === 'swipe') window.clearTimeout(holdTimer.current)
      if (next.kind === 'hold') beginHold()
    },
    [beginHold],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' || e.button !== 0) return

      const rect = e.currentTarget.getBoundingClientRect()
      const video = videoRef.current
      start.current = {
        x: e.clientX,
        y: e.clientY,
        at: e.timeStamp,
        height: rect.height,
        volume: video?.muted ? 0 : (video?.volume ?? 1),
        region: swipeRegion(e.clientX - rect.left, rect.width),
      }
      progress.current = PRESS_START
      travel.current = { dx: 0, dy: 0 }

      /*
        Capture, so a drag that wanders off the video — over the control bar,
        or past the edge of the screen — keeps reporting. Without it the volume
        stuck wherever the finger crossed the boundary. It throws if the
        pointer has already gone, which is not worth failing the gesture over.
      */
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* the pointer is already gone; the gesture simply ends early */
      }

      window.clearTimeout(holdTimer.current)
      /*
        The deadline is a timer and not something checked on the next move,
        because a press-and-hold produces no further events at all — waiting
        for one would mean the speed only ever changed if the finger twitched.
      */
      holdTimer.current = window.setTimeout(() => {
        commit(advancePress(progress.current, { ...travel.current, elapsedMs: LONG_PRESS_MS }))
      }, LONG_PRESS_MS)
    },
    [commit, videoRef],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const from = start.current
      if (!from || e.pointerType !== 'touch') return

      const dx = e.clientX - from.x
      const dy = e.clientY - from.y
      travel.current = { dx, dy }
      commit(advancePress(progress.current, { dx, dy, elapsedMs: e.timeStamp - from.at }))

      const now = progress.current
      if (now.kind !== 'swipe' || now.axis !== 'vertical' || from.region !== 'volume') return

      const video = videoRef.current
      if (!video) return
      const level = volumeAfterDrag(from.volume, dy, from.height)
      /*
        `volume` is read-only on iOS: this assignment is accepted and then
        ignored, so the gesture does nothing there. The pill reports what the
        element says afterwards rather than what was asked for, so it stays
        honest until the WebAudio gain path lands.
      */
      video.volume = level
      // Swiping up is also an unmute — a climbing pill over silence reads as
      // the gesture having failed.
      video.muted = level === 0
      cbs.current.onFeedback?.({ kind: 'volume', level: video.muted ? 0 : video.volume })
    },
    [commit, videoRef],
  )

  const finish = useCallback(
    (e: React.PointerEvent<HTMLElement>, deliver: boolean) => {
      window.clearTimeout(holdTimer.current)
      const final = progress.current
      if (final.kind === 'hold') endHold()
      if (final.kind !== 'tap') cbs.current.onFeedback?.(null)

      start.current = null
      progress.current = PRESS_START

      if (deliver && firesTap(final)) cbs.current.onTap(e)
    },
    [endHold],
  )

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => finish(e, true),
    [finish],
  )

  /*
    A cancel is the browser taking the pointer away — a phone call, a system
    edge swipe. Whatever the press had become has to be undone, and nothing at
    all should be delivered: the viewer never finished the gesture.
  */
  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => finish(e, false),
    [finish],
  )

  return useMemo(
    () => ({ onPointerDown, onPointerMove, onPointerUp, onPointerCancel }),
    [onPointerDown, onPointerMove, onPointerUp, onPointerCancel],
  )
}
