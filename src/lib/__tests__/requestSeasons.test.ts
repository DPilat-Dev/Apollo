import { describe, expect, it } from 'vitest'
import { MediaStatus } from '../jellyseerr'
import {
  listedSeasons,
  metaLine,
  requestLabel,
  requestedAnnouncement,
  runtimeText,
  seasonCountLabel,
  seasonSelectable,
  seasonState,
  seasonStatusOf,
  seasonSublabel,
  seasonTitle,
  defaultSeasonSelection,
  nothingRequestable,
  toggleSeason,
  type SeerrSeason,
  type SeerrSeasonState,
} from '../requestSeasons'

const season = (seasonNumber: number, episodeCount = 10, airDate: string | null = '2022-03-18') =>
  ({ id: seasonNumber, seasonNumber, episodeCount, airDate }) as SeerrSeason

describe('listedSeasons', () => {
  it('orders by season number', () => {
    const out = listedSeasons([season(3), season(1), season(2)])
    expect(out.map((s) => s.seasonNumber)).toEqual([1, 2, 3])
  })

  /*
    Specials are season 0, which sorts first numerically and is almost never
    what somebody came to request. Last, so the list opens on season one.
  */
  it('puts specials after the numbered seasons', () => {
    const out = listedSeasons([season(0), season(2), season(1)])
    expect(out.map((s) => s.seasonNumber)).toEqual([1, 2, 0])
  })

  /*
    TMDB carries announced-but-empty seasons — a "Season 4" with no episodes in
    it. Jellyseerr will accept a request for one and Sonarr has nothing to
    fetch, so offering it is offering a request that cannot complete.
  */
  it('drops a season with no episodes in it', () => {
    const out = listedSeasons([season(1), season(2, 0)])
    expect(out.map((s) => s.seasonNumber)).toEqual([1])
  })

  it('survives a missing episode count rather than dropping the season', () => {
    const out = listedSeasons([{ id: 9, seasonNumber: 1 } as SeerrSeason])
    expect(out.map((s) => s.seasonNumber)).toEqual([1])
  })

  it('has nothing to say about nothing', () => {
    expect(listedSeasons(undefined)).toEqual([])
  })
})

describe('seasonStatusOf', () => {
  const states: SeerrSeasonState[] = [
    { seasonNumber: 1, status: MediaStatus.AVAILABLE },
    { seasonNumber: 2, status: MediaStatus.PENDING },
  ]

  it('finds the status a season was given', () => {
    expect(seasonStatusOf(states, 1)).toBe(MediaStatus.AVAILABLE)
    expect(seasonStatusOf(states, 2)).toBe(MediaStatus.PENDING)
  })

  /*
    A season Jellyseerr has never heard of is not "unknown status", it is a
    season nobody has asked for — which is exactly the requestable case.
  */
  it('reads an unmentioned season as untouched', () => {
    expect(seasonStatusOf(states, 3)).toBe(MediaStatus.UNKNOWN)
    expect(seasonStatusOf(undefined, 1)).toBe(MediaStatus.UNKNOWN)
  })
})

describe('seasonSelectable', () => {
  it('offers what nobody has asked for', () => {
    expect(seasonSelectable(MediaStatus.UNKNOWN)).toBe(true)
  })

  /*
    Same call `availability` makes for a whole title: partly available means
    some episodes are missing, so asking again is the way to get them.
  */
  it('offers a season that is only partly here', () => {
    expect(seasonSelectable(MediaStatus.PARTIALLY_AVAILABLE)).toBe(true)
  })

  it('refuses one already here, coming, or asked for', () => {
    expect(seasonSelectable(MediaStatus.AVAILABLE)).toBe(false)
    expect(seasonSelectable(MediaStatus.PROCESSING)).toBe(false)
    expect(seasonSelectable(MediaStatus.PENDING)).toBe(false)
  })
})

