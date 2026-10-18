import { describe, expect, it } from 'vitest'
import {
  NO_FILTERS,
  activeFilters,
  clearFilter,
  decadeOptions,
  CONTAINER_SORTS,
  CURATED_SORT,
  SORTS,
  sortContextFor,
  filterCacheKey,
  filtersToParams,
  genreOptions,
  isFilterActive,
  LETTERS,
  letterApplies,
  letterLabel,
  letterQuery,
  nextLetterIndex,
  parseFilters,
  parseLetter,
  parseSort,
  parseYearRange,
  ratingOptions,
  toItemsQuery,
  toSortQuery,
  yearRangeValue,
  type LibraryFilters,
} from '../libraryFilters'

const parse = (search: string) => parseFilters(new URLSearchParams(search))

describe('parseFilters', () => {
  it('reads an empty URL as no filters at all', () => {
    expect(parse('')).toEqual(NO_FILTERS)
    expect(isFilterActive(parse(''))).toBe(false)
  })

  it('reads every filter the panel writes', () => {
    const f = parse(
      'genre=Horror&watched=unwatched&yearFrom=1990&yearTo=1999&minRating=7.5&hasSubs=1&letter=M',
    )
    expect(f).toEqual({
      genre: 'Horror',
      watched: 'unwatched',
      yearFrom: 1990,
      yearTo: 1999,
      minRating: 7.5,
      subtitles: true,
      letter: 'M',
    })
  })

  it('ignores keys it does not know', () => {
    expect(parse('nonsense=1&genre=Horror&sort=rating')).toEqual({
      ...NO_FILTERS,
      genre: 'Horror',
    })
  })

  it('drops a year that is not a year', () => {
    expect(parse('yearFrom=abc').yearFrom).toBeNull()
    expect(parse('yearFrom=').yearFrom).toBeNull()
    expect(parse('yearFrom=99').yearFrom).toBeNull()
    expect(parse('yearTo=1990.5').yearTo).toBeNull()
    expect(parse('yearTo=99999').yearTo).toBeNull()
    expect(parse('yearFrom=-1990').yearFrom).toBeNull()
    expect(isFilterActive(parse('yearFrom=abc'))).toBe(false)
  })

  it('clamps a rating into the range a rating can have', () => {
    expect(parse('minRating=99').minRating).toBe(10)
    expect(parse('minRating=7').minRating).toBe(7)
    expect(parse('minRating=abc').minRating).toBeNull()
    expect(parse('minRating=0').minRating).toBeNull()
    expect(parse('minRating=-4').minRating).toBeNull()
  })

  it('rights a range typed backwards rather than returning nothing', () => {
    const f = parse('yearFrom=2010&yearTo=1990')
    expect(f.yearFrom).toBe(1990)
    expect(f.yearTo).toBe(2010)
  })

  it('falls back to all for a watched state it does not recognise', () => {
    expect(parse('watched=unwatched').watched).toBe('unwatched')
    expect(parse('watched=watched').watched).toBe('watched')
    expect(parse('watched=maybe').watched).toBe('all')
    expect(parse('watched=').watched).toBe('all')
  })

  it('treats only affirmative values as a subtitle filter', () => {
    expect(parse('hasSubs=1').subtitles).toBe(true)
    expect(parse('hasSubs=true').subtitles).toBe(true)
    expect(parse('hasSubs=0').subtitles).toBe(false)
    expect(parse('hasSubs=nope').subtitles).toBe(false)
  })

  it('trims a genre and treats blank as unset', () => {
    expect(parse('genre=%20Horror%20').genre).toBe('Horror')
    expect(parse('genre=%20%20').genre).toBe('')
    expect(isFilterActive(parse('genre=%20%20'))).toBe(false)
  })
})

