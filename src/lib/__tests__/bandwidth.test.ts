import { describe, expect, it, vi } from 'vitest'
import {
  CEILING_BPS,
  FALLBACK_BPS,
  FLOOR_BPS,
  HEADROOM,
  MEASUREMENT_BUDGET_MS,
  MEASUREMENT_TTL_MS,
  PROBE_BUDGET_MS,
  PROBE_SIZES,
  autoQualityLabel,
  bitsPerSecond,
  cachePayload,
  formatMbps,
  measureBitrate,
  nextProbeSize,
  parseCache,
  withHeadroom,
} from '../bandwidth'

/** A probe that serves `size` bytes at a fixed speed. */
const atSpeed = (bps: number) => {
  const sizes: number[] = []
  const probe = async (size: number) => {
    sizes.push(size)
    return { bytes: size, elapsedMs: (size * 8 * 1000) / bps }
  }
  return { probe, sizes }
}

describe('bitsPerSecond', () => {
  it('reads a megabyte in a second as 8 Mbps', () => {
    expect(bitsPerSecond(1_000_000, 1000)).toBe(8_000_000)
  })

  it('survives a probe that reports no time at all', () => {
    // A cached or loopback-served probe can report 0ms, and dividing by it
    // would put Infinity into the stream request.
    expect(Number.isFinite(bitsPerSecond(500_000, 0))).toBe(true)
  })
})

describe('withHeadroom', () => {
  it('keeps back a share of what it measured', () => {
    // A connection measured at 10 and then asked for 10 has nothing left for
    // the dips, and the dips are what empties a buffer.
    expect(withHeadroom(10_000_000)).toBe(7_000_000)
    expect(HEADROOM).toBeLessThan(1)
  })

  it('never goes below the lowest rung the menu offers', () => {
    expect(withHeadroom(100_000)).toBe(FLOOR_BPS)
  })

  it("never goes above the server's own ceiling", () => {
    expect(withHeadroom(900_000_000)).toBe(CEILING_BPS)
  })

  it('rounds, so two runs on one connection agree', () => {
    // Otherwise 7_013_418 and 7_002_991 are two cache keys, two stream
    // resolutions and two transcodes for the same connection.
    expect(withHeadroom(10_019_169) % 100_000).toBe(0)
  })
})

describe('nextProbeSize', () => {
  it('escalates on a connection that can swallow the next size', () => {
    expect(nextProbeSize(500_000_000, PROBE_SIZES[0])).toBe(PROBE_SIZES[1])
  })

  it('stops on a connection that cannot', () => {
    // The point of the escalation: nobody on 4 Mbps should wait half a minute
    // to be told they are on 4 Mbps.
    expect(nextProbeSize(4_000_000, PROBE_SIZES[0])).toBeNull()
  })

  it('stops at the top of the list', () => {
    expect(nextProbeSize(1_000_000_000, PROBE_SIZES.at(-1)!)).toBeNull()
  })

  it('holds every escalation inside the budget', () => {
    for (const [i, size] of PROBE_SIZES.entries()) {
      const next = PROBE_SIZES[i + 1]
      if (next == null) continue
      // The slowest speed that still escalates must not blow the budget.
      const slowest = (next * 8 * 1000) / PROBE_BUDGET_MS
      expect(nextProbeSize(slowest, size)).toBe(next)
      expect(nextProbeSize(slowest * 0.99, size)).toBeNull()
    }
  })
})

