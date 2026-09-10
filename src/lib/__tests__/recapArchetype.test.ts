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

  it('calls out a year that was overwhelmingly one series', () => {
    const s = stats({ topShows: [{ key: 's1', label: 'One Piece', count: 80 }] })
    const a = viewerArchetype(s)
    expect(a?.id).toBe('one-show')
    expect(a?.blurb).toContain('One Piece')
    expect(a?.blurb).toContain('80%')
  })

  it('leaves a merely favourite show to the quieter label', () => {
    // 69% is a comfort watcher; 70% is the whole year.
    const s = stats({ topShows: [{ key: 's1', label: 'One Piece', count: 69 }] })
    expect(viewerArchetype(s)?.id).toBe('comfort')
  })

  it('names the show rather than the genre when one series ran the year', () => {
    // Both are true. Which series it was is the more interesting of the two.
    const s = stats({
      topShows: [{ key: 's1', label: 'One Piece', count: 80 }],
      topGenres: [genre('Anime', 90), genre('Animation', 90)],
    })
    expect(viewerArchetype(s)?.id).toBe('one-show')
  })

  it('calls a year of films a year of films, not a streak', () => {
    /*
      Watching on fourteen consecutive evenings is what anyone does over a
      fortnight off, and it used to outrank the fact that four items in five
      were films — the rarer and more particular thing about the year.
    */
    const s = stats({
      itemCount: 25,
      movieCount: 20,
      episodeCount: 5,
      seriesCount: 2,
      topShows: [{ key: 's1', label: 'A Show', count: 3 }],
      habits: { ...stats().habits, longestStreak: 20 },
    })
    expect(viewerArchetype(s)?.id).toBe('cinema')
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

  it('does not repeat the headline in different words', () => {
    /*
      'Same show, all year' and 'One show, mostly' share no id, and the filter
      was on the id — so the loudest card and the quietest badge said the same
      thing about the same series, one under the other.
    */
    const s = stats({ topShows: [{ key: 's1', label: 'One Piece', count: 80 }] })
    expect(viewerArchetype(s)?.id).toBe('one-show')
    expect(viewerBadges(s).map((b) => b.id)).not.toContain('comfort')
  })

  it('counts a single film as a year without films', () => {
    const one = stats({ movieCount: 1, episodeCount: 99 })
    const badge = viewerBadges(one).find((b) => b.id === 'no-films')
    expect(badge?.blurb).toBe('One film. The whole year.')
    expect(viewerBadges(stats({ movieCount: 0 })).find((b) => b.id === 'no-films')?.blurb).toBe(
      'Zero films. Not one.',
    )
    expect(viewerBadges(stats({ movieCount: 2, episodeCount: 98 })).map((b) => b.id)).not.toContain(
      'no-films',
    )
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

describe('anime against everything else that is drawn', () => {
  // Jellyfin tags anime with both genres — 271 of 300 series in the library
  // this was written against carry `Anime` and `Animation` — so the counts
  // overlap and the comparison is anime against what is left.
  const drawn = (animation: number, anime: number, itemCount = 100) =>
    stats({ itemCount, topGenres: [genre('Animation', animation), genre('Anime', anime)] })

  it('calls a year of anime a weeb, not a cartoon adult', () => {
    // The whole point: 80 animated things, 75 of them anime.
    expect(viewerArchetype(drawn(80, 75))?.id).toBe('weeb')
  })

  it('still calls western cartoons cartoons', () => {
    // The library this was built against: 912 animated, no anime at all.
    expect(viewerArchetype(drawn(80, 0))?.id).toBe('cartoon-adult')
  })

  it('gives a tie to the weeb', () => {
    expect(viewerArchetype(drawn(80, 40))?.id).toBe('weeb')
  })

  it('calls a mostly-cartoons year a cartoon year even with some anime in it', () => {
    expect(viewerArchetype(drawn(80, 20))?.id).toBe('cartoon-adult')
  })

  it('handles anime tagged without Animation at all', () => {
    // Twenty-five of those three hundred series carry `Anime` and nothing else.
    expect(viewerArchetype(drawn(0, 60))?.id).toBe('weeb')
  })

  it('never reports a year as more than fully animated', () => {
    // Adding the two counts did exactly that, because every anime carries both.
    const a = viewerArchetype(drawn(80, 78))
    const b = viewerArchetype(drawn(90, 0))
    for (const found of [a, b]) {
      const pct = Number(found?.blurb.match(/(\d+)%/)?.[1] ?? 0)
      expect(pct).toBeLessThanOrEqual(100)
    }
  })

  it('says what it counted, when there is something to compare', () => {
    expect(viewerArchetype(drawn(80, 75))?.blurb).toContain('75 of them were anime')
    expect(viewerArchetype(drawn(80, 75))?.blurb).toContain('5 that were merely cartoons')
  })

  it('does not label a handful of anime in a live-action year', () => {
    // Twelve anime out of a thousand is not a weeb, however lopsided the
    // animated slice is.
    expect(viewerArchetype(drawn(12, 12, 1000))?.id).not.toBe('weeb')
  })
})
