import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import {
  HISTORY_MAX_ITEMS,
  HISTORY_PAGE_SIZE,
  formatPlayedTime,
  groupWatchHistory,
  historyItemsQuery,
  nextHistoryPage,
  buildHeatmap,
  heatCellLabel,
  heatmapItemsQuery,
  heatmapWindowStart,
  nextHeatmapPage,
  HEATMAP_MAX_ITEMS,
  filterHistory,
  summariseDay,
  type HistoryDay,
  type HistoryEntry,
} from '../watchHistory'

const movie = (id: string, playedAt: string | null, name = id): BaseItemDto => ({
  Id: id,
  Name: name,
  Type: 'Movie',
  UserData: playedAt ? { LastPlayedDate: playedAt } : {},
})

const episode = (
  id: string,
  playedAt: string,
  series: string,
  season: number,
  number: number,
): BaseItemDto => ({
  Id: id,
  Name: `${series} ${season}x${number}`,
  Type: 'Episode',
  SeriesId: `series-${series}`,
  SeriesName: series,
  ParentIndexNumber: season,
  IndexNumber: number,
  UserData: { LastPlayedDate: playedAt },
})

// Mid-afternoon UTC, so the same instant is still the same day in the western
// zones the timezone tests use.
const NOW = new Date('2026-05-12T15:00:00Z')
const UTC = { now: NOW, timeZone: 'UTC', locale: 'en-GB' }

describe('historyItemsQuery', () => {
  /*
    The sort key is the one thing here that cannot be reasoned out: /Items
    takes an ItemSortBy enum, and "when it was played" is spelled DatePlayed.
    Ask for DateCreated and the page silently lists the library in the order it
    was imported, which looks plausible and is not history at all.
  */
  it('asks for the most recently played first', () => {
    const query = historyItemsQuery(0)

    expect(query.sortBy).toEqual(['DatePlayed'])
    expect(query.sortOrder).toEqual(['Descending'])
    expect(query.isPlayed).toBe(true)
  })

  /*
    Episodes, not series: a series carries a DatePlayed too, so including them
    would list "Severance" once alongside each of its episodes.
  */
  it('asks for the things a person actually watches, across the whole tree', () => {
    const query = historyItemsQuery(0)

    expect(query.includeItemTypes).toEqual(['Movie', 'Episode'])
    expect(query.recursive).toBe(true)
  })

  it('pages from the given offset', () => {
    expect(historyItemsQuery(0).startIndex).toBe(0)
    expect(historyItemsQuery(120).startIndex).toBe(120)
    expect(historyItemsQuery(0).limit).toBe(HISTORY_PAGE_SIZE)
  })
})

describe('nextHistoryPage', () => {
  it('asks for the next page while the server has more', () => {
    expect(nextHistoryPage(HISTORY_PAGE_SIZE, 500)).toBe(HISTORY_PAGE_SIZE)
  })

  it('stops once everything has been loaded', () => {
    expect(nextHistoryPage(40, 40)).toBeUndefined()
    expect(nextHistoryPage(0, 0)).toBeUndefined()
  })

  /*
    A viewer with years of episodes has a total in the tens of thousands, and
    scrolling to the end of that is not a feature — it is an out-of-memory tab.
  */
  it('stops at the cap even when the server has more', () => {
    expect(nextHistoryPage(HISTORY_MAX_ITEMS, 99_000)).toBeUndefined()
    expect(nextHistoryPage(HISTORY_MAX_ITEMS - HISTORY_PAGE_SIZE, 99_000)).toBe(
      HISTORY_MAX_ITEMS - HISTORY_PAGE_SIZE,
    )
  })
})