describe('measureBitrate', () => {
  it('escalates on a fast line and reports the big sample', async () => {
    const { probe, sizes } = atSpeed(400_000_000)
    const result = await measureBitrate(probe)
    expect(sizes).toEqual([...PROBE_SIZES])
    expect(result.measured).toBe(true)
    expect(result.bps).toBe(withHeadroom(400_000_000))
  })

  it('stops after one probe on a slow line', async () => {
    const { probe, sizes } = atSpeed(5_000_000)
    const result = await measureBitrate(probe)
    expect(sizes).toEqual([PROBE_SIZES[0]])
    expect(result.bps).toBe(withHeadroom(5_000_000))
  })

  it('falls back when the very first probe throws', async () => {
    // An old server with no bitrate-test route, or a proxy that blocks it.
    const result = await measureBitrate(() => Promise.reject(new Error('404')))
    expect(result).toEqual({ bps: FALLBACK_BPS, measured: false })
    // Modest on purpose: guessing low costs a transcode, guessing high costs
    // the stalling this module exists to stop.
    expect(FALLBACK_BPS).toBeLessThan(20_000_000)
  })

  it('keeps what an earlier probe measured when a later one fails', async () => {
    const probe = vi.fn(async (size: number) => {
      if (size !== PROBE_SIZES[0]) throw new Error('aborted')
      return { bytes: size, elapsedMs: 10 }
    })
    const result = await measureBitrate(probe)
    expect(result.measured).toBe(true)
    expect(result.bps).toBe(withHeadroom(bitsPerSecond(PROBE_SIZES[0], 10)))
  })

  it('treats an empty body as a failure, not as a connection of zero', async () => {
    // A route answering 200 with nothing would otherwise measure as 0 bps and
    // pin every stream to the floor.
    const result = await measureBitrate(async () => ({ bytes: 0, elapsedMs: 40 }))
    expect(result).toEqual({ bps: FALLBACK_BPS, measured: false })
  })
})

describe('parseCache', () => {
  const now = 1_700_000_000_000

  it('reuses a fresh measurement', () => {
    expect(parseCache(cachePayload(7_000_000, now - 1000), now)).toBe(7_000_000)
  })

  it('drops one past its life', () => {
    // Long enough that a binge does not re-test between episodes, short enough
    // that moving from the sofa to the car is noticed.
    expect(parseCache(cachePayload(7_000_000, now - MEASUREMENT_TTL_MS - 1), now)).toBeNull()
  })

  it('drops one stamped in the future', () => {
    // A clock correction must not pin a stale figure in place for ten minutes.
    expect(parseCache(cachePayload(7_000_000, now + 60_000), now)).toBeNull()
  })

  it('ignores nothing, rubbish and the wrong shape', () => {
    expect(parseCache(null, now)).toBeNull()
    expect(parseCache('not json', now)).toBeNull()
    expect(parseCache(JSON.stringify({ bps: 'fast', at: now }), now)).toBeNull()
    expect(parseCache(JSON.stringify({ bps: 0, at: now }), now)).toBeNull()
  })
})

describe('the words on the Auto row', () => {
  it('shows the figure, because "Auto" alone looks like a setting being ignored', () => {
    expect(autoQualityLabel(7_000_000)).toBe('Auto (≈7 Mbps)')
    expect(autoQualityLabel(3_500_000)).toBe('Auto (≈3.5 Mbps)')
  })

  it('says it is still testing rather than showing nothing', () => {
    expect(autoQualityLabel(null, true)).toMatch(/testing/)
  })

  it('no longer claims "no limit", which is what it used to do', () => {
    expect(autoQualityLabel(null)).toBe('Auto')
  })

  it('rounds the way people read speeds', () => {
    expect(formatMbps(1_500_000)).toBe('1.5 Mbps')
    expect(formatMbps(20_000_000)).toBe('20 Mbps')
    expect(formatMbps(120_000_000)).toBe('120 Mbps')
  })
})

describe('the budget', () => {
  it('stops escalating once the test has spent its time', async () => {
    // The projection per probe bounds what the *next* download should cost;
    // this bounds what the whole test has actually cost. Without it a fast
    // first probe and a slow second one still reached the third.
    let clock = 0
    const sizes: number[] = []
    const result = await measureBitrate(
      async (size) => {
        sizes.push(size)
        clock += 2_990 // the first probe alone eats nearly the whole budget
        return { bytes: size, elapsedMs: 5 }
      },
      { now: () => clock, budgetMs: MEASUREMENT_BUDGET_MS },
    )
    expect(sizes).toEqual([PROBE_SIZES[0]])
    expect(result.measured).toBe(true)
  })

  it('never downloads more than the top probe allows', () => {
    // The whole test runs on someone's connection, possibly a metered one.
    const total = PROBE_SIZES.reduce((sum, size) => sum + size, 0)
    expect(total).toBeLessThanOrEqual(13_000_000)
  })
})
