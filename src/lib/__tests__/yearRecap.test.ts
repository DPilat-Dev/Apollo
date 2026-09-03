import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import {
  ESTIMATE_CAVEAT,
  RECAP_STORY_HREF,
  RECAP_MAX_ITEMS,
  TOP_N,
  formatEstimatedTime,
  habitsFromDays,
  hasRecap,
  nextRecapPage,
  previewSeason,
  recapButton,
  recapItemsQuery,
  recapProbe,
  summariseYear,
} from '../yearRecap'

const TICKS_PER_MINUTE = 600_000_000

const movie = (
  id: string,
  playedAt: string | null,
  extra: Partial<BaseItemDto> = {},
): BaseItemDto => ({
  Id: id,
  Name: id,
  Type: 'Movie',
  RunTimeTicks: 90 * TICKS_PER_MINUTE,
  UserData: playedAt ? { LastPlayedDate: playedAt, PlayCount: 1 } : { PlayCount: 1 },
  ...extra,
})

const episode = (
  id: string,
  playedAt: string,
  series: string,
  extra: Partial<BaseItemDto> = {},
): BaseItemDto => ({
  Id: id,
  Name: id,
  Type: 'Episode',
  SeriesId: `series-${series}`,
  SeriesName: series,
  RunTimeTicks: 30 * TICKS_PER_MINUTE,
  UserData: { LastPlayedDate: playedAt, PlayCount: 1 },
  ...extra,
})

const UTC = { timeZone: 'UTC', locale: 'en-GB' }

describe('recapSeason, via recapButton', () => {
  // The probe result is irrelevant to the seasonal question, so every case
  // here hands it a year that plainly has something in it.
  const stocked = [movie('a', '2026-06-01T12:00:00Z')]
  const button = (now: string, timeZone = 'UTC') =>
    recapButton({ now: new Date(now), timeZone, probeItems: stocked })

  it('recaps the current year in December', () => {
    expect(button('2026-12-05T12:00:00Z')?.year).toBe(2026)
  })

  /*
    The whole reason this is a function and not a `getFullYear()`. In January
    the interesting year is the one that just ended: a recap of three weeks of
    viewing is not a recap of anything.
  */
  it('recaps the previous year in January', () => {
    expect(button('2027-01-14T12:00:00Z')?.year).toBe(2026)
  })

  it('is absent for the other ten months', () => {
    for (const month of ['02', '03', '04', '05', '06', '07', '08', '09', '10', '11']) {
      expect(button(`2026-${month}-15T12:00:00Z`)).toBeNull()
    }
  })

  /*
    The rollover is the point of the December/January split: the recap a person
    was reading on New Year's Eve is the same recap on New Year's Day, so the
    link must not renumber itself at midnight.
  */
  it('names the same year either side of midnight on New Year', () => {
    expect(button('2026-12-31T23:59:00Z')?.year).toBe(2026)
    expect(button('2027-01-01T00:01:00Z')?.year).toBe(2026)
  })

  /*
    The viewer's clock decides, not UTC. At this instant it is already the 1st
    of December in London and still the 30th of November in Los Angeles, and a
    Californian being shown a December-only button in November is the bug.
  */
  it('reads the month from the viewer’s zone, not UTC', () => {
    const instant = '2026-12-01T02:00:00Z'
    expect(button(instant, 'UTC')?.year).toBe(2026)
    expect(button(instant, 'America/Los_Angeles')).toBeNull()
  })

  /* The same, one season later and the other way round: February in UTC is
     still January on the west coast, and January still means last year. */
  it('reads the year from the viewer’s zone too', () => {
    const instant = '2027-02-01T02:00:00Z'
    expect(button(instant, 'UTC')).toBeNull()
    expect(button(instant, 'America/Los_Angeles')?.year).toBe(2026)
  })

  it('points at the recap and says which year it covers', () => {
    const shown = button('2026-12-05T12:00:00Z')

    // The button opens the run, not the page it ends on.
    expect(shown?.href).toBe(RECAP_STORY_HREF)
    expect(shown?.label).toContain('2026')
  })
})

