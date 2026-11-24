import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ensureMeasurement, readMeasurement } from '../useBandwidth'
import { PROBE_SIZES } from '../bandwidth'
import type { JellyfinApi } from '../api'

/*
  Pressing "Test connection" has to actually test the connection.

  Everywhere else in Auto the ten-minute cache is the feature: episode two of a
  binge must not re-measure. On a button somebody pressed it is the opposite —
  answering instantly with a figure from nine minutes ago is indistinguishable
  from a button that does nothing, and the one moment a person wants a fresh
  measurement is right after they changed something about their network.

  The cache gets a stub rather than the environment's own `sessionStorage`:
  some Node builds provide one and some do not, and these tests are entirely
  about what is in it.
*/
function stubSessionStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  })
}

beforeEach(stubSessionStorage)
afterEach(() => vi.unstubAllGlobals())

/** An api whose probe resolves only when told to. */
function fakeApi() {
  const asked: number[] = []
  let release: (() => void) | null = null
  const api = {
    bitrateTest: (size: number) => {
      asked.push(size)
      return new Promise<{ bytes: number; elapsedMs: number }>((resolve) => {
        release = () => resolve({ bytes: size, elapsedMs: 1_000 })
      })
    },
  } as unknown as JellyfinApi
  return { api, asked, release: () => release?.() }
}

async function measure(force = false) {
  const { api, asked, release } = fakeApi()
  const run = ensureMeasurement(api, force ? { force: true } : undefined)
  release()
  return { result: await run, asked }
}

describe('a measurement somebody asked for', () => {
  it('ignores a figure the cache would have answered with', async () => {
    await measure()
    const { asked } = await measure(true)
    expect(asked).toEqual([PROBE_SIZES[0]])
  })

  it('still answers from the cache when nobody forced it', async () => {
    await measure()
    const { asked } = await measure()
    // The binge case, unchanged: the button is the only thing that re-tests.
    expect(asked).toEqual([])
  })

  it('writes what it measured, so playback uses the figure that was shown', async () => {
    await measure()
    const { result } = await measure(true)
    // Otherwise the page reports one number and the player opens at another,
    // and the next episode contradicts the test that was just run.
    expect(readMeasurement()?.bps).toBe(result.bps)
  })

  it('joins a test already running instead of downloading twice at once', async () => {
    const { api, asked, release } = fakeApi()
    const warmup = ensureMeasurement(api)
    const pressed = ensureMeasurement(api, { force: true })
    release()
    const [a, b] = await Promise.all([warmup, pressed])
    expect(a).toEqual(b)
    expect(asked).toEqual([PROBE_SIZES[0]])
  })

  it('reports the raw speed as well as the ceiling Auto will ask for', async () => {
    const { result } = await measure(true)
    // 500 KB in a second. The page shows both figures because showing only
    // the ceiling makes a 30% haircut look like a measurement that is wrong.
    expect(result.rawBps ?? 0).toBeCloseTo(4_000_000, -3)
    expect(result.bps).toBeLessThan(result.rawBps ?? 0)
  })
})

describe('readMeasurement', () => {
  it('has nothing to report before any test has run', () => {
    expect(readMeasurement()).toBeNull()
  })

  it('reports the stored figure and when it was taken', async () => {
    const before = Date.now()
    const { result } = await measure()
    const stored = readMeasurement()
    expect(stored?.bps).toBe(result.bps)
    expect(stored?.at).toBeGreaterThanOrEqual(before)
    expect(stored?.at).toBeLessThanOrEqual(Date.now())
  })
})