describe('groupWatchHistory', () => {
  it('has nothing to say about an empty history', () => {
    expect(groupWatchHistory([], UTC)).toEqual([])
  })

  it('splits a run of items across the day boundary they straddle', () => {
    const groups = groupWatchHistory(
      [
        movie('a', '2026-05-12T00:10:00Z'),
        movie('b', '2026-05-11T23:50:00Z'),
        movie('c', '2026-05-11T20:00:00Z'),
      ],
      UTC,
    )

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Yesterday'])
    expect(groups[0].entries.map((e) => e.item.Id)).toEqual(['a'])
    expect(groups[1].entries.map((e) => e.item.Id)).toEqual(['b', 'c'])
  })

  /*
    The server sorts, but a page assembled from several requests — or a server
    that has never been asked to sort — must still read newest first, or the
    day headings repeat down the page.
  */
  it('puts items back in order when they arrive shuffled', () => {
    const groups = groupWatchHistory(
      [
        movie('old', '2026-05-10T09:00:00Z'),
        movie('new', '2026-05-12T09:00:00Z'),
        movie('mid', '2026-05-12T01:00:00Z'),
      ],
      UTC,
    )

    expect(groups.map((g) => g.label)).toEqual(['Today', 'Sunday 10 May'])
    expect(groups[0].entries.map((e) => e.item.Id)).toEqual(['new', 'mid'])
  })

  /*
    Items marked watched by a tool that never set a date still happened, and
    dropping them makes the page quietly lie about what is on the server.
  */
  it('keeps items with no played date, in a group of their own at the end', () => {
    const groups = groupWatchHistory(
      [movie('dated', '2026-05-12T09:00:00Z'), movie('undated', null)],
      UTC,
    )

    expect(groups).toHaveLength(2)
    expect(groups[1].label).toBe('Date unknown')
    expect(groups[1].entries.map((e) => e.item.Id)).toEqual(['undated'])
    expect(groups[1].entries[0].playedAt).toBeNull()
  })

  it('ignores a played date the server sent as something unparseable', () => {
    const groups = groupWatchHistory([movie('junk', 'not-a-date')], UTC)

    expect(groups.map((g) => g.label)).toEqual(['Date unknown'])
  })

  /*
    The whole point of the day headings. 22:30 in New York is already tomorrow
    in UTC, so grouping on the ISO string puts last night's film under Today
    for every viewer west of Greenwich — for half of every day the heading is
    simply wrong.
  */
  it('groups by the viewer’s calendar day, not UTC', () => {
    const lateLastNight = [movie('film', '2026-05-12T02:30:00Z')]

    expect(groupWatchHistory(lateLastNight, UTC).map((g) => g.label)).toEqual(['Today'])
    expect(
      groupWatchHistory(lateLastNight, { ...UTC, timeZone: 'America/New_York' }).map(
        (g) => g.label,
      ),
    ).toEqual(['Yesterday'])
    // And it is wrong the other way east of Greenwich, where "now" is already
    // the following day and the same instant was yesterday afternoon.
    expect(
      groupWatchHistory(lateLastNight, { ...UTC, timeZone: 'Australia/Sydney' }).map(
        (g) => g.label,
      ),
    ).toEqual(['Yesterday'])
  })

  it('names older days by their date, and adds the year once it is not this one', () => {
    const groups = groupWatchHistory(
      [movie('a', '2026-05-04T12:00:00Z'), movie('b', '2025-12-31T12:00:00Z')],
      UTC,
    )

    expect(groups[0].label).toBe('Monday 4 May')
    expect(groups[1].label).toBe('31 December 2025')
  })

  it('gives each day a key that survives a re-render', () => {
    const groups = groupWatchHistory([movie('a', '2026-05-04T12:00:00Z')], UTC)

    expect(groups[0].key).toBe('2026-05-04')
  })

  it('links an episode to its series and a film to itself', () => {
    const groups = groupWatchHistory(
      [movie('film', '2026-05-12T10:00:00Z'), episode('e1', '2026-05-12T09:00:00Z', 'Show', 1, 1)],
      UTC,
    )

    expect(groups[0].entries[0].href).toBe('/item/film')
    expect(groups[0].entries[1].href).toBe('/item/series-Show')
  })
})