describe('recapButton, on a server with nothing to recap', () => {
  const inSeason = { now: new Date('2026-12-05T12:00:00Z'), timeZone: 'UTC' }

  /*
    A brand-new account in December must not be handed a ceremony of zeros, so
    the button waits on evidence rather than on the calendar alone.
  */
  it('stays away when the account has never played anything', () => {
    expect(recapButton({ ...inSeason, probeItems: [] })).toBeNull()
  })

  /*
    Nothing is shown until the probe has answered. Rendering optimistically and
    retracting is the flash that `shouldShowCollections` exists to avoid.
  */
  it('stays away while the probe is still in flight', () => {
    expect(recapButton({ ...inSeason, probeItems: undefined })).toBeNull()
  })

  it('appears once the probe finds viewing in the year', () => {
    const probeItems = [movie('a', '2026-03-02T20:00:00Z')]

    expect(recapButton({ ...inSeason, probeItems })?.year).toBe(2026)
  })
})

describe('recapProbe', () => {
  it('rules the recap out when the account has played nothing', () => {
    expect(recapProbe([], 2026, UTC.timeZone)).toBe('none')
  })

  /*
    The page is sorted newest-first, so an item older than the target year on
    the first page proves every remaining page is older still. That is the one
    case a single request can settle, and settling it is what keeps the home
    page from paying for a full walk in December.
  */
  it('rules the recap out when the newest page has already passed the year', () => {
    const items = [movie('a', '2025-11-02T20:00:00Z'), movie('b', '2024-01-05T20:00:00Z')]

    expect(recapProbe(items, 2026, UTC.timeZone)).toBe('none')
  })

  it('lets the recap through when the newest page lands inside the year', () => {
    const items = [movie('a', '2027-01-04T20:00:00Z'), movie('b', '2026-12-30T20:00:00Z')]

    expect(recapProbe(items, 2026, UTC.timeZone)).toBe('possible')
  })

  /*
    In January the newest page can be nothing but this year's viewing, which
    says nothing either way about the year being recapped. Cannot rule out is
    not the same as ruled out.
  */
  it('lets the recap through when the newest page is entirely newer than the year', () => {
    const items = [movie('a', '2027-01-20T20:00:00Z'), movie('b', '2027-01-19T20:00:00Z')]

    expect(recapProbe(items, 2026, UTC.timeZone)).toBe('possible')
  })

  it('lets the recap through when no date on the page can be read', () => {
    const items = [movie('a', null), movie('b', 'not a date')]

    expect(recapProbe(items, 2026, UTC.timeZone)).toBe('possible')
  })
})

describe('recapItemsQuery', () => {
  /* Same request the history page walks — same sort, same types, same played
     filter. Two ideas of "what this person watched" would drift apart. */
  it('reuses the history request', () => {
    const query = recapItemsQuery(0)

    expect(query.sortBy).toEqual(['DatePlayed'])
    expect(query.sortOrder).toEqual(['Descending'])
    expect(query.isPlayed).toBe(true)
    expect(query.includeItemTypes).toEqual(['Movie', 'Episode'])
    expect(query.recursive).toBe(true)
  })

  /* Genres are not on the default projection, and the top-genres panel is
     silently empty without them. */
  it('asks for genres, which the history page does not need', () => {
    expect(recapItemsQuery(0).fields).toContain('Genres')
  })

  /*
    Posters are the point of the top-shows panel, so images are asked for — but
    ten pages of two hundred is the widest walk the app makes, and without a
    type limit every item carries every backdrop tag the server holds.
  */
  it('asks for artwork, and for only one tag of each kind', () => {
    expect(recapItemsQuery(0).enableImages).toBe(true)
    expect(recapItemsQuery(0).imageTypeLimit).toBe(1)
  })

  it('pages from the given offset', () => {
    expect(recapItemsQuery(0).startIndex).toBe(0)
    expect(recapItemsQuery(200).startIndex).toBe(200)
  })
})

