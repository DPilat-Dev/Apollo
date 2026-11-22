import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CACHE_KEY,
  CEILING_BPS,
  FLOOR_BPS,
  cachePayload,
  measureBitrate,
  parseCache,
  type ProbeResult,
} from './bandwidth'
import { useApi } from './auth'

/**
 * The measured ceiling for Auto.
 *
 * The hook is the impure half of `bandwidth.ts`: it owns the session cache, the
 * abort when the player is left mid-probe, and the one-at-a-time guard. The
 * arithmetic it defers to is pure and tested.
 *
 * `enabled` is Auto. On a manual quality there is nothing to measure, and
 * measuring anyway would spend someone's connection on a number no one reads.
 *
 * `key` is the item being played, and it is what makes a measurement per
 * *episode* rather than per player. /watch/:id keeps one component across a
 * whole binge, so without it the figure measured before episode one would
 * still be in force six episodes later. With it, each episode re-reads the
 * cache: inside the TTL that is the same number and no new probe, and outside
 * it the test runs again. Either way a step-down recorded through `note` is in
 * the cache, so the next episode opens where the last one ended up instead of
 * climbing back to a ceiling that has already been disproved.
 */
export interface BandwidthState {
  /** The ceiling to ask for, in bits/sec, or null until there is one. */
  bps: number | null
  /** A probe is in flight and there is no figure to use yet. */
  measuring: boolean
  /** False while `FALLBACK_BPS` is standing in for a test that failed. */
  measured: boolean
  /**
   * Record a lower figure — a step-down from buffering — as the one to open
   * with from here. Evidence from a stall beats a projection from a probe.
   */
  note: (bps: number) => void
}

function readCache(now: number): number | null {
  try {
    return parseCache(sessionStorage.getItem(CACHE_KEY), now)
  } catch {
    // Private windows and locked-down profiles throw on access rather than
    // answering null. A measurement per player open is a fine degradation.
    return null
  }
}

function writeCache(bps: number, now: number) {
  try {
    sessionStorage.setItem(CACHE_KEY, cachePayload(bps, now))
  } catch {
    /* As above: the cache is an optimisation, not the feature. */
  }
}

interface Seed {
  key: string | null
  bps: number | null
  measured: boolean
}

function seed(key: string | null): Seed {
  const cached = readCache(Date.now())
  return { key, bps: cached, measured: cached != null }
}

export function useBandwidth(enabled: boolean, key: string | null): BandwidthState {
  const api = useApi()
  const [state, setState] = useState<Seed>(() => seed(key))
  // React's own recipe for a value derived from a prop: compare in render and
  // re-seed, rather than clearing in an effect and rendering the old episode's
  // figure once in between.
  if (state.key !== key) setState(seed(key))

  /*
    Two probes at once would each measure half the connection and the loser
    would overwrite the winner. A ref, not state, because the guard has to hold
    before the next render.
  */
  const runningRef = useRef(false)

  useEffect(() => {
    if (!enabled || state.bps != null || state.key !== key || runningRef.current) return
    runningRef.current = true
    const controller = new AbortController()
    let cancelled = false

    const probe = (size: number): Promise<ProbeResult> => api.bitrateTest(size, controller.signal)

    void measureBitrate(probe)
      .then(({ bps, measured }) => {
        if (cancelled) return
        setState({ key, bps, measured })
        // Only a real measurement is worth remembering; caching the fallback
        // would hide a server that has started answering again.
        if (measured) writeCache(bps, Date.now())
      })
      .finally(() => {
        runningRef.current = false
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [api, enabled, key, state.bps, state.key])

  const note = useCallback((bps: number) => {
    if (!Number.isFinite(bps) || bps < FLOOR_BPS || bps > CEILING_BPS) return
    setState((prev) => ({ ...prev, bps, measured: true }))
    writeCache(bps, Date.now())
  }, [])

  return {
    bps: state.bps,
    measuring: enabled && state.bps == null,
    measured: state.measured,
    note,
  }
}