describe('seasonState', () => {
  it('says why a season cannot be asked for', () => {
    expect(seasonState(MediaStatus.AVAILABLE)).toEqual({ note: 'In library', selectable: false })
    expect(seasonState(MediaStatus.PROCESSING)).toEqual({ note: 'Downloading', selectable: false })
    expect(seasonState(MediaStatus.PENDING)).toEqual({ note: 'Requested', selectable: false })
  })

  it('marks a partly-here season as both', () => {
    expect(seasonState(MediaStatus.PARTIALLY_AVAILABLE)).toEqual({
      note: 'Some episodes here',
      selectable: true,
    })
  })

  /* Nothing to say about a season in the ordinary state. */
  it('says nothing about an untouched season', () => {
    expect(seasonState(MediaStatus.UNKNOWN)).toEqual({ note: null, selectable: true })
  })
})

describe('seasonTitle', () => {
  it('names specials rather than calling them season zero', () => {
    expect(seasonTitle(season(0))).toBe('Specials')
  })

  it('numbers the rest', () => {
    expect(seasonTitle(season(4))).toBe('Season 4')
  })

  /*
    TMDB's own name is used only when it is not the number we already print.
    Most shows carry name: "Season 4", which would read "Season 4 · Season 4".
  */
  it('prefers a real name over the number', () => {
    expect(seasonTitle({ ...season(1), name: 'Book One: Water' })).toBe('Book One: Water')
    expect(seasonTitle({ ...season(1), name: 'Season 1' })).toBe('Season 1')
  })
})

describe('seasonSublabel', () => {
  it('counts the episodes and dates the season', () => {
    expect(seasonSublabel(season(1, 9, '2022-03-18'))).toBe('9 episodes · 2022')
  })

  it('does not pluralise a single episode', () => {
    expect(seasonSublabel(season(1, 1))).toBe('1 episode · 2022')
  })

  it('leaves out what it does not know', () => {
    expect(seasonSublabel({ id: 1, seasonNumber: 1, episodeCount: 6 } as SeerrSeason)).toBe(
      '6 episodes',
    )
    expect(seasonSublabel({ id: 1, seasonNumber: 1, airDate: '2019-01-01' } as SeerrSeason)).toBe(
      '2019',
    )
    expect(seasonSublabel({ id: 1, seasonNumber: 1 } as SeerrSeason)).toBe('')
  })
})

describe('defaultSeasonSelection', () => {
  const listed = listedSeasons([season(0), season(1), season(2), season(3)])
  const states: SeerrSeasonState[] = [{ seasonNumber: 1, status: MediaStatus.AVAILABLE }]

  it('ticks every season that can be asked for', () => {
    expect(defaultSeasonSelection(listed, states, true)).toEqual([2, 3])
  })

  /*
    The Settings toggle says "only the first season". Taken literally on a show
    whose season one is already in the library, that ticks a box the dialog
    then has to disable — so it means the first season still worth asking for.
  */
  it('ticks only the first askable one when whole series is off', () => {
    expect(defaultSeasonSelection(listed, states, false)).toEqual([2])
  })

  /*
    Specials are never ticked for you. They are listed, so somebody who wants
    them can say so, but "request the whole series" is not a request for them.
  */
  it('never ticks specials', () => {
    const all = defaultSeasonSelection(listed, [], true)
    expect(all).toEqual([1, 2, 3])
    expect(defaultSeasonSelection([season(0)], [], true)).toEqual([])
  })

  it('ticks nothing when the whole show is already here', () => {
    const here = listed.map((s) => ({ seasonNumber: s.seasonNumber, status: MediaStatus.AVAILABLE }))
    expect(defaultSeasonSelection(listed, here, true)).toEqual([])
  })
})

describe('toggleSeason', () => {
  it('adds one that was not picked', () => {
    expect(toggleSeason([1, 3], 2)).toEqual([1, 2, 3])
  })

  it('removes one that was', () => {
    expect(toggleSeason([1, 2, 3], 2)).toEqual([1, 3])
  })

  /* Sorted, because the payload and the button's count both read better for it. */
  it('keeps the list in order', () => {
    expect(toggleSeason([3, 1], 2)).toEqual([1, 2, 3])
  })

  it('cannot pick the same season twice', () => {
    expect(toggleSeason([1, 2], 1)).toEqual([2])
    expect(toggleSeason(toggleSeason([], 5), 5)).toEqual([])
  })
})