describe('filtersToParams', () => {
  it('writes only the filters that are set', () => {
    expect(filtersToParams({ ...NO_FILTERS, watched: 'unwatched' }).toString()).toBe(
      'watched=unwatched',
    )
    expect(filtersToParams(NO_FILTERS).toString()).toBe('')
  })

  it('round-trips every filter', () => {
    const f = {
      genre: 'Horror',
      watched: 'watched' as const,
      yearFrom: 1990,
      yearTo: 1999,
      minRating: 7.5,
      subtitles: true,
      letter: 'M',
    }
    expect(parseFilters(filtersToParams(f))).toEqual(f)
  })

  it('heals a hand-edited URL: serialising what was parsed normalises it', () => {
    const junk = new URLSearchParams('minRating=99&yearFrom=2010&yearTo=1990&watched=maybe')
    const once = filtersToParams(parseFilters(junk))
    const twice = filtersToParams(parseFilters(once))
    expect(once.toString()).toBe(twice.toString())
    expect(once.get('minRating')).toBe('10')
    expect(once.get('yearFrom')).toBe('1990')
    expect(once.get('watched')).toBeNull()
  })

  it('leaves params it does not own alone', () => {
    const base = new URLSearchParams('personIds=abc&sort=rating&genre=Horror')
    const next = filtersToParams({ ...NO_FILTERS, watched: 'unwatched' }, base)
    expect(next.get('personIds')).toBe('abc')
    expect(next.get('sort')).toBe('rating')
    // The genre filter was cleared, so its param must go with it.
    expect(next.get('genre')).toBeNull()
    expect(next.get('watched')).toBe('unwatched')
  })
})

describe('isFilterActive / activeFilters / clearFilter', () => {
  it('is active for any single filter on its own', () => {
    expect(isFilterActive({ ...NO_FILTERS, genre: 'Horror' })).toBe(true)
    expect(isFilterActive({ ...NO_FILTERS, watched: 'unwatched' })).toBe(true)
    expect(isFilterActive({ ...NO_FILTERS, watched: 'watched' })).toBe(true)
    expect(isFilterActive({ ...NO_FILTERS, yearFrom: 1990 })).toBe(true)
    expect(isFilterActive({ ...NO_FILTERS, yearTo: 1999 })).toBe(true)
    expect(isFilterActive({ ...NO_FILTERS, minRating: 7 })).toBe(true)
    expect(isFilterActive({ ...NO_FILTERS, subtitles: true })).toBe(true)
  })

  it('names each active filter so the grid can say what is hiding things', () => {
    const f = {
      genre: 'Horror',
      watched: 'unwatched' as const,
      yearFrom: 1990,
      yearTo: 1999,
      minRating: 7,
      subtitles: true,
      letter: 'M',
    }
    const labels = activeFilters(f).map((c) => c.label)
    expect(labels).toContain('Horror')
    expect(labels).toContain('Starts with M')
    expect(labels).toContain('Unwatched')
    expect(labels).toContain('1990–1999')
    expect(labels).toContain('7+ rating')
    expect(labels).toContain('Has subtitles')
    expect(activeFilters(NO_FILTERS)).toEqual([])
  })

  it('describes an open-ended year range in words', () => {
    expect(activeFilters({ ...NO_FILTERS, yearFrom: 2020 })[0].label).toBe('2020 & newer')
    expect(activeFilters({ ...NO_FILTERS, yearTo: 1979 })[0].label).toBe('1979 & older')
    expect(activeFilters({ ...NO_FILTERS, yearFrom: 1994, yearTo: 1994 })[0].label).toBe('1994')
  })

  it('clears one filter without disturbing the others', () => {
    const f = { ...NO_FILTERS, genre: 'Horror', watched: 'unwatched' as const, minRating: 7 }
    const cleared = clearFilter(f, 'watched')
    expect(cleared.watched).toBe('all')
    expect(cleared.genre).toBe('Horror')
    expect(cleared.minRating).toBe(7)
  })

  it('clears both bounds when the year chip is dismissed', () => {
    const f = { ...NO_FILTERS, yearFrom: 1990, yearTo: 1999 }
    expect(clearFilter(f, 'year')).toEqual(NO_FILTERS)
  })

  it('every chip it names can be cleared, and clearing them all leaves nothing', () => {
    let f: LibraryFilters = {
      genre: 'Horror',
      watched: 'watched',
      yearFrom: 1990,
      yearTo: 1999,
      minRating: 7,
      subtitles: true,
      letter: 'M',
    }
    for (const chip of activeFilters(f)) f = clearFilter(f, chip.key)
    expect(f).toEqual(NO_FILTERS)
    expect(isFilterActive(f)).toBe(false)
  })
})

