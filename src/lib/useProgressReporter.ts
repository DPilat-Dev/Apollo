import { useEffect, useRef } from 'react'
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
  isPaused: () => boolean
}

/**
 * Keeps the server's "continue watching" state in sync: one start report, a
 * heartbeat while playing, and a stop report on unmount or tab close.
 */
export function useProgressReporter({ api, itemId, plan, positionSeconds, isPaused }: Args) {
  // Held in refs so the effect below can stay keyed only on the stream identity.
  const posRef = useRef(positionSeconds)
  const pausedRef = useRef(isPaused)
  posRef.current = positionSeconds
  pausedRef.current = isPaused

  useEffect(() => {
    if (!itemId || !plan) return

    const base = () => ({
      ItemId: itemId,
      MediaSourceId: plan.mediaSource.Id,
      PlaySessionId: plan.playSessionId,
      PlayMethod: plan.playMethod,
      PositionTicks: secondsToTicks(posRef.current()),
      IsPaused: pausedRef.current(),
      CanSeek: true,
    })

    void api.reportStart(base()).catch(() => {})

    const timer = setInterval(() => {
      void api.reportProgress(base()).catch(() => {})
    }, REPORT_INTERVAL_MS)

    // sendBeacon survives the page teardown that a normal fetch would not.
    const beaconStop = () => {
      const url = api.url('/Sessions/Playing/Stopped', { api_key: api.session.token })
      const body = new Blob([JSON.stringify(base())], { type: 'application/json' })
      navigator.sendBeacon(url, body)
    }
    window.addEventListener('pagehide', beaconStop)

    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', beaconStop)
      void api.reportStopped(base()).catch(() => {})
    }
  }, [api, itemId, plan])
}
