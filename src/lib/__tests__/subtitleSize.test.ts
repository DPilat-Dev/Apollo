import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SUBTITLE_SIZE,
  SUBTITLE_SIZE_RANGE,
  SUBTITLE_SIZE_STEP,
  clampSubtitleSize,
} from '../settings'

/*
  Subtitle size is now changed from two places — the Settings slider and the
  player's own menu. A range enforced by only one of them is a range the other
  can walk straight past, and the slider cannot bring a value back that sits
  outside its own min and max.
*/
describe('clampSubtitleSize', () => {
  it('leaves an ordinary size alone', () => {
    expect(clampSubtitleSize(100)).toBe(100)
    expect(clampSubtitleSize(150)).toBe(150)
  })

  it('holds the ends the slider can reach', () => {
    expect(clampSubtitleSize(SUBTITLE_SIZE_RANGE.min)).toBe(SUBTITLE_SIZE_RANGE.min)
    expect(clampSubtitleSize(SUBTITLE_SIZE_RANGE.max)).toBe(SUBTITLE_SIZE_RANGE.max)
  })

  it('refuses to go past them', () => {
    expect(clampSubtitleSize(0)).toBe(SUBTITLE_SIZE_RANGE.min)
    expect(clampSubtitleSize(-40)).toBe(SUBTITLE_SIZE_RANGE.min)
    expect(clampSubtitleSize(9999)).toBe(SUBTITLE_SIZE_RANGE.max)
  })

  it('falls back to the default rather than storing nonsense', () => {
    // A NaN reaching the stylesheet produces no font-size rule at all, and the
    // subtitles quietly revert with nothing to explain it.
    expect(clampSubtitleSize(Number.NaN)).toBe(DEFAULT_SUBTITLE_SIZE)
    expect(clampSubtitleSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SUBTITLE_SIZE)
  })

  it('rounds, so a step never leaves a fraction behind', () => {
    expect(clampSubtitleSize(100.4)).toBe(100)
    expect(clampSubtitleSize(100.6)).toBe(101)
  })

  it('steps land on the range ends exactly, from the default', () => {
    // Both ends are reachable by stepping, so neither is a value only the
    // slider can produce.
    expect((DEFAULT_SUBTITLE_SIZE - SUBTITLE_SIZE_RANGE.min) % SUBTITLE_SIZE_STEP).toBe(0)
    expect((SUBTITLE_SIZE_RANGE.max - DEFAULT_SUBTITLE_SIZE) % SUBTITLE_SIZE_STEP).toBe(0)
  })
})