describe('nextRecapPage', () => {
  const opts = { year: 2026, timeZone: 'UTC' }

  it('keeps paging while everything seen is still inside the year', () => {
    const loaded = [movie('a', '2026-12-30T20:00:00Z'), movie('b', '2026-06-01T20:00:00Z')]

    expect(nextRecapPage(loaded, { ...opts, total: 900 })).toBe(2)
  })

  /* The early exit. There is no server-side "played during 2026" filter, so
     crossing the start of the year is the only signal that the walk is done —
     without it this pages the whole library to build one screen. */
  it('stops as soon as the walk crosses the start of the year', () => {
    const loaded = [movie('a', '2026-01-02T20:00:00Z'), movie('b', '2025-12-30T20:00:00Z')]

    expect(nextRecapPage(loaded, { ...opts, total: 900 })).toBeUndefined()
  })

  /* January: everything so far is newer than the year being recapped, which is
     no reason to stop — the year itself is further down. */
  it('keeps paging through viewing newer than the year', () => {
    const loaded = [movie('a', '2027-01-20T20:00:00Z')]

    expect(nextRecapPage(loaded, { ...opts, total: 900 })).toBe(1)
  })

  it('stops when the server has no more to give', () => {
    const loaded = [movie('a', '2026-12-30T20:00:00Z')]

    expect(nextRecapPage(loaded, { ...opts, total: 1 })).toBeUndefined()
  })

  /*
    The cap is the guard against the early exit never firing: a library whose
    LastPlayedDate is missing or unreadable throughout never crosses anything,
    and without a ceiling this walks every played item on the server.
  */
  it('stops at the cap when no date ever ends the walk', () => {
    const loaded = Array.from({ length: RECAP_MAX_ITEMS }, (_, i) => movie(`m${i}`, null))

    expect(nextRecapPage(loaded, { ...opts, total: 50_000 })).toBeUndefined()
  })
})