describe('groupWatchHistory episode collapsing', () => {
  it('folds a run of one series’ episodes into a single entry', () => {
    const groups = groupWatchHistory(
      [
        episode('e4', '2026-05-12T13:00:00Z', 'Show', 1, 4),
        episode('e3', '2026-05-12T12:00:00Z', 'Show', 1, 3),
        episode('e2', '2026-05-12T11:00:00Z', 'Show', 1, 2),
        episode('e1', '2026-05-12T10:00:00Z', 'Show', 1, 1),
      ],
      UTC,
    )

    expect(groups[0].entries).toHaveLength(1)
    const [entry] = groups[0].entries
    expect(entry.episodeCount).toBe(4)
    expect(entry.item.Id).toBe('e4')
    expect(entry.playedAt).toBe('2026-05-12T13:00:00Z')
    expect(entry.episodeLabel).toBe('S1:E1–E4')
  })

  /*
    Only consecutive episodes fold. Watching an episode, a film, then another
    episode is three things that happened in that order, and merging the two
    halves of the evening would put the film in the middle of one row.
  */
  it('does not fold across something else watched in between', () => {
    const groups = groupWatchHistory(
      [
        episode('e2', '2026-05-12T13:00:00Z', 'Show', 1, 2),
        movie('film', '2026-05-12T12:00:00Z'),
        episode('e1', '2026-05-12T11:00:00Z', 'Show', 1, 1),
      ],
      UTC,
    )

    expect(groups[0].entries.map((e) => e.item.Id)).toEqual(['e2', 'film', 'e1'])
    expect(groups[0].entries.every((e) => e.episodeCount === 1)).toBe(true)
  })

  it('does not fold two different series that happen to be adjacent', () => {
    const groups = groupWatchHistory(
      [
        episode('b1', '2026-05-12T13:00:00Z', 'Other', 1, 1),
        episode('a1', '2026-05-12T12:00:00Z', 'Show', 1, 1),
      ],
      UTC,
    )

    expect(groups[0].entries).toHaveLength(2)
  })

  /*
    A binge that runs past midnight is two evenings on the page, and a row can
    only sit under one heading.
  */
  it('does not fold a run that crosses midnight', () => {
    const groups = groupWatchHistory(
      [
        episode('e2', '2026-05-12T00:20:00Z', 'Show', 1, 2),
        episode('e1', '2026-05-11T23:40:00Z', 'Show', 1, 1),
      ],
      UTC,
    )

    expect(groups.map((g) => g.entries.length)).toEqual([1, 1])
  })

  it('counts rather than ranges when the episodes are not contiguous', () => {
    const groups = groupWatchHistory(
      [
        episode('e5', '2026-05-12T13:00:00Z', 'Show', 1, 5),
        episode('e3', '2026-05-12T12:00:00Z', 'Show', 1, 3),
        episode('e1', '2026-05-12T11:00:00Z', 'Show', 1, 1),
      ],
      UTC,
    )

    expect(groups[0].entries[0].episodeLabel).toBe('3 episodes')
  })

  it('counts rather than ranges across a season boundary', () => {
    const groups = groupWatchHistory(
      [
        episode('s2e1', '2026-05-12T13:00:00Z', 'Show', 2, 1),
        episode('s1e10', '2026-05-12T12:00:00Z', 'Show', 1, 10),
      ],
      UTC,
    )

    expect(groups[0].entries[0].episodeCount).toBe(2)
    expect(groups[0].entries[0].episodeLabel).toBe('2 episodes')
  })

  it('labels a lone episode with its number and leaves a film unlabelled', () => {
    const groups = groupWatchHistory(
      [episode('e1', '2026-05-12T13:00:00Z', 'Show', 2, 5), movie('film', '2026-05-12T12:00:00Z')],
      UTC,
    )

    expect(groups[0].entries[0].episodeLabel).toBe('S2:E5')
    expect(groups[0].entries[1].episodeLabel).toBeNull()
  })
})

describe('formatPlayedTime', () => {
  it('reads the clock the viewer was watching by', () => {
    expect(formatPlayedTime('2026-05-12T02:30:00Z', { timeZone: 'UTC', locale: 'en-GB' })).toBe(
      '2:30',
    )
    expect(
      formatPlayedTime('2026-05-12T02:30:00Z', { timeZone: 'America/New_York', locale: 'en-GB' }),
    ).toBe('22:30')
  })

  it('has nothing to show for a missing or unparseable date', () => {
    expect(formatPlayedTime(null, { timeZone: 'UTC', locale: 'en-GB' })).toBeNull()
    expect(formatPlayedTime(undefined, { timeZone: 'UTC', locale: 'en-GB' })).toBeNull()
    expect(formatPlayedTime('nonsense', { timeZone: 'UTC', locale: 'en-GB' })).toBeNull()
  })
})