describe('nothingRequestable', () => {
  const listed = listedSeasons([season(1), season(2)])

  it('is true when every listed season is spoken for', () => {
    expect(
      nothingRequestable(listed, [
        { seasonNumber: 1, status: MediaStatus.AVAILABLE },
        { seasonNumber: 2, status: MediaStatus.PENDING },
      ]),
    ).toBe(true)
  })

  it('is false while one can still be asked for', () => {
    expect(nothingRequestable(listed, [{ seasonNumber: 1, status: MediaStatus.AVAILABLE }])).toBe(
      false,
    )
  })

  /*
    A show with no seasons listed at all is not "all available" — it is a show
    we know nothing about, and the dialog must not claim it is in the library.
  */
  it('is false when there are no seasons to speak of', () => {
    expect(nothingRequestable([], [])).toBe(false)
  })
})

describe('requestLabel', () => {
  it('says how many seasons it is about to ask for', () => {
    expect(requestLabel(3)).toBe('Request 3 seasons')
  })

  it('does not pluralise one', () => {
    expect(requestLabel(1)).toBe('Request 1 season')
  })

  /*
    Disabled with nothing ticked, so the label is an instruction rather than a
    promise to request nothing.
  */
  it('asks for a choice when nothing is ticked', () => {
    expect(requestLabel(0)).toBe('Select a season')
  })
})

describe('requestedAnnouncement', () => {
  /*
    Read out, so it has to be a sentence rather than the button's label. The
    numbers are spelled out because "Requested 2 seasons" and "Requested
    seasons 2 and 3" are different facts and only one of them is true.
  */
  it('names the seasons it sent', () => {
    expect(requestedAnnouncement([3])).toBe('Requested season 3.')
    expect(requestedAnnouncement([2, 3])).toBe('Requested seasons 2 and 3.')
    expect(requestedAnnouncement([1, 2, 4])).toBe('Requested seasons 1, 2 and 4.')
  })

  it('names specials by name', () => {
    expect(requestedAnnouncement([0])).toBe('Requested specials.')
    expect(requestedAnnouncement([0, 1])).toBe('Requested specials and season 1.')
  })

  it('says it plainly for a film', () => {
    expect(requestedAnnouncement([])).toBe('Requested.')
  })
})

describe('runtimeText', () => {
  it('splits minutes into hours and minutes', () => {
    expect(runtimeText(107)).toBe('1h 47m')
    expect(runtimeText(120)).toBe('2h')
    expect(runtimeText(47)).toBe('47m')
  })

  it('has nothing to say about a runtime it was not given', () => {
    expect(runtimeText(undefined)).toBeNull()
    expect(runtimeText(0)).toBeNull()
  })
})

describe('seasonCountLabel', () => {
  it('counts seasons', () => {
    expect(seasonCountLabel(3)).toBe('3 seasons')
    expect(seasonCountLabel(1)).toBe('1 season')
  })

  it('says nothing about none', () => {
    expect(seasonCountLabel(0)).toBeNull()
    expect(seasonCountLabel(undefined)).toBeNull()
  })
})

describe('metaLine', () => {
  it('reads year, length and score for a film', () => {
    expect(metaLine({ year: '2022', runtime: 107, voteAverage: 7.43 })).toBe('2022 · 1h 47m · 7.4')
  })

  it('reads year and seasons for a show', () => {
    expect(metaLine({ year: '2022', seasons: 3, voteAverage: 8 })).toBe('2022 · 3 seasons · 8.0')
  })

  /*
    TMDB answers 0 for a title nobody has scored, which is a missing score and
    not a score of zero — printing it calls every unrated film the worst film.
  */
  it('leaves out an unscored title', () => {
    expect(metaLine({ year: '2022', voteAverage: 0 })).toBe('2022')
  })

  it('is empty when it knows nothing', () => {
    expect(metaLine({})).toBe('')
  })
})
