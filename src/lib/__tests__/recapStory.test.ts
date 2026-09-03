import { describe, expect, it } from 'vitest'
import { advance, formatStoryTime, storySlides, tapDirection } from '../recapStory'
import type { RecapStats } from '../yearRecap'

const stats = (over: Partial<RecapStats> = {}): RecapStats => ({
  year: 2026,
  itemCount: 40,
  movieCount: 4,
  episodeCount: 36,
  seriesCount: 6,
  estimatedMinutes: 900,
  itemsWithoutRuntime: 0,
  undatedCount: 0,
  topShows: [
    { key: 's1', label: 'A Show', count: 20 },
    { key: 's2', label: 'B Show', count: 10 },
    { key: 's3', label: 'C Show', count: 6 },
  ],
  topGenres: [{ key: 'Comedy', label: 'Comedy', count: 12 }],
  busiestDay: { key: '2026-08-07', label: 'Friday, 7 August', count: 9 },
  months: Array.from({ length: 12 }, () => 0),
  habits: {
    activeDays: 30,
    longestStreak: 5,
    streakStart: '2026-01-01',
    streakEnd: '2026-01-05',
    favouriteWeekday: 5,
    busiestMonth: 7,
  },
  truncated: false,
  ...over,
})

const kinds = (s: RecapStats, opts = {}) => storySlides(s, opts).map((x) => x.kind)

describe('storySlides', () => {
  it('opens and closes, whatever the year held', () => {
    const k = kinds(stats())
    expect(k[0]).toBe('opening')
    expect(k.at(-1)).toBe('closing')
  })

  it('always ends on the card that hands over to the page', () => {
    // The run is a lead-in, not a replacement — it has to arrive somewhere.
    const empty = stats({
      itemCount: 0, movieCount: 0, episodeCount: 0, seriesCount: 0, estimatedMinutes: 0,
      topShows: [], topGenres: [], busiestDay: null,
      habits: { activeDays: 0, longestStreak: 0, streakStart: null, streakEnd: null, favouriteWeekday: null, busiestMonth: null },
    })
    expect(kinds(empty)).toEqual(['opening', 'closing'])
  })

  it('does not walk a quiet year through screens that say nothing', () => {
    const quiet = stats({
      itemCount: 1, movieCount: 1, episodeCount: 0, seriesCount: 0, estimatedMinutes: 95,
      topShows: [], topGenres: [], busiestDay: { key: '2026-03-03', label: 'Tuesday, 3 March', count: 1 },
      habits: { activeDays: 1, longestStreak: 1, streakStart: '2026-03-03', streakEnd: '2026-03-03', favouriteWeekday: 2, busiestMonth: 2 },
    })
    const k = kinds(quiet)
    // A "biggest day" of one thing is not a biggest day.
    expect(k).not.toContain('biggestDay')
    expect(k).not.toContain('topShow')
    expect(k).not.toContain('shows')
  })

  it('gives the top show its own card, with its poster', () => {
    const withArt = stats({
      topShows: [{ key: 's1', label: 'A Show', count: 20, poster: { Id: 'e1', SeriesId: 's1' } }],
    })
    const slide = storySlides(withArt).find((s) => s.kind === 'topShow')
    expect(slide?.headline).toBe('A Show')
    expect(slide?.poster).toMatchObject({ SeriesId: 's1' })
  })

  it('skips the top-five card when there is no five to speak of', () => {
    expect(kinds(stats({ topShows: [{ key: 's1', label: 'Only', count: 3 }] }))).not.toContain('shows')
  })

  it('prefers a real streak over a favourite weekday, and falls back when there is none', () => {
    const streaky = storySlides(stats()).find((s) => s.kind === 'habits')
    expect(streaky?.headline).toBe('5 days')

    const noStreak = stats({
      habits: { ...stats().habits, longestStreak: 1, streakStart: null, streakEnd: null },
    })
    expect(storySlides(noStreak).find((s) => s.kind === 'habits')?.headline).toBe('Fridays')
  })

  it('folds the busiest month into a card rather than giving it a screen', () => {
    const withMonth = storySlides(stats(), { monthName: () => 'August' })
    expect(withMonth.map((s) => s.kind)).not.toContain('month' as never)
    expect(withMonth.some((s) => s.detail?.includes('August was your busiest month'))).toBe(true)
  })

  it('does not say the month twice when it is already in the detail', () => {
    const once = storySlides(stats(), { monthName: () => 'August' })
    const mentions = once.filter((s) => s.detail?.includes('August')).length
    expect(mentions).toBe(1)
  })
})

describe('formatStoryTime', () => {
  it('reads as a headline, not a readout', () => {
    expect(formatStoryTime(703)).toBe('12 hours')
    expect(formatStoryTime(60)).toBe('1 hour')
    expect(formatStoryTime(45)).toBe('45 minutes')
  })

  it('switches to days once hours stop meaning anything', () => {
    expect(formatStoryTime(60 * 72)).toBe('3 days of it')
  })

  it('is safe with nothing, or with nonsense', () => {
    expect(formatStoryTime(0)).toBe('0 minutes')
    expect(formatStoryTime(-5)).toBe('0 minutes')
    expect(formatStoryTime(Number.NaN)).toBe('0 minutes')
  })
})

describe('tapDirection', () => {
  it('gives back a third and forward the rest', () => {
    expect(tapDirection(10, 900)).toBe(-1)
    expect(tapDirection(299, 900)).toBe(-1)
    expect(tapDirection(301, 900)).toBe(1)
    expect(tapDirection(880, 900)).toBe(1)
  })

  it('goes forward when the width is not known yet', () => {
    expect(tapDirection(10, 0)).toBe(1)
  })
})

describe('advance', () => {
  it('moves through the run', () => {
    expect(advance(0, 5, 1)).toBe(1)
    expect(advance(3, 5, -1)).toBe(2)
  })

  it('stops at the first card rather than leaving backwards', () => {
    expect(advance(0, 5, -1)).toBe(0)
  })

  it('returns null off the end, which is the hand-over to the page', () => {
    expect(advance(4, 5, 1)).toBeNull()
  })
})

/*
  The view renders `countTo` *instead of* the headline, so a card whose
  headline is words must not carry one. The first version set it on the
  biggest-day card and the screen read "19" where the date should have been.
*/
describe('countTo is only ever set where the headline is the number', () => {
  it('never replaces a headline that is not just digits', () => {
    const all = storySlides(stats(), { monthName: () => 'August' })
    for (const slide of all) {
      if (slide.countTo == null) continue
      expect(slide.headline, `${slide.kind} carries countTo but reads "${slide.headline}"`).toMatch(
        /^\d[\d,]*$/,
      )
    }
  })

  it('keeps the date on the biggest-day card', () => {
    const slide = storySlides(stats()).find((s) => s.kind === 'biggestDay')
    expect(slide?.headline).toBe('Friday, 7 August')
    expect(slide?.countTo).toBeUndefined()
  })

  it('keeps the unit on the streak card', () => {
    const slide = storySlides(stats()).find((s) => s.kind === 'habits')
    expect(slide?.headline).toBe('5 days')
    expect(slide?.countTo).toBeUndefined()
  })
})