describe('buildHeatmap', () => {
  const days = (...e: [string, number][]) => new Map(e)
  // 2026-09-01 is a Tuesday.
  const map = buildHeatmap(days(['2026-08-31', 3]), { today: '2026-09-01', weeks: 4 })

  it('lays out whole weeks of seven', () => {
    expect(map.weeks).toHaveLength(4)
    for (const week of map.weeks) expect(week).toHaveLength(7)
  })

  it('ends on the Saturday of this week, so today is never in a half week', () => {
    // Tuesday the 1st → the grid runs to Saturday the 5th.
    expect(map.weeks.at(-1)?.at(-1)?.key).toBe('2026-09-05')
  })

  it('counts only the days inside the window', () => {
    expect(map.totalDays).toBe(1)
    expect(map.busiest).toBe(3)
    const cell = map.weeks.flat().find((c) => c.key === '2026-08-31')
    expect(cell?.count).toBe(3)
  })

  it('leaves a day with nothing on it at level zero', () => {
    expect(map.weeks.flat().find((c) => c.key === '2026-08-30')?.level).toBe(0)
  })

  it('buckets rather than scaling smoothly', () => {
    // One binge at the top of the range must not flatten every ordinary day
    // into the same shade.
    const busy = buildHeatmap(days(['2026-08-25', 40], ['2026-08-26', 4], ['2026-08-27', 1]), {
      today: '2026-09-01',
      weeks: 4,
    })
    const level = (k: string) => busy.weeks.flat().find((c) => c.key === k)?.level
    expect(level('2026-08-25')).toBe(4)
    expect(level('2026-08-26')).toBeGreaterThan(0)
    expect(level('2026-08-26')).toBeLessThan(4)
    expect(level('2026-08-27')).toBeGreaterThan(0)
  })

  it('names a month once per run, at the column it starts in', () => {
    // 53 weeks is a little over a year, so the starting month legitimately
    // comes round again at the far end — the invariant is that no two
    // *adjacent* labels repeat, not that the whole list is unique.
    const year = buildHeatmap(days(), { today: '2026-09-01', weeks: 53, locale: 'en-US' })
    const labels = year.months.map((m) => m.label)
    expect(labels.every((l, i) => i === 0 || l !== labels[i - 1])).toBe(true)
    expect(year.months.every((m, i) => i === 0 || m.column > year.months[i - 1].column)).toBe(true)
    expect(labels.length).toBeGreaterThanOrEqual(12)
  })

  it('returns an empty grid rather than throwing on a junk date', () => {
    expect(buildHeatmap(days(['2026-01-01', 1]), { today: 'nonsense' }).weeks).toEqual([])
  })
})

describe('summariseDay', () => {
  const entry = (over: Partial<HistoryEntry>): HistoryEntry =>
    ({ key: 's1:1', item: {}, playedAt: null, episodeCount: 1, episodeLabel: 'S1:E1', href: null, ...over }) as HistoryEntry
  const day = (entries: HistoryEntry[]): HistoryDay => ({ key: '2026-01-01', label: 'x', entries })

  it('adds the folded episodes up rather than counting rows', () => {
    expect(summariseDay(day([entry({ episodeCount: 4, episodeLabel: '4 episodes' })]))).toBe(
      '4 episodes',
    )
  })

  it('mentions how many shows only when there was more than one', () => {
    const one = day([entry({ key: 's1:1' }), entry({ key: 's1:2' })])
    expect(summariseDay(one)).toBe('2 episodes')
    const two = day([entry({ key: 's1:1' }), entry({ key: 's2:1' })])
    expect(summariseDay(two)).toBe('2 episodes · across 2 shows')
  })

  it('counts films separately from episodes', () => {
    const mixed = day([entry({}), entry({ key: 'm1', episodeLabel: null })])
    expect(summariseDay(mixed)).toBe('1 episode · 1 film')
  })

  it('says nothing about a day with nothing in it', () => {
    expect(summariseDay(day([]))).toBe('')
  })
})

describe('filterHistory', () => {
  const ep = { key: 's1:1', item: {}, playedAt: null, episodeCount: 1, episodeLabel: 'S1:E1', href: null } as HistoryEntry
  const film = { key: 'm1', item: {}, playedAt: null, episodeCount: 1, episodeLabel: null, href: null } as HistoryEntry
  const days: HistoryDay[] = [
    { key: 'a', label: 'A', entries: [ep, film] },
    { key: 'b', label: 'B', entries: [ep] },
  ]

  it('leaves everything alone on "all"', () => {
    expect(filterHistory(days, 'all')).toEqual(days)
  })

  it('keeps only what was asked for', () => {
    expect(filterHistory(days, 'films').flatMap((d) => d.entries)).toEqual([film])
    expect(filterHistory(days, 'shows').flatMap((d) => d.entries)).toHaveLength(2)
  })

  it('drops a day that empties out rather than leaving a bare heading', () => {
    // A date with nothing under it reads as a bug, not as "no films that day".
    expect(filterHistory(days, 'films').map((d) => d.key)).toEqual(['a'])
  })
})