describe('summariseYear', () => {
  it('counts films, episodes and the shows they came from', () => {
    const stats = summariseYear(
      [
        movie('film-1', '2026-02-01T20:00:00Z'),
        movie('film-2', '2026-03-01T20:00:00Z'),
        episode('e1', '2026-04-01T20:00:00Z', 'Severance'),
        episode('e2', '2026-04-01T21:00:00Z', 'Severance'),
        episode('e3', '2026-05-01T21:00:00Z', 'Andor'),
      ],
      2026,
      UTC,
    )

    expect(stats.itemCount).toBe(5)
    expect(stats.movieCount).toBe(2)
    expect(stats.episodeCount).toBe(3)
    expect(stats.seriesCount).toBe(2)
  })

  /* The fetch deliberately overshoots — in January it walks back through the
     current year to reach the last one — so the year filter lives here. */
  it('ignores everything watched outside the year', () => {
    const stats = summariseYear(
      [
        movie('this-january', '2027-01-04T20:00:00Z'),
        movie('in-year', '2026-07-04T20:00:00Z'),
        movie('year-before', '2025-12-30T20:00:00Z'),
      ],
      2026,
      UTC,
    )

    expect(stats.itemCount).toBe(1)
  })

  it('sets aside items whose play date cannot be read', () => {
    const stats = summariseYear(
      [
        movie('good', '2026-07-04T20:00:00Z'),
        movie('missing', null),
        movie('garbled', 'the other tuesday'),
      ],
      2026,
      UTC,
    )

    expect(stats.itemCount).toBe(1)
    expect(stats.undatedCount).toBe(2)
  })

  /*
    The honesty problem. Jellyfin records a runtime, a play count and a single
    LastPlayedDate — never how long anyone actually sat there. Runtimes are
    counted once per item however many times PlayCount says it was played,
    because the count is a lifetime total pinned to one date: five rewatches
    spread over four years would otherwise all land in this year's total.
  */
  it('counts a rewatched film once, whatever PlayCount says', () => {
    const stats = summariseYear(
      [movie('rewatched', '2026-07-04T20:00:00Z', { UserData: { LastPlayedDate: '2026-07-04T20:00:00Z', PlayCount: 5 } })],
      2026,
      UTC,
    )

    expect(stats.estimatedMinutes).toBe(90)
  })

  it('adds runtimes across the year', () => {
    const stats = summariseYear(
      [
        movie('film', '2026-02-01T20:00:00Z'),
        episode('e1', '2026-02-02T20:00:00Z', 'Severance'),
        episode('e2', '2026-02-03T20:00:00Z', 'Severance'),
      ],
      2026,
      UTC,
    )

    expect(stats.estimatedMinutes).toBe(150)
  })

  /* A library item with no runtime is common enough — an unscanned file, a
     stub — and it must not poison the total with a NaN. */
  it('survives an item with no runtime, and says how many there were', () => {
    const stats = summariseYear(
      [
        movie('timed', '2026-02-01T20:00:00Z'),
        movie('untimed', '2026-02-02T20:00:00Z', { RunTimeTicks: undefined }),
      ],
      2026,
      UTC,
    )

    expect(stats.estimatedMinutes).toBe(90)
    expect(stats.itemsWithoutRuntime).toBe(1)
  })

  it('ranks shows by how many episodes were watched', () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => episode(`a${i}`, '2026-02-01T20:00:00Z', 'Andor')),
      ...Array.from({ length: 7 }, (_, i) => episode(`s${i}`, '2026-03-01T20:00:00Z', 'Severance')),
      episode('p0', '2026-04-01T20:00:00Z', 'Poirot'),
    ]

    const stats = summariseYear(items, 2026, UTC)

    expect(stats.topShows.map((s) => [s.label, s.count])).toEqual([
      ['Severance', 7],
      ['Andor', 3],
      ['Poirot', 1],
    ])
  })

  it('keeps the top lists to a handful', () => {
    const items = Array.from({ length: TOP_N + 4 }, (_, i) =>
      episode(`e${i}`, '2026-02-01T20:00:00Z', `Show ${i}`),
    )

    expect(summariseYear(items, 2026, UTC).topShows).toHaveLength(TOP_N)
  })

  it('ranks genres, counting each item once per genre', () => {
    const items = [
      movie('a', '2026-02-01T20:00:00Z', { Genres: ['Drama', 'Thriller'] }),
      movie('b', '2026-02-02T20:00:00Z', { Genres: ['Drama'] }),
      movie('c', '2026-02-03T20:00:00Z', { Genres: ['Comedy'] }),
    ]

    expect(summariseYear(items, 2026, UTC).topGenres.map((g) => [g.label, g.count])).toEqual([
      ['Drama', 2],
      ['Comedy', 1],
      ['Thriller', 1],
    ])
  })

  /* Plenty of libraries carry no genre metadata at all, and episodes rarely
     inherit their series'. An empty list is the honest answer; a panel of
     "Unknown ×40" is not. */
  it('reports no genres rather than inventing one', () => {
    const stats = summariseYear([movie('a', '2026-02-01T20:00:00Z')], 2026, UTC)

    expect(stats.topGenres).toEqual([])
  })

  /* Every "top 5" has to survive a year with one thing in it. */
  it('degrades to a list of one', () => {
    const stats = summariseYear(
      [episode('e', '2026-02-01T20:00:00Z', 'Andor', { Genres: ['Sci-Fi'] })],
      2026,
      UTC,
    )

    expect(stats.topShows).toHaveLength(1)
    expect(stats.topGenres).toHaveLength(1)
    expect(stats.busiestDay?.count).toBe(1)
  })

  it('has no busiest day when the year is empty', () => {
    const stats = summariseYear([movie('a', '2025-02-01T20:00:00Z')], 2026, UTC)

    expect(stats.itemCount).toBe(0)
    expect(stats.busiestDay).toBeNull()
  })

  it('finds the day the most was watched, and names it', () => {
    const items = [
      movie('a', '2026-03-14T20:00:00Z'),
      movie('b', '2026-03-14T22:00:00Z'),
      movie('c', '2026-07-01T20:00:00Z'),
    ]

    const stats = summariseYear(items, 2026, UTC)

    expect(stats.busiestDay?.key).toBe('2026-03-14')
    expect(stats.busiestDay?.count).toBe(2)
    expect(stats.busiestDay?.label).toContain('14')
    expect(stats.busiestDay?.label).toContain('March')
  })

  /*
    Two films on a Saturday evening in Los Angeles are already Sunday in UTC,
    and a recap that calls that a quiet Saturday and a busy Sunday is describing
    somebody else's week. Same reasoning as the history page's day headings.
  */
  it('groups days by the viewer’s clock, not UTC', () => {
    const items = [
      movie('a', '2026-03-15T03:00:00Z'),
      movie('b', '2026-03-15T04:00:00Z'),
      movie('c', '2026-06-02T18:00:00Z'),
    ]

    const west = summariseYear(items, 2026, { timeZone: 'America/Los_Angeles', locale: 'en-GB' })
    const utc = summariseYear(items, 2026, UTC)

    expect(west.busiestDay?.key).toBe('2026-03-14')
    expect(utc.busiestDay?.key).toBe('2026-03-15')
  })

  /* A December film watched at 9pm in Los Angeles is already January in UTC —
     the year filter has to move with the viewer as well. */
  it('places the year boundary on the viewer’s clock', () => {
    const newYearsEve = [movie('a', '2027-01-01T04:00:00Z')]

    expect(summariseYear(newYearsEve, 2026, { timeZone: 'America/Los_Angeles' }).itemCount).toBe(1)
    expect(summariseYear(newYearsEve, 2026, UTC).itemCount).toBe(0)
  })

  it('spreads the year across its months', () => {
    const stats = summariseYear(
      [
        movie('a', '2026-01-10T12:00:00Z'),
        movie('b', '2026-01-20T12:00:00Z'),
        movie('c', '2026-12-10T12:00:00Z'),
      ],
      2026,
      UTC,
    )

    expect(stats.months).toHaveLength(12)
    expect(stats.months[0]).toBe(2)
    expect(stats.months[11]).toBe(1)
    expect(stats.months[5]).toBe(0)
  })

  /*
    Hitting the ceiling means every number below it is a floor rather than a
    total, and the page has to be able to say so.
  */
  it('flags a walk that ran into the cap', () => {
    const many = Array.from({ length: RECAP_MAX_ITEMS }, (_, i) =>
      movie(`m${i}`, '2026-02-01T20:00:00Z'),
    )

    expect(summariseYear(many, 2026, UTC).truncated).toBe(true)
    expect(summariseYear(many.slice(1), 2026, UTC).truncated).toBe(false)
  })
})

