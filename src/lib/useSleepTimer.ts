import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  extendSleepTimer,
  sleepTimerStatus,
  startDurationTimer,
  startEpisodeTimer,
  type PlaybackSample,
  type SleepTimer,
  type SleepTimerStatus,
} from './sleepTimer'

export interface SleepTimerHandle {
  timer: SleepTimer | null
  status: SleepTimerStatus
  startDuration: (minutes: number) => void
  startEpisode: () => void
  /** Grant the extension the "still watching?" prompt offered. */
  extend: () => void
  cancel: () => void
  /** Stop now and disarm — for the case where the item ends first. */
  fire: () => void
}

/**
 * Runs a sleep timer against the player.
 *
 * Every decision lives in `sleepTimer.ts`; this only feeds it a fresh sample
 * and acts on the answer. The one piece of real machinery is the interval:
 * `timeupdate` stops arriving the moment playback pauses, and a duration timer
 * has to keep counting through that — a countdown frozen because someone
 * paused to answer a message would never fire, and the screen would stay lit
 * all night, which is the exact failure this feature exists to prevent.
 */
export function useSleepTimer({
  itemId,
  positionSeconds,
  durationSeconds,
  onFire,
}: {
  itemId: string | null
  positionSeconds: number
  durationSeconds: number
  /** What "the timer is up" does. Pausing only — never navigating away. */
  onFire: () => void
}): SleepTimerHandle {
  const [timer, setTimer] = useState<SleepTimer | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())

  useEffect(() => {
    if (!timer) return
    // Re-read on arm as well as on tick: a timer set between ticks would
    // otherwise be measured against an up-to-a-second-old clock.
    setNowMs(Date.now())
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [timer])

  const sample = useMemo<PlaybackSample>(
    () => ({ nowMs, itemId, positionSeconds, durationSeconds }),
    [nowMs, itemId, positionSeconds, durationSeconds],
  )
  const sampleRef = useRef(sample)
  sampleRef.current = sample

  const status = useMemo(() => sleepTimerStatus(timer, sample), [timer, sample])

  // Held in a ref so a caller that rebuilds its handler every render — which
  // the player does, on every `timeupdate` — cannot re-run the firing effect.
  const onFireRef = useRef(onFire)
  onFireRef.current = onFire

  const fire = useCallback(() => {
    setTimer(null)
    onFireRef.current()
  }, [])

  useEffect(() => {
    if (!status.expired) return
    fire()
  }, [status.expired, fire])

  const startDuration = useCallback((minutes: number) => {
    setTimer(startDurationTimer(minutes, Date.now()))
  }, [])

  const startEpisode = useCallback(() => setTimer(startEpisodeTimer()), [])
  const cancel = useCallback(() => setTimer(null), [])
  const extend = useCallback(() => {
    setTimer((current) => extendSleepTimer(current, sampleRef.current))
  }, [])

  return { timer, status, startDuration, startEpisode, extend, cancel, fire }
}