describe('toItemsQuery', () => {
  it('sends nothing when nothing is filtered', () => {
    expect(toItemsQuery(NO_FILTERS, 2026)).toEqual({
      genres: undefined,
      isPlayed: undefined,
      years: undefined,
      minCommunityRating: undefined,
      hasSubtitles: undefined,
      nameStartsWithOrGreater: undefined,
      nameLessThan: undefined,
    })
  })

  it('maps watched state onto isPlayed', () => {
    expect(toItemsQuery({ ...NO_FILTERS, watched: 'unwatched' }, 2026).isPlayed).toBe(false)
    expect(toItemsQuery({ ...NO_FILTERS, watched: 'watched' }, 2026).isPlayed).toBe(true)
    expect(toItemsQuery(NO_FILTERS, 2026).isPlayed).toBeUndefined()
  })

  it('expands a year range into the list of years Jellyfin wants', () => {
    expect(toItemsQuery({ ...NO_FILTERS, yearFrom: 1990, yearTo: 1993 }, 2026).years).toEqual([
      1990, 1991, 1992, 1993,
    ])
    expect(toItemsQuery({ ...NO_FILTERS, yearFrom: 1994, yearTo: 1994 }, 2026).years).toEqual([1994])
  })

  it('closes an open upper bound at the current year, not at infinity', () => {
    const years = toItemsQuery({ ...NO_FILTERS, yearFrom: 2024 }, 2026).years
    expect(years).toEqual([2024, 2025, 2026])
  })

  it('closes an open lower bound at the oldest year a film could have', () => {
    const years = toItemsQuery({ ...NO_FILTERS, yearTo: 1875 }, 2026).years!
    expect(years[years.length - 1]).toBe(1875)
    expect(years[0]).toBeLessThan(1875)
    expect(years.length).toBeLessThan(100)
  })

  it('passes rating and subtitles straight through', () => {
    const q = toItemsQuery({ ...NO_FILTERS, minRating: 7.5, subtitles: true }, 2026)
    expect(q.minCommunityRating).toBe(7.5)
    expect(q.hasSubtitles).toBe(true)
  })

  it('never sends hasSubtitles=false, which would hide everything unsubtitled', () => {
    expect(toItemsQuery(NO_FILTERS, 2026).hasSubtitles).toBeUndefined()
  })
})