describe('hasRecap', () => {
  const empty = summariseYear([movie('a', '2025-02-01T20:00:00Z')], 2026, UTC)
  const stocked = summariseYear([movie('a', '2026-02-01T20:00:00Z')], 2026, UTC)

  /*
    The probe only ever had one page to reason from. Once the whole walk is in
    the answer is certain, and a first December on a new server — the moment
    someone is most likely to press the link — must not be a wall of zeros.
  */
  it('sends an empty year to a sentence rather than a ceremony', () => {
    expect(hasRecap(empty)).toBe(false)
  })

  it('lets a year with a single thing in it through', () => {
    expect(hasRecap(stocked)).toBe(true)
  })
})

describe('formatEstimatedTime', () => {
  it('stays in minutes below an hour', () => {
    expect(formatEstimatedTime(0)).toBe('0 min')
    expect(formatEstimatedTime(42)).toBe('42 min')
  })

  it('splits hours from minutes', () => {
    expect(formatEstimatedTime(60)).toBe('1 hr')
    expect(formatEstimatedTime(100)).toBe('1 hr 40 min')
  })

  /* Past a day, the odd minutes are noise on a number that is an estimate
     anyway — "312 hours 14 min" claims a precision nothing here has. */
  it('drops the minutes once the total is a serious number of hours', () => {
    expect(formatEstimatedTime(24 * 60 + 30)).toBe('24 hours')
    expect(formatEstimatedTime(500 * 60 + 59)).toBe('500 hours')
  })
})

describe('the estimate caveat', () => {
  /*
    Jellyfin never measures watch time, so the headline number is arithmetic on
    runtimes of things marked played. The page must say so; keeping the words
    here means dropping them from the page breaks a test rather than quietly
    turning a guess into a fact.
  */
  it('says out loud that the hours are an estimate', () => {
    expect(ESTIMATE_CAVEAT.toLowerCase()).toContain('estimate')
  })
})

/*
  The escape hatch that makes a ten-months-invisible page checkable by hand.
  It must never be reachable outside a dev build, and must not accept junk —
  a page rendering "NaN in review" is worse than one nobody can open.
*/
describe('previewSeason', () => {
  it('opens a named year while developing', () => {
    expect(previewSeason('2026')).toEqual({ year: 2026, label: '2026 in review' })
  })

  it('ignores an absent parameter', () => {
    expect(previewSeason(null)).toBeNull()
    expect(previewSeason('')).toBeNull()
  })

  it('refuses junk rather than rendering a year of NaN', () => {
    for (const junk of ['abc', '20x6', '1.5', '', ' ', '99999', '1200', 'Infinity']) {
      expect(previewSeason(junk)).toBeNull()
    }
  })
})

