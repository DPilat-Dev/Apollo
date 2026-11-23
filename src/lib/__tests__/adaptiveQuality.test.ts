import { describe, expect, it } from 'vitest'
import {
  LONG_STALL_MS,
  REPEATED_STALLS,
  STALL_WINDOW_MS,
  assessStalls,
  countsAgainstQuality,
  dropMessage,
  nextStepDown,
  recentStalls,
  type Stall,
} from '../adaptiveQuality'
import { BITRATE_OPTIONS } from '../settings'

const NOW = 1_700_000_000_000
const ladder = BITRATE_OPTIONS.map((o) => o.value).filter((v) => v > 0)

const stall = (over: Partial<Stall> = {}): Stall => ({
  at: NOW,
  durationMs: 1200,
  cause: 'playback',
  ...over,
})

describe('what counts as evidence', () => {
  it('counts a stall during playback', () => {
    expect(countsAgainstQuality(stall())).toBe(true)
  })

  it("does not count a seek's own buffering", () => {
    // Otherwise scrubbing through an episode walks the quality down on a
    // connection that was never in trouble.
    expect(countsAgainstQuality(stall({ cause: 'seek' }))).toBe(false)
  })

  it('does not count the file opening', () => {
    expect(countsAgainstQuality(stall({ cause: 'startup' }))).toBe(false)
  })
})

describe('assessStalls', () => {
  it('leaves one ordinary stall alone', () => {
    // Any one stall is ordinary. Dropping the quality for it would mean every
    // episode ends two rungs below where it started.
    expect(assessStalls([stall()], NOW)).toEqual({ drop: false, reason: null })
  })

  it('drops after repeated stalls inside the window', () => {
    const three = Array.from({ length: REPEATED_STALLS }, (_, i) =>
      stall({ at: NOW - i * 10_000 }),
    )
    expect(assessStalls(three, NOW)).toEqual({ drop: true, reason: 'repeated' })
  })

  it('does not drop when the same stalls are spread out', () => {
    const spread = Array.from({ length: REPEATED_STALLS }, (_, i) =>
      stall({ at: NOW - i * (STALL_WINDOW_MS + 1000) }),
    )
    expect(assessStalls(spread, NOW).drop).toBe(false)
  })

  it('drops on one long freeze without waiting for two more', () => {
    // A five-second freeze is not a dip, and waiting for the pattern would
    // cost two more minutes of someone's evening.
    expect(assessStalls([stall({ durationMs: LONG_STALL_MS })], NOW)).toEqual({
      drop: true,
      reason: 'long',
    })
  })

  it('still ignores a long freeze caused by a seek', () => {
    const seeking = stall({ durationMs: LONG_STALL_MS * 3, cause: 'seek' })
    expect(assessStalls([seeking], NOW).drop).toBe(false)
  })

  it('reaches the repeated rule only on stalls that count', () => {
    const mixed = [
      stall({ cause: 'startup' }),
      stall({ cause: 'seek' }),
      stall({ at: NOW - 5_000 }),
    ]
    expect(assessStalls(mixed, NOW).drop).toBe(false)
    expect(recentStalls(mixed, NOW)).toHaveLength(1)
  })
})

describe('nextStepDown', () => {
  it('takes the next rung below the ceiling in use', () => {
    expect(nextStepDown(ladder, 10_000_000)).toBe(8_000_000)
    expect(nextStepDown(ladder, 8_000_000)).toBe(6_000_000)
  })

  it('steps down from a measured figure that is not on the ladder', () => {
    // Auto's ceiling is whatever the speed test found, so the rung below it is
    // almost never the rung above it minus one.
    expect(nextStepDown(ladder, 7_000_000)).toBe(6_000_000)
  })

  it('stops at the bottom rather than offering nothing', () => {
    expect(nextStepDown(ladder, 1_500_000)).toBeNull()
    expect(nextStepDown(ladder, 900_000)).toBeNull()
  })

  it("reads 0 as Jellyfin's no-limit, which is above every rung", () => {
    expect(nextStepDown(ladder, 0)).toBe(120_000_000)
  })

  it('has somewhere to land between 10 and 4, which is where home lines sit', () => {
    // The gap this pair of rungs was added for: a 6 Mbps line used to be
    // offered a 10 it could not carry or a 4 that wasted a third of it.
    expect(ladder).toContain(8_000_000)
    expect(ladder).toContain(6_000_000)
  })
})

describe('dropMessage', () => {
  it('names the figure, because a quietly softer picture reads as a bug', () => {
    expect(dropMessage(6_000_000)).toBe('Lowered quality to 6 Mbps — the video kept buffering.')
  })
})
