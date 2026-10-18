import { describe, expect, it } from 'vitest'
import {
  cardLabel,
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

/*
  The badges a sighted viewer reads off a poster: the unwatched count, the
  watched tick, the time left. With only the title in the label, a series with
  three episodes to go, a film already seen and a half-watched film all
  announced as "Dune, button".
*/
describe('cardLabel', () => {
  it('counts what is left of a series', () => {
    expect(cardLabel({ Name: 'Severance', UserData: { UnplayedItemCount: 3 } })).toBe(
      'Severance, 3 unwatched',
    )
  })

  it('says a finished film is finished', () => {
    expect(cardLabel({ Name: 'Dune', UserData: { Played: true } })).toBe('Dune, watched')
  })

  // The count wins: a series with episodes left is not "watched", whatever the
  // folder's own played flag says.
  it('prefers the count to the tick', () => {
    expect(cardLabel({ Name: 'Severance', UserData: { Played: true, UnplayedItemCount: 2 } })).toBe(
      'Severance, 2 unwatched',
    )
  })

  // Only where the card shows it. Every part-watched item has a figure, and
  // "1h 12m left" on a library poster is an answer to a question nobody asked.
  it('adds the time left only for the cards that show it', () => {
    const resuming = {
      Name: 'Arrival',
      RunTimeTicks: 60 * 60 * TICK,
      UserData: { PlaybackPositionTicks: 20 * 60 * TICK },
    }
    expect(cardLabel(resuming, { showProgress: true })).toBe('Arrival, 40m left')
    expect(cardLabel(resuming)).toBe('Arrival')
  })

  it('is just the title when there is nothing else to say', () => {
    expect(cardLabel({ Name: 'Dune' })).toBe('Dune')
    expect(cardLabel({ Type: 'Episode', SeriesName: 'Severance', Name: 'Good News' })).toBe(
      'Severance',
    )
  })
})
