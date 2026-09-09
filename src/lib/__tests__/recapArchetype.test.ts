import { describe, expect, it } from 'vitest'
import type { RecapStats } from '../yearRecap'
import { viewerArchetype, viewerBadges } from '../recapArchetype'

const stats = (over: Partial<RecapStats> = {}): RecapStats => ({
  year: 2025,
  itemCount: 100,
  movieCount: 0,
  episodeCount: 100,
  seriesCount: 5,
  estimatedMinutes: 2000,
  itemsWithoutRuntime: 0,
  undatedCount: 0,
  topShows: [{ key: 's1', label: 'A Show', count: 10 }],
  topGenres: [],
  busiestDay: null,
  months: Array(12).fill(0),
  habits: {
    activeDays: 50,
    longestStreak: 3,
    streakStart: null,
    streakEnd: null,
    favouriteWeekday: null,
    busiestMonth: null,
  },
  truncated: false,
  ...over,
})

const genre = (label: string, count: number) => ({ key: label, label, count })

describe('viewerArchetype', () => {
  it('says nothing about a year with barely anything in it', () => {
    // Four evenings is not a personality, and inventing one from it is the
    // fastest way to make this feature feel cheap.
    expect(viewerArchetype(stats({ itemCount: 4 }))).toBeNull()
    expect(viewerArchetype(null)).toBeNull()
  })

  it('finds the rare signal before the common one', () => {
    // The order is the design: a year that is 8% one thing and 76% another is
    // more interesting for the 8%.
    const s = stats({ topGenres: [genre('Animation', 76), genre('Adult', 8)] })
    expect(viewerArchetype(s)?.id).toBe('gooner')
  })

  it('needs more than a single stray item to call anyone that', () => {
    expect(viewerArchetype(stats({ topGenres: [genre('Adult', 2)] }))?.id).not.toBe('gooner')
  })

  it('recognises a year of anime', () => {
    const s = stats({ topGenres: [genre('Anime', 60), genre('Animation', 60)] })
    expect(viewerArchetype(s)?.id).toBe('weeb')
  })

  it('does not call a cartoon year an anime year', () => {
    const s = stats({ topGenres: [genre('Animation', 80), genre('Comedy', 40)] })
    expect(viewerArchetype(s)?.id).toBe('cartoon-adult')
  })

  it('notices one show carrying the whole year', () => {
    const s = stats({
      topShows: [{ key: 's1', label: 'American Dad!', count: 40 }],
      topGenres: [genre('Comedy', 30)],
    })
    expect(viewerArchetype(s)?.id).toBe('comfort')
    expect(viewerArchetype(s)?.blurb).toContain('American Dad!')
  })

  it('falls back to the shape of the year when the taste says nothing', () => {
    const s = stats({ seriesCount: 40, topGenres: [genre('Drama', 10)] })
    expect(viewerArchetype(s)?.id).toBe('sampler')
  })

  it('has nothing to say about a year with no pattern at all', () => {
    // Better than reaching. Not every year is a character.
    const s = stats({ itemCount: 12, seriesCount: 3, topGenres: [genre('Drama', 2)], topShows: [] })
    expect(viewerArchetype(s)).toBeNull()
  })

  it('never divides by a zero item count', () => {
    expect(() => viewerArchetype(stats({ itemCount: 0 }))).not.toThrow()
  })

  it('gives every rule an id, a title and something to say', () => {
    const cases: Partial<RecapStats>[] = [
      { topGenres: [genre('Adult', 9)] },
      { topGenres: [genre('Anime', 60)] },
      { topGenres: [genre('Horror', 40)] },
      { topGenres: [genre('Romance', 40)] },
      { topGenres: [genre('Crime', 40)] },
      { topGenres: [genre('Documentary', 40)] },
      { topGenres: [genre('Reality', 40)] },
      { topGenres: [genre('Animation', 60)] },
      { topGenres: [genre('Comedy', 60)] },
      { habits: { ...stats().habits, longestStreak: 30 } },
      { seriesCount: 40 },
      { movieCount: 60, episodeCount: 40 },
    ]
    for (const c of cases) {
      const a = viewerArchetype(stats(c))
      expect(a, JSON.stringify(c)).not.toBeNull()
      expect(a!.title.length).toBeGreaterThan(0)
      expect(a!.blurb.length).toBeGreaterThan(0)
      expect(a!.id).toMatch(/^[a-z-]+$/)
    }
  })
})

describe('viewerBadges', () => {
  it('does not repeat the headline', () => {
    // Being told the same joke twice is worse than being told it once.
    const s = stats({
      topShows: [{ key: 's1', label: 'A Show', count: 40 }],
      habits: { ...stats().habits, longestStreak: 20 },
    })
    const headline = viewerArchetype(s)
    expect(headline?.id).toBe('comfort')
    expect(viewerBadges(s).map((b) => b.id)).not.toContain('comfort')
  })

  it('reports a day that swallowed the year', () => {
    const s = stats({ busiestDay: { key: '2025-11-27', label: 'Thursday, November 27', count: 40 } })
    expect(viewerBadges(s).map((b) => b.id)).toContain('one-sitting')
  })

  it('says nothing for a year with nothing in it', () => {
    expect(viewerBadges(stats({ itemCount: 3 }))).toEqual([])
    expect(viewerBadges(null)).toEqual([])
  })

  it('keeps the list short', () => {
    const s = stats({
      busiestDay: { key: 'd', label: 'A day', count: 40 },
      seriesCount: 40,
      habits: { ...stats().habits, longestStreak: 20, activeDays: 300 },
      movieCount: 0,
      episodeCount: 100,
    })
    expect(viewerBadges(s).length).toBeLessThanOrEqual(3)
  })
})
