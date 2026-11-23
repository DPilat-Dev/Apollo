import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureMeasurement } from '../useBandwidth'
import { CACHE_KEY, FALLBACK_BPS, MEASUREMENT_BUDGET_MS, PROBE_SIZES } from '../bandwidth'
import type { JellyfinApi } from '../api'

/*
  The impure half: one test at a time, and a hard stop on how long it may take.

  Both of these are about the same symptom. Playback waits for this figure, so
  a measurement that runs twice, or one that never finishes, is a player that
  never starts — which is exactly what 1.17.0 did behind a slow proxy.

  Node does provide `sessionStorage`, so the cache is real here and carries
  between tests — which is itself worth knowing, since a cached figure
  short-circuits the whole function.
*/
beforeEach(() => sessionStorage.removeItem(CACHE_KEY))
afterEach(() => vi.useRealTimers())

/** An api whose probe resolves when told, and rejects when aborted. */
function fakeApi() {
  const asked: number[] = []
  let release: (() => void) | null = null
  const api = {
    bitrateTest: (size: number, signal?: AbortSignal) => {
      asked.push(size)
      return new Promise<{ bytes: number; elapsedMs: number }>((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('aborted')))
        release = () => resolve({ bytes: size, elapsedMs: 1_000 })
      })
    },
  } as unknown as JellyfinApi
  return { api, asked, release: () => release?.() }
}

describe('ensureMeasurement', () => {
  it('runs one test however many callers want the answer', async () => {
    const { api, asked, release } = fakeApi()
    const first = ensureMeasurement(api)
    const second = ensureMeasurement(api)
    expect(asked).toEqual([PROBE_SIZES[0]])
    release()
    const [a, b] = await Promise.all([first, second])
    // The warm-up and the player are separate components. Two tests at once
    // measure half the connection each and race to write the result.
    expect(a).toEqual(b)
    expect(asked.filter((size) => size === PROBE_SIZES[0])).toHaveLength(1)
  })

  it('gives up at the deadline instead of holding playback open', async () => {
    vi.useFakeTimers()
    const { api } = fakeApi() // never released: the probe simply never answers
    const pending = ensureMeasurement(api)
    await vi.advanceTimersByTimeAsync(MEASUREMENT_BUDGET_MS + 10)
    const result = await pending
    expect(result).toEqual({ bps: FALLBACK_BPS, measured: false })
  })

  it('answers from the cache without touching the network', async () => {
    const { api, asked, release } = fakeApi()
    const first = ensureMeasurement(api)
    release()
    const measured = await first
    const second = await ensureMeasurement(api)
    // The whole point of the ten-minute cache: episode two does not re-test.
    expect(second).toEqual({ bps: measured.bps, measured: true })
    expect(asked).toHaveLength(1)
  })

  it('is ready for the next caller once a test has ended', async () => {
    const { api, asked, release } = fakeApi()
    const first = ensureMeasurement(api)
    release()
    await first
    sessionStorage.removeItem(CACHE_KEY) // as the ten-minute expiry would
    const { api: second, asked: askedAgain, release: releaseAgain } = fakeApi()
    const run = ensureMeasurement(second)
    releaseAgain()
    await run
    // Otherwise the first measurement of a session would be the only one, and
    // the ten-minute expiry would never produce a fresh figure.
    expect(asked.length).toBeGreaterThan(0)
    expect(askedAgain).toContain(PROBE_SIZES[0])
  })
})
