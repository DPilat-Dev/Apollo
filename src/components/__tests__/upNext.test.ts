import { describe, expect, it } from 'vitest'
import { progressPercent, UP_NEXT_AT, UP_NEXT_MAX, upNextLeadSeconds } from '../UpNext'

describe('upNextLeadSeconds', () => {
  it('falls back to a fixed lead when nothing detected the credits', () => {
    expect(upNextLeadSeconds(1400, null)).toBe(UP_NEXT_AT)
  })

  it('appears as the credits start when that is earlier', () => {
    // A 23-minute episode whose credits roll at 22:20.
    expect(upNextLeadSeconds(1400, 1340)).toBe(60)
  })

  it('never appears later than the fallback for a short credit roll', () => {
    // Ten seconds of credits is not enough warning on its own.
    expect(upNextLeadSeconds(1400, 1390)).toBe(UP_NEXT_AT)
  })

  it('caps a misdetected outro that covers half the episode', () => {
    expect(upNextLeadSeconds(2400, 600)).toBe(UP_NEXT_MAX)
  })

  it('caps proportionally on a short item, where the flat cap is most of it', () => {
    // 25% of six minutes is 90s, tighter than the 120s ceiling.
    expect(upNextLeadSeconds(360, 0)).toBe(90)
  })

  it('still allows the fallback when a quarter of the item is less than it', () => {
    // A two-minute item: 25% is 30s, but 45s is the floor either way.
    expect(upNextLeadSeconds(120, 0)).toBe(UP_NEXT_AT)
  })

  it('is defensive about a duration that has not loaded', () => {
    expect(upNextLeadSeconds(0, 100)).toBe(UP_NEXT_AT)
    expect(upNextLeadSeconds(Number.NaN, 100)).toBe(UP_NEXT_AT)
  })
})

describe('progressPercent', () => {
  it('fills across exactly the window the card is visible for', () => {
    expect(progressPercent(60, 60)).toBe(0)
    expect(progressPercent(30, 60)).toBe(50)
    expect(progressPercent(0, 60)).toBe(100)
  })

  it('clamps rather than overshooting past either end', () => {
    expect(progressPercent(90, 60)).toBe(0)
    expect(progressPercent(-5, 60)).toBe(100)
  })

  it('shows an empty bar rather than dividing by a missing window', () => {
    expect(progressPercent(10, 0)).toBe(0)
  })
})
