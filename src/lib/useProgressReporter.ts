import { useCallback, useEffect, useRef } from 'react'
import type { JellyfinApi } from './api'
import type { StreamPlan } from './playback'
import { secondsToTicks } from './format'

const REPORT_INTERVAL_MS = 10_000

interface Args {
  api: JellyfinApi
  itemId?: string
  plan: StreamPlan | null
  /** Absolute position in the media, already adjusted for transcode offsets. */
  positionSeconds: () => number
  /** Read as a value, not a getter: a change in it is worth a report. */
  paused: boolean
}

/**
 * Keeps the server's "continue watching" state in sync.
 *
 * ── Why there are four moments, not one ────────────────────────────────────
 *
 * A stop report on unmount is the obvious design and it loses people's places.
 * It only runs when React unmounts the player, and the two ways a viewer
 * actually leaves do not always do that: closing the tab tears the page down
 * without running cleanups, and until the fix alongside this one, the back
 * arrow could leave by loading a whole new document when the player had been
 * opened directly.
 *
 * So the position is reported when it changes in a way worth recording:
 *
 *   on start        so the server knows what is playing
 *   every 10s       while it plays
 *   on pause        immediately, rather than up to ten seconds later
 *   on hidden       switching tabs, switching apps, locking the phone
 *   on unmount      leaving the player inside the app
 *
 * `visibilitychange` is the one that does the heavy lifting for "I left": it
 * fires while the page is still alive, so an ordinary request works.
 *
 * ── What is deliberately not here ──────────────────────────────────────────
 *
 * There was a `sendBeacon` on `pagehide`, and it never worked. A beacon may
 * only send CORS-safelisted content types without a preflight, and it cannot
 * preflight; Jellyfin answers anything but `application/json` with 415. So the
 * beacon was silently dropped on every page it ever ran on. Removed rather
 * than left as a comforting no-op.
 */
export function useProgressReporter({ api, itemId, plan, positionSeconds, paused }: Args) {
  // Held in refs so the effects below stay keyed on the stream identity.
  const posRef = useRef(positionSeconds)
  const pausedRef = useRef(paused)
  posRef.current = positionSeconds
  pausedRef.current = paused

  const body = useCallback(() => {
    if (!itemId || !plan) return null
    return {
      ItemId: itemId,
      MediaSourceId: plan.mediaSource.Id,
      PlaySessionId: plan.playSessionId,
      PlayMethod: plan.playMethod,
      PositionTicks: secondsToTicks(posRef.current()),
      IsPaused: pausedRef.current,
      CanSeek: true,
    }
  }, [itemId, plan])

  const report = useCallback(() => {
    const payload = body()
    if (payload) void api.reportProgress(payload).catch(() => {})
  }, [api, body])

  useEffect(() => {
    const payload = body()
    if (!payload) return

    void api.reportStart(payload).catch(() => {})
    const timer = setInterval(report, REPORT_INTERVAL_MS)

    /*
      The page going away while it is still alive enough to ask. Covers
      switching tabs, switching apps and locking a phone — and on mobile this
      is frequently the last event a page gets, since a browser being
      backgrounded may never come back.
    */
    const onHidden = () => {
      if (document.visibilityState === 'hidden') report()
    }
    document.addEventListener('visibilitychange', onHidden)


    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onHidden)
      const last = body()
      if (last) void api.reportStopped(last).catch(() => {})
    }
  }, [api, body, report])

  /*
    Pausing is someone stopping to do something else, and often the last thing
    they do before leaving. Waiting up to ten seconds to record where they got
    to is the difference between resuming in the right place and not.
  */
  useEffect(() => {
    report()
  }, [paused, report])
}
