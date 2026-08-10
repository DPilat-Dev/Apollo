import { describe, expect, it } from 'vitest'
import { bestOffsetMs, delayUntil, sampleFromExchange, serverNow } from '../timeSync'

const iso = (ms: number) => new Date(ms).toISOString()

describe('sampleFromExchange', () => {
  it('reads zero offset when the clocks agree and delay is symmetric', () => {
    // Client sends at 1000, server handles at 1050, client receives at 1100.
    const s = sampleFromExchange(1000, iso(1050), iso(1050), 1100)!
    expect(s.offsetMs).toBe(0)
    expect(s.roundTripMs).toBe(100)
  })

  it('recovers a known offset regardless of the delay', () => {
    // Server clock runs 5000 ms ahead; 100 ms round trip.
    const s = sampleFromExchange(1000, iso(6050), iso(6050), 1100)!
    expect(s.offsetMs).toBe(5000)
  })

  it('recovers a negative offset', () => {
    const s = sampleFromExchange(10_000, iso(7050), iso(7050), 10_100)!
    expect(s.offsetMs).toBe(-3000)
  })

  it('excludes server processing time from the round trip', () => {
    // 100 ms on the wire, but the server held it for 40 ms.
    const s = sampleFromExchange(1000, iso(1030), iso(1070), 1100)!
    expect(s.roundTripMs).toBe(60)
    expect(s.offsetMs).toBe(0)
  })

  it('returns null rather than NaN for unparseable timestamps', () => {
    expect(sampleFromExchange(1000, 'not-a-date', iso(1050), 1100)).toBeNull()
    expect(sampleFromExchange(1000, iso(1050), '', 1100)).toBeNull()
  })
})

describe('bestOffsetMs', () => {
  it('trusts the fastest exchange, not the average', () => {
    // The slow sample is wildly wrong; averaging would import its error.
    const samples = [
      { offsetMs: 5000, roundTripMs: 20 },
      { offsetMs: 5400, roundTripMs: 800 },
      { offsetMs: 4600, roundTripMs: 750 },
    ]
    expect(bestOffsetMs(samples)).toBe(5000)
  })

  it('falls back to no correction when there is nothing usable', () => {
    expect(bestOffsetMs([])).toBe(0)
    expect(bestOffsetMs([{ offsetMs: NaN, roundTripMs: 10 }])).toBe(0)
  })
})

describe('delayUntil', () => {
  it('waits the remaining time, measured on the server clock', () => {
    // Local clock is 5000 ms behind. Server says act at 20000 server-time.
    // Locally that is 15000, and it is locally 14000 now, so wait 1000.
    expect(delayUntil(iso(20_000), 5000, 14_000)).toBe(1000)
  })

  it('never schedules into the past', () => {
    expect(delayUntil(iso(1000), 0, 9000)).toBe(0)
  })

  it('acts immediately on an unparseable time rather than hanging', () => {
    expect(delayUntil('nonsense', 0, 1000)).toBe(0)
  })

  it('agrees with serverNow', () => {
    expect(serverNow(250, 1000)).toBe(1250)
    expect(delayUntil(iso(1250), 250, 1000)).toBe(0)
    expect(delayUntil(iso(1350), 250, 1000)).toBe(100)
  })
})
