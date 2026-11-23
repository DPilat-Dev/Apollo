import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CACHE_KEY,
  CEILING_BPS,
  FLOOR_BPS,
  MEASUREMENT_BUDGET_MS,
  cachePayload,
  measureBitrate,
  parseCache,
  type Measurement,
  type ProbeResult,
} from './bandwidth'
import type { JellyfinApi } from './api'
import { useApi } from './auth'

/**
 * The measured ceiling for Auto.
 *
 * This is the impure half of `bandwidth.ts`: it owns the session cache, the
 * deadline, and the guarantee that one measurement runs at a time no matter
 * how many callers want one. The arithmetic it defers to is pure and tested.
 *
 * Playback waits for this figure — resolving the stream first and re-resolving
 * when it lands would start the unlimited transcode the whole feature exists
 * to stop, then throw it away — so every delay here is a black screen somebody
 * is looking at. Two things keep that from being felt:
 *
 * - `warmBandwidth` runs the test when the app opens, so by the time anyone
 *   presses play the figure is usually already in hand.
 * - `MEASUREMENT_BUDGET_MS` is a hard stop. A probe through a slow proxy, or
 *   one a server never finishes, is aborted and whatever was measured — or the
 *   fallback — is used instead. Nothing can block playback indefinitely.
 */

/**
 * One measurement at a time, shared across every caller.
 *
 * Module scope rather than a ref: the warm-up and the player are separate
 * components and would otherwise each start their own test, measuring half the
 * connection each and racing to write the result.
 */
let inFlight: Promise<Measurement> | null = null

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

/**
 * The measurement, run if there isn't a fresh one already.
 *
 * The timer is the part that matters: it aborts the fetch rather than merely
 * giving up on waiting for it, because an abandoned 8 MB download on a
 * struggling connection competes with the video that is about to start.
 */
export function ensureMeasurement(api: JellyfinApi): Promise<Measurement> {
  const cached = readCache(Date.now())
  if (cached != null) return Promise.resolve({ bps: cached, measured: true })
  if (inFlight) return inFlight

  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), MEASUREMENT_BUDGET_MS)

  inFlight = measureBitrate((size: number): Promise<ProbeResult> =>
    api.bitrateTest(size, controller.signal),
  )
    .then((result) => {
      // Only a real measurement is worth remembering; caching the fallback
      // would hide a server that has started answering again.
      if (result.measured) writeCache(result.bps, Date.now())
      return result
    })
    .finally(() => {
      clearTimeout(deadline)
      inFlight = null
    })

  return inFlight
}

/**
 * Run the test when the app opens, so the player rarely has to wait for it.
 *
 * Deliberately not awaited by anything and deliberately silent: if it fails,
 * the player runs its own and takes the delay, which is the behaviour this
 * exists to make rare rather than the behaviour it replaces.
 */
export function useBandwidthWarmup(api: JellyfinApi | null, signedIn: boolean) {
  useEffect(() => {
    // `api` is null before sign-in; `App` renders this above the auth gate.
    if (!signedIn || !api) return
    /*
      Behind a timeout, not run on the spot: the first seconds after the app
      opens are spent fetching the home screen's rows and its artwork, and a
      speed test competing with them would both delay those and measure the
      connection while it is busy — reading low, which is the one error that
      costs picture quality.
    */
    const timer = setTimeout(() => void ensureMeasurement(api).catch(() => {}), 4_000)
    return () => clearTimeout(timer)
  }, [api, signedIn])
}

export interface BandwidthState {
  /** The ceiling to ask for, in bits/sec, or null until there is one. */
  bps: number | null
  /** The test is running and there is no figure to use yet. */
  measuring: boolean
  /** False while `FALLBACK_BPS` is standing in for a test that failed. */
  measured: boolean
  /**
   * Record a lower figure — a step-down from buffering — as the one to open
   * with from here. Evidence from a stall beats a projection from a probe.
   */
  note: (bps: number) => void
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

/**
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
export function useBandwidth(enabled: boolean, key: string | null): BandwidthState {
  const api = useApi()
  const [state, setState] = useState<Seed>(() => seed(key))
  // React's own recipe for a value derived from a prop: compare in render and
  // re-seed, rather than clearing in an effect and rendering the old episode's
  // figure once in between.
  if (state.key !== key) setState(seed(key))

  const noteRef = useRef(false)

  useEffect(() => {
    if (!enabled || state.bps != null || state.key !== key) return
    let cancelled = false
    void ensureMeasurement(api).then(({ bps, measured }) => {
      // A step-down landing mid-probe outranks the probe: it is evidence from
      // this stream rather than a projection made before it started.
      if (cancelled || noteRef.current) return
      setState({ key, bps, measured })
    })
    return () => {
      cancelled = true
    }
  }, [api, enabled, key, state.bps, state.key])

  const note = useCallback((bps: number) => {
    if (!Number.isFinite(bps) || bps < FLOOR_BPS || bps > CEILING_BPS) return
    noteRef.current = true
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
