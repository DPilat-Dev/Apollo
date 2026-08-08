import { describe, expect, it } from 'vitest'
import {
  episodeCode,
  formatRuntime,
  formatTimecode,
  isResumable,
  playedFraction,
  remainingLabel,
  secondsToTicks,
  ticksToSeconds,
} from '../format'

const TICK = 10_000_000

describe('ticks', () => {
  it('round-trips seconds', () => {
    expect(ticksToSeconds(secondsToTicks(137))).toBeCloseTo(137)
  })

  it('formats runtimes without a stray 0m', () => {
    expect(formatRuntime(90 * 60 * TICK)).toBe('1h 30m')
    expect(formatRuntime(120 * 60 * TICK)).toBe('2h')
    expect(formatRuntime(45 * 60 * TICK)).toBe('45m')
    expect(formatRuntime(null)).toBeNull()
  })

  it('drops the hours field only when there are none', () => {
    expect(formatTimecode(83)).toBe('1:23')
    expect(formatTimecode(3723)).toBe('1:02:03')
    expect(formatTimecode(-5)).toBe('0:00')
    expect(formatTimecode(Number.NaN)).toBe('0:00')
  })
})

describe('progress', () => {
  const at = (pct: number) => ({ UserData: { PlayedPercentage: pct }, RunTimeTicks: 100 * TICK })

  it('treats the very start and very end as not resumable', () => {
    expect(isResumable(at(0))).toBe(false)
    expect(isResumable(at(0.5))).toBe(false)
    expect(isResumable(at(99))).toBe(false)
    expect(isResumable(at(40))).toBe(true)
  })

  it('falls back to position ticks when no percentage is given', () => {
    expect(
      playedFraction({ UserData: { PlaybackPositionTicks: 30 * TICK }, RunTimeTicks: 60 * TICK }),
    ).toBeCloseTo(0.5)
  })

  it('never reports more than fully played', () => {
    expect(playedFraction(at(150))).toBe(1)
  })

  it('describes what is left', () => {
    expect(
      remainingLabel({
        RunTimeTicks: 60 * 60 * TICK,
        UserData: { PlaybackPositionTicks: 20 * 60 * TICK },
      }),
    ).toBe('40m left')
  })
})

describe('episodeCode', () => {
  it('formats season and episode', () => {
    expect(episodeCode({ Type: 'Episode', ParentIndexNumber: 2, IndexNumber: 5 })).toBe('S2:E5')
  })

  it('copes with either number missing', () => {
    expect(episodeCode({ Type: 'Episode', IndexNumber: 5 })).toBe('E5')
    expect(episodeCode({ Type: 'Episode', ParentIndexNumber: 2 })).toBe('S2')
    expect(episodeCode({ Type: 'Episode' })).toBeNull()
  })

  it('is only for episodes', () => {
    expect(episodeCode({ Type: 'Movie', IndexNumber: 5 })).toBeNull()
  })
})