describe('buildHeatmap month labels do not collide', () => {
  it('drops a label with no room before the next month', () => {
    // A 53-week window routinely starts a few days before a month boundary.
    // Two labels one column apart print on top of each other.
    for (const today of ['2026-09-01', '2026-03-02', '2026-12-31', '2027-01-01']) {
      const map = buildHeatmap(new Map(), { today, weeks: 53, locale: 'en-US' })
      for (let i = 1; i < map.months.length; i++) {
        expect(
          map.months[i].column - map.months[i - 1].column,
          `labels collide on ${today}`,
        ).toBeGreaterThanOrEqual(3)
      }
    }
  })
})

describe('heatCellLabel', () => {
  const at = (key: string | null, count: number) =>
    heatCellLabel({ key, count }, { locale: 'en-GB' })

  /*
    Asserted by part rather than as one string. The exact punctuation is the
    platform's — en-GB emits "Fri, 7 Aug 2026" — and pinning it would make this
    a test of Intl's comma rather than of what the square says.
  */
  it('reads as a date rather than as the key the grid is built from', () => {
    const label = at('2026-08-07', 19)!
    expect(label).not.toContain('2026-08-07')
    for (const part of ['Fri', '7', 'Aug', '2026', '19 episodes']) {
      expect(label).toContain(part)
    }
  })

  it('says so plainly when nothing happened', () => {
    expect(at('2026-08-06', 0)).toContain('nothing')
    expect(at('2026-08-06', 0)).not.toContain('episode')
  })

  it('gets the singular right', () => {
    expect(at('2026-08-05', 1)).toContain('1 episode')
    expect(at('2026-08-05', 1)).not.toContain('episodes')
  })

  it('reads the day off the calendar date, not off midnight', () => {
    // Parsed at midnight, a negative offset rolls this to the 31st and the
    // square would name the wrong day in half the world.
    expect(at('2026-08-01', 0)).toContain('1 Aug')
    expect(at('2026-01-01', 0)).toContain('1 Jan 2026')
  })

  it('has nothing to say about a pad square', () => {
    expect(at(null, 0)).toBeNull()
  })
})

describe('the heatmap walks its own year', () => {
  const played = (day: string): BaseItemDto =>
    ({ Id: day, UserData: { LastPlayedDate: `${day}T12:00:00Z` } }) as BaseItemDto
  const many = (n: number, day: string) => Array.from({ length: n }, () => played(day))

  it('starts a year and a bit before today, on a whole week', () => {
    // 2026-09-01 is a Tuesday, so the grid ends Saturday the 5th.
    expect(heatmapWindowStart('2026-09-01', 53)).toBe('2025-08-31')
  })

  it('keeps asking while everything loaded is still inside the window', () => {
    const opts = { windowStart: '2025-08-31', total: 5000, timeZone: 'UTC' }
    expect(nextHeatmapPage(many(200, '2026-05-01'), opts)).toBe(200)
  })

  it('stops on the first thing played before the window', () => {
    // There is no server-side filter on played date, so the walk has to
    // recognise its own edge.
    const opts = { windowStart: '2025-08-31', total: 5000, timeZone: 'UTC' }
    expect(nextHeatmapPage([...many(199, '2026-05-01'), played('2025-08-30')], opts)).toBeUndefined()
  })

  it('does not stop on the day the window opens', () => {
    const opts = { windowStart: '2025-08-31', total: 5000, timeZone: 'UTC' }
    expect(nextHeatmapPage([...many(199, '2026-05-01'), played('2025-08-31')], opts)).toBe(200)
  })

  it('stops at the cap however much history there is', () => {
    const opts = { windowStart: '2000-01-01', total: 100000, timeZone: 'UTC' }
    expect(nextHeatmapPage(many(HEATMAP_MAX_ITEMS, '2026-05-01'), opts)).toBeUndefined()
  })

  it('stops when the server has no more to give', () => {
    const opts = { windowStart: '2025-08-31', total: 50, timeZone: 'UTC' }
    expect(nextHeatmapPage(many(50, '2026-05-01'), opts)).toBeUndefined()
  })

  it('keeps going past an unreadable date rather than stopping early', () => {
    // A missing date cannot prove the edge was reached; the cap is what stops
    // the walk in that case, not a guess.
    const opts = { windowStart: '2025-08-31', total: 5000, timeZone: 'UTC' }
    const undated = { Id: 'x', UserData: {} } as BaseItemDto
    expect(nextHeatmapPage([...many(199, '2026-05-01'), undated], opts)).toBe(200)
  })

  it('asks for no artwork, since the grid is squares', () => {
    expect(heatmapItemsQuery(0).enableImages).toBe(false)
    expect(heatmapItemsQuery(400).startIndex).toBe(400)
  })
})
