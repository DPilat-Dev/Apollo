import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import {
  HISTORY_MAX_ITEMS,
  HISTORY_PAGE_SIZE,
  formatPlayedTime,
  groupWatchHistory,
  historyItemsQuery,
  nextHistoryPage,
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