describe('habitsFromDays', () => {
  const days = (...entries: [string, number][]) => new Map(entries)

  it('counts the days something was finished on', () => {
    expect(habitsFromDays(days(['2026-03-01', 3], ['2026-03-02', 1])).activeDays).toBe(2)
  })

  it('finds the longest unbroken run', () => {
    const h = habitsFromDays(
      days(['2026-01-01', 1], ['2026-01-02', 1], ['2026-01-03', 1], ['2026-02-10', 9]),
    )
    expect(h.longestStreak).toBe(3)
    expect([h.streakStart, h.streakEnd]).toEqual(['2026-01-01', '2026-01-03'])
  })

  it('does not let a busy single day pretend to be a streak', () => {
    // Twelve episodes in one sitting is one day, however good the sitting was.
    expect(habitsFromDays(days(['2026-05-05', 12])).longestStreak).toBe(1)
  })

  it('carries a streak across a month and a year boundary', () => {
    expect(habitsFromDays(days(['2026-01-31', 1], ['2026-02-01', 1])).longestStreak).toBe(2)
    expect(habitsFromDays(days(['2025-12-31', 1], ['2026-01-01', 1])).longestStreak).toBe(2)
  })

  it('keeps the longest run, not the last one', () => {
    const h = habitsFromDays(
      days(['2026-06-01', 1], ['2026-06-02', 1], ['2026-06-03', 1], ['2026-09-01', 1], ['2026-09-02', 1]),
    )
    expect(h.longestStreak).toBe(3)
    expect(h.streakEnd).toBe('2026-06-03')
  })

  it('reads a weekday from the calendar date, not from midnight', () => {
    // 2026-03-01 is a Sunday. Parsed at midnight in a negative offset it would
    // roll back to Saturday and file every Sunday under the wrong day.
    expect(habitsFromDays(days(['2026-03-01', 5])).favouriteWeekday).toBe(0)
    expect(habitsFromDays(days(['2026-03-02', 5])).favouriteWeekday).toBe(1)
  })

  it('names no favourite weekday when two are tied', () => {
    // Announcing one at random is how a viewer stops believing the whole page.
    expect(habitsFromDays(days(['2026-03-01', 2], ['2026-03-02', 2])).favouriteWeekday).toBeNull()
  })

  it('names the busiest month, and none when tied', () => {
    expect(habitsFromDays(days(['2026-04-02', 7], ['2026-08-02', 1])).busiestMonth).toBe(3)
    expect(habitsFromDays(days(['2026-04-02', 3], ['2026-08-02', 3])).busiestMonth).toBeNull()
  })

  it('says nothing at all about an empty year', () => {
    const h = habitsFromDays(days())
    expect(h).toEqual({
      activeDays: 0,
      longestStreak: 0,
      streakStart: null,
      streakEnd: null,
      favouriteWeekday: null,
      busiestMonth: null,
    })
  })

  it('ignores a malformed key rather than counting it as a day', () => {
    const h = habitsFromDays(days(['not-a-date', 4], ['2026-07-07', 1]))
    expect(h.activeDays).toBe(1)
    expect(h.busiestMonth).toBe(6)
  })
})

describe('summariseYear — posters', () => {
  const episode = (over: Partial<BaseItemDto> = {}): BaseItemDto =>
    ({
      Id: 'e1',
      Type: 'Episode',
      SeriesId: 's1',
      SeriesName: 'A Show',
      SeriesPrimaryImageTag: 'tag1',
      UserData: { LastPlayedDate: '2026-05-05T12:00:00Z' },
      ...over,
    }) as BaseItemDto

  const shows = (items: BaseItemDto[]) =>
    summariseYear(items, 2026, { timeZone: 'UTC' }).topShows

  it('carries a poster reference for a show', () => {
    const [top] = shows([episode()])
    expect(top.poster).toMatchObject({ SeriesId: 's1', SeriesPrimaryImageTag: 'tag1' })
  })

  it('leaves it absent when the episodes carry no artwork at all', () => {
    // A show with no poster must render as a title, not as a broken image.
    const [top] = shows([episode({ SeriesPrimaryImageTag: undefined, ImageTags: undefined })])
    expect(top.poster).toBeUndefined()
  })

  it('takes a later episode’s art when the first had none', () => {
    const [top] = shows([
      episode({ Id: 'e1', SeriesPrimaryImageTag: undefined, ImageTags: undefined }),
      episode({ Id: 'e2' }),
    ])
    expect(top.poster?.SeriesPrimaryImageTag).toBe('tag1')
  })

  it('never invents one for a genre, which is a word and not a thing', () => {
    const stats = summariseYear([episode({ Genres: ['Comedy'] })], 2026, { timeZone: 'UTC' })
    expect(stats.topGenres[0].poster).toBeUndefined()
  })
})