describe('filterCacheKey', () => {
  it('changes when any single filter changes', () => {
    const base = filterCacheKey(NO_FILTERS)
    const variants = [
      { ...NO_FILTERS, genre: 'Horror' },
      { ...NO_FILTERS, watched: 'unwatched' as const },
      { ...NO_FILTERS, watched: 'watched' as const },
      { ...NO_FILTERS, yearFrom: 1990 },
      { ...NO_FILTERS, yearTo: 1999 },
      { ...NO_FILTERS, minRating: 7 },
      { ...NO_FILTERS, subtitles: true },
      { ...NO_FILTERS, letter: 'M' },
      { ...NO_FILTERS, letter: 'N' },
    ]
    const keys = variants.map(filterCacheKey)
    for (const key of keys) expect(key).not.toBe(base)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('genreOptions', () => {
  it('leaves a list that already covers the filter alone', () => {
    expect(genreOptions(['Action', 'Horror'], '')).toEqual(['Action', 'Horror'])
    expect(genreOptions(['Action', 'Horror'], 'Horror')).toEqual(['Action', 'Horror'])
  })

  it('keeps a genre nothing loaded has selectable', () => {
    expect(genreOptions(['Action'], 'Horror')).toEqual(['Horror', 'Action'])
    expect(genreOptions([], 'Horror')).toEqual(['Horror'])
  })
})

describe('ratingOptions', () => {
  it('offers the usual thresholds, highest first', () => {
    expect(ratingOptions(null)).toEqual([9, 8, 7, 6, 5])
  })

  it('keeps a hand-edited threshold selectable rather than blanking the control', () => {
    expect(ratingOptions(7.5)).toEqual([9, 8, 7.5, 7, 6, 5])
    expect(ratingOptions(10)).toEqual([10, 9, 8, 7, 6, 5])
    expect(ratingOptions(1)).toEqual([9, 8, 7, 6, 5, 1])
    expect(ratingOptions(7)).toEqual([9, 8, 7, 6, 5])
  })
})

describe('parseSort', () => {
  it('falls back to the caller default for junk or a missing key', () => {
    expect(parseSort(null, 'added').key).toBe('added')
    expect(parseSort('', 'name').key).toBe('name')
    expect(parseSort('nonsense', 'name').key).toBe('name')
  })

  it('returns the named sort', () => {
    expect(parseSort('rating', 'added').sortBy).toBe('CommunityRating')
    expect(parseSort('rating', 'added').order).toBe('Descending')
    expect(parseSort('name', 'added').sortBy).toBe('SortName')
  })

  /*
    Collection order only exists inside a container, so it is offered from a
    separate list. A grid with no container must not honour `?sort=curated`
    from a pasted link — the server would be asked for no order at all and the
    page would quietly stop sorting.
  */
  it('does not honour the curated key where there is no container', () => {
    expect(parseSort('curated', 'name').key).toBe('name')
    expect(parseSort('curated', 'added', SORTS).key).toBe('added')
    // Typed as a narrower union than CONTAINER_SORTS, hence the widening.
    expect(SORTS.map((s): string => s.key)).not.toContain(CURATED_SORT.key)
  })

  it('honours it inside a container, and defaults to it there', () => {
    expect(parseSort('curated', 'curated', CONTAINER_SORTS).key).toBe('curated')
    expect(parseSort(null, 'curated', CONTAINER_SORTS).key).toBe('curated')
    expect(parseSort('nonsense', 'curated', CONTAINER_SORTS).key).toBe('curated')
  })

  it('leaves every ordinary sort reachable inside a container too', () => {
    expect(parseSort('rating', 'curated', CONTAINER_SORTS).sortBy).toBe('CommunityRating')
    for (const sort of SORTS) {
      expect(CONTAINER_SORTS.some((s) => s.key === sort.key)).toBe(true)
    }
    expect(CONTAINER_SORTS[0].key).toBe('curated')
  })
})

describe('toSortQuery', () => {
  it('asks for no order at all for the curated sort', () => {
    // Not an empty sortBy: `sortBy=` is a parameter the server still reads,
    // and the point is to leave the container in the order its curator chose.
    expect(toSortQuery(parseSort('curated', 'curated', CONTAINER_SORTS))).toEqual({
      sortBy: undefined,
      sortOrder: undefined,
    })
  })

  it('names the field and direction for every other sort', () => {
    expect(toSortQuery(parseSort('rating', 'added'))).toEqual({
      sortBy: ['CommunityRating'],
      sortOrder: ['Descending'],
    })
    for (const sort of SORTS) {
      const q = toSortQuery(sort)
      expect(q.sortBy).toEqual([sort.sortBy])
      expect(q.sortOrder).toEqual([sort.order])
    }
  })
})

describe('decadeOptions', () => {
  it('offers the decades a library plausibly spans, newest first', () => {
    const opts = decadeOptions(2026, NO_FILTERS)
    expect(opts[0].value).toBe('')
    const labels = opts.map((o) => o.label)
    expect(labels).toContain('2020s')
    expect(labels).toContain('1990s')
    expect(new Set(opts.map((o) => o.value)).size).toBe(opts.length)
  })

  it('keeps a hand-edited range selectable instead of showing a blank control', () => {
    const custom = { ...NO_FILTERS, yearFrom: 1977, yearTo: 1983 }
    const opts = decadeOptions(2026, custom)
    const selected = opts.find((o) => o.value === '1977-1983')
    expect(selected).toBeDefined()
    expect(selected!.label).toBe('1977–1983')
  })

  it('round-trips a select value back into a range, junk included', () => {
    expect(parseYearRange('1990-1999')).toEqual({ yearFrom: 1990, yearTo: 1999 })
    expect(parseYearRange('2020-')).toEqual({ yearFrom: 2020, yearTo: null })
    expect(parseYearRange('-1979')).toEqual({ yearFrom: null, yearTo: 1979 })
    expect(parseYearRange('')).toEqual({ yearFrom: null, yearTo: null })
    expect(parseYearRange('nonsense')).toEqual({ yearFrom: null, yearTo: null })
    expect(yearRangeValue({ ...NO_FILTERS, yearFrom: 1990, yearTo: 1999 })).toBe('1990-1999')
    expect(yearRangeValue(NO_FILTERS)).toBe('')
  })

  it('does not add a custom entry for a range that is already a preset', () => {
    const preset = decadeOptions(2026, NO_FILTERS).find((o) => o.label === '1990s')!
    const [from, to] = preset.value.split('-').map(Number)
    const opts = decadeOptions(2026, { ...NO_FILTERS, yearFrom: from, yearTo: to })
    expect(opts.length).toBe(decadeOptions(2026, NO_FILTERS).length)
  })
})

/*
  The wiring this repo cannot otherwise test. Inlined in the component, a
  collection opening in alphabetical order passed all 478 tests — and a trilogy
  that opens on its third film is the whole reason the curated order exists.
*/
describe('sortContextFor', () => {
  it('opens a collection in the order its curator chose', () => {
    expect(sortContextFor(true).fallback).toBe('curated')
  })

  it('opens a plain library alphabetically, never on a curated order it has none of', () => {
    expect(sortContextFor(false).fallback).toBe('name')
  })

  it('offers the curated order only inside a container, and first', () => {
    expect(sortContextFor(true).sorts[0]?.key).toBe('curated')
    expect(sortContextFor(false).sorts.map((s) => String(s.key))).not.toContain('curated')
  })

  it("agrees with parseSort, so the page's default is one it actually offers", () => {
    for (const hasContainer of [true, false]) {
      const { sorts, fallback } = sortContextFor(hasContainer)
      expect(parseSort(null, fallback, sorts).key).toBe(fallback)
    }
  })
})

/*
  The alphabet filter. Every value here arrives as a URL param, so the parse
  has to be as suspicious as the rest of this module's, and the query it
  produces has to agree with the order the grid is already in.
*/
describe('parseLetter', () => {
  it('reads a letter, in whatever case the URL carries it', () => {
    expect(parse('letter=M').letter).toBe('M')
    expect(parse('letter=m').letter).toBe('M')
    expect(parseLetter('m')).toBe('M')
  })

  it('reads the numbers-and-symbols bucket', () => {
    expect(parse('letter=%23').letter).toBe('#')
    expect(parseLetter('#')).toBe('#')
  })

  /*
    A letter that is not one letter is not a filter. Anything accepted here
    becomes a bound on a request, so `[` — one past Z in ASCII — and a 40-char
    string are the two shapes that would quietly ask the server for a range
    nobody chose.
  */
  it('rejects anything that is not one of the 27 buttons', () => {
    for (const junk of ['AB', 'foo', '', '1', '-', '[', 'a'.repeat(40), ' ']) {
      expect(parseLetter(junk)).toBe('')
      expect(parse(`letter=${encodeURIComponent(junk)}`).letter).toBe('')
    }
  })

  it('reads an absent letter as no letter', () => {
    expect(parse('').letter).toBe('')
    expect(parseLetter(null)).toBe('')
    expect(parseLetter(undefined)).toBe('')
    expect(isFilterActive(parse(''))).toBe(false)
  })
})

describe('LETTERS', () => {
  it('is the numbers bucket and then the alphabet, 27 buttons', () => {
    expect(LETTERS.length).toBe(27)
    expect(LETTERS[0]).toBe('#')
    expect(LETTERS[1]).toBe('A')
    expect(LETTERS[26]).toBe('Z')
    expect(new Set(LETTERS).size).toBe(27)
  })

  it('accepts every one of its own values', () => {
    for (const letter of LETTERS) expect(parseLetter(letter)).toBe(letter)
  })
})

describe('letterQuery', () => {
  it('sends no bound at all when no letter is chosen', () => {
    // An off filter reaching the request is the failure that `hasSubtitles`
    // already guards against: a bound of '' is a bound the server reads.
    expect(letterQuery('')).toEqual({
      nameStartsWithOrGreater: undefined,
      nameLessThan: undefined,
    })
  })

  /*
    A half-open interval over SortName, not a prefix: SortName strips leading
    articles, so "The Office" sorts under O. A prefix match against the display
    name would put it under T — in a rail that sits beside a grid ordered by
    SortName, where it would read as a bug in the grid.
  */
  it('asks for an interval between one letter and the next', () => {
    expect(letterQuery('M')).toEqual({ nameStartsWithOrGreater: 'M', nameLessThan: 'N' })
    expect(letterQuery('A')).toEqual({ nameStartsWithOrGreater: 'A', nameLessThan: 'B' })
    expect(letterQuery('m')).toEqual({ nameStartsWithOrGreater: 'M', nameLessThan: 'N' })
  })

  /*
    `nameLessThan` is documented inclusive — "equally or lesser" — so the bound
    N can also catch a title whose sort name is exactly "n". The bound values
    are pinned here rather than corrected: the server's inclusivity is not ours
    to fix, and the cost is one title appearing in two buckets.
  */
  it('names the next letter as the upper bound, inclusive as the server has it', () => {
    expect(letterQuery('M').nameLessThan).toBe('N')
    expect(letterQuery('Y').nameLessThan).toBe('Z')
  })

  it('gives the numbers bucket no lower bound, so it catches everything below A', () => {
    // Digits, brackets and symbols all sort before A, and there is no single
    // character to start the range at — "before A" is the whole definition.
    expect(letterQuery('#')).toEqual({ nameStartsWithOrGreater: undefined, nameLessThan: 'A' })
    expect(letterQuery('#').nameStartsWithOrGreater).toBeUndefined()
  })

  it('leaves Z open-ended, so nothing past Z is reachable by no button', () => {
    // Cyrillic, CJK and accented capitals all sort after Z under an ordinal
    // comparison. A closed [Z, '[') bucket would strand every one of them.
    expect(letterQuery('Z')).toEqual({ nameStartsWithOrGreater: 'Z', nameLessThan: undefined })
    expect(letterQuery('Z').nameLessThan).toBeUndefined()
  })

  it('gives every button at least one bound, so no button is a no-op', () => {
    for (const letter of LETTERS) {
      const q = letterQuery(letter)
      expect(q.nameStartsWithOrGreater != null || q.nameLessThan != null).toBe(true)
    }
  })

  it('folds into the /Items query the grid actually sends', () => {
    const q = toItemsQuery({ ...NO_FILTERS, letter: 'M' }, 2026)
    expect(q.nameStartsWithOrGreater).toBe('M')
    expect(q.nameLessThan).toBe('N')
    expect(toItemsQuery(NO_FILTERS, 2026).nameStartsWithOrGreater).toBeUndefined()
    expect(toItemsQuery(NO_FILTERS, 2026).nameLessThan).toBeUndefined()
  })
})

describe('the letter in the URL and the cache key', () => {
  it('round-trips through the URL', () => {
    const params = filtersToParams({ ...NO_FILTERS, letter: 'M' })
    expect(params.get('letter')).toBe('M')
    expect(parseFilters(params).letter).toBe('M')
    expect(filtersToParams(parseFilters(new URLSearchParams('letter=m'))).get('letter')).toBe('M')
  })

  it('writes no letter param when no letter is chosen', () => {
    expect(filtersToParams(NO_FILTERS).has('letter')).toBe(false)
    expect(filtersToParams(NO_FILTERS, new URLSearchParams('letter=M')).has('letter')).toBe(false)
  })

  /*
    The trap this module's own cache-key comment names: a filter that reaches
    the request but not the key is answered out of another letter's cache, so
    pressing N would show M's titles.
  */
  it('changes the cache key, so N is not answered out of M cache', () => {
    const off = filterCacheKey(NO_FILTERS)
    const m = filterCacheKey({ ...NO_FILTERS, letter: 'M' })
    const n = filterCacheKey({ ...NO_FILTERS, letter: 'N' })
    expect(new Set([off, m, n]).size).toBe(3)
  })
})

describe('the letter chip', () => {
  it('says which letter is hiding the rest of the library', () => {
    expect(activeFilters({ ...NO_FILTERS, letter: 'M' })[0]).toEqual({
      key: 'letter',
      label: 'Starts with M',
    })
  })

  it('calls the numbers bucket what it is, not "starts with #"', () => {
    expect(activeFilters({ ...NO_FILTERS, letter: '#' })[0].label).toBe('Numbers & symbols')
  })

  it('is active on a letter alone', () => {
    expect(isFilterActive({ ...NO_FILTERS, letter: 'M' })).toBe(true)
    expect(isFilterActive({ ...NO_FILTERS, letter: '#' })).toBe(true)
  })

  it('clears the letter and nothing else', () => {
    const f = { ...NO_FILTERS, letter: 'M', genre: 'Horror', minRating: 7 }
    const cleared = clearFilter(f, 'letter')
    expect(cleared.letter).toBe('')
    expect(cleared.genre).toBe('Horror')
    expect(cleared.minRating).toBe(7)
  })

  it('labels the picker options, with the numbers bucket spelled out', () => {
    expect(letterLabel('M')).toBe('M')
    expect(letterLabel('#')).toBe('Numbers & symbols')
  })
})

/*
  The letter filter is an interval over SortName, so it only means anything
  while the grid is ordered by SortName. Offered beside "Recently Added" it
  would be a control that silently disagrees with what is on screen.
*/
describe('letterApplies', () => {
  it('applies to the alphabetical sort and to no other', () => {
    expect(letterApplies('name')).toBe(true)
    expect(letterApplies('added')).toBe(false)
    expect(letterApplies('rating')).toBe(false)
    expect(letterApplies('released')).toBe(false)
    expect(letterApplies('random')).toBe(false)
    expect(letterApplies('curated')).toBe(false)
  })

  it('answers for every sort that exists, so a new one cannot default to true', () => {
    const applies = CONTAINER_SORTS.filter((s) => letterApplies(s.key)).map((s) => s.key)
    expect(applies).toEqual(['name'])
  })
})

/*
  The rail's roving tabindex, which is the whole reason 27 buttons are one tab
  stop instead of 27. Arithmetic only — the component holds no decisions.
*/
describe('nextLetterIndex', () => {
  it('moves one step down and one step up', () => {
    expect(nextLetterIndex(5, 'ArrowDown', 27)).toBe(6)
    expect(nextLetterIndex(5, 'ArrowUp', 27)).toBe(4)
  })

  it('clamps at both ends rather than wrapping', () => {
    // A rail is a spatial object: wrapping from Z back to # moves the focus
    // ring the entire height of the screen for one keypress.
    expect(nextLetterIndex(26, 'ArrowDown', 27)).toBe(26)
    expect(nextLetterIndex(0, 'ArrowUp', 27)).toBe(0)
  })

  it('jumps to the ends on Home and End', () => {
    expect(nextLetterIndex(13, 'Home', 27)).toBe(0)
    expect(nextLetterIndex(13, 'End', 27)).toBe(26)
  })

  it('leaves the focus alone for any key it does not own', () => {
    for (const key of ['ArrowLeft', 'ArrowRight', 'Tab', 'Enter', ' ', 'a', 'PageDown']) {
      expect(nextLetterIndex(13, key, 27)).toBe(13)
    }
  })

  it('stays in range for a rail of any length, including an empty one', () => {
    expect(nextLetterIndex(0, 'ArrowDown', 1)).toBe(0)
    expect(nextLetterIndex(0, 'End', 1)).toBe(0)
    expect(nextLetterIndex(0, 'End', 0)).toBe(0)
    expect(nextLetterIndex(99, 'ArrowDown', 27)).toBe(26)
    expect(nextLetterIndex(-5, 'ArrowUp', 27)).toBe(0)
  })
})
