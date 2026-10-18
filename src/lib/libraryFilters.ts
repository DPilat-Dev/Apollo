/**
 * The filter set a library grid is showing, expressed entirely as query params.
 *
 * Filters live in the URL rather than in `useState` for the same reason
 * Browse's do: a filtered grid is a thing people send each other and come back
 * to, and state that only exists in a component is lost to a refresh, to Back,
 * and to a link. It also makes the whole panel a value that can be parsed,
 * serialised and tested without rendering anything.
 *
 * The consequence is that every value here arrives as an untrusted string —
 * bookmarked from an older build, or typed by hand — so nothing below assumes
 * it is well formed, and serialising what was parsed always yields a URL this
 * module would parse the same way again. That round trip is what keeps the
 * address bar honest about what the grid is actually showing.
 */

/** The orders any grid of items can be put in. */
export const SORTS = [
  { key: 'added', label: 'Recently Added', sortBy: 'DateCreated', order: 'Descending' },
  { key: 'name', label: 'A–Z', sortBy: 'SortName', order: 'Ascending' },
  { key: 'rating', label: 'Rating', sortBy: 'CommunityRating', order: 'Descending' },
  { key: 'released', label: 'Release Date', sortBy: 'PremiereDate', order: 'Descending' },
  { key: 'random', label: 'Random', sortBy: 'Random', order: 'Ascending' },
] as const

/**
 * The order a container's curator put it in — no order of ours at all, which
 * an empty `sortBy` is what asks for.
 *
 * It is kept out of `SORTS` rather than added to it because it is the one sort
 * that needs something to be sorted *inside*: a library has no curator, so
 * offering "Collection order" there would be a control that does nothing, and
 * honouring `?sort=curated` on a page with no container would silently drop
 * the ordering from the request instead.
 */
export const CURATED_SORT = {
  key: 'curated',
  label: 'Collection order',
  sortBy: '',
  order: 'Ascending',
} as const

/** What a grid inside a container offers: the curated order, then the rest. */
export const CONTAINER_SORTS = [CURATED_SORT, ...SORTS] as const

/**
 * Which sorts a page offers and which one it opens on.
 *
 * A one-line decision, pulled out of the component because the component is
 * the one place this repo cannot test. Left inline, a collection quietly
 * opening in alphabetical order passed the whole suite — and a trilogy opening
 * on its third film is the exact failure the curated order exists to prevent.
 */
export function sortContextFor(hasContainer: boolean): {
  sorts: readonly Sort[]
  fallback: SortKey
} {
  return hasContainer
    ? { sorts: CONTAINER_SORTS, fallback: 'curated' }
    : { sorts: SORTS, fallback: 'name' }
}

export type Sort = (typeof CONTAINER_SORTS)[number]
export type SortKey = Sort['key']

/**
 * The sort a `?sort=` value names, or the caller's default for anything else.
 *
 * `available` is what decides which keys mean anything on a given page, so a
 * key that only exists in one context cannot be pasted into another and be
 * honoured there.
 */
export function parseSort(
  value: string | null | undefined,
  fallback: SortKey,
  available: readonly Sort[] = SORTS,
): Sort {
  return (
    available.find((s) => s.key === value) ??
    available.find((s) => s.key === fallback) ??
    available[0]
  )
}

/**
 * The `/Items` ordering parameters for a sort.
 *
 * The curated sort names no field, and both parameters then have to be absent
 * rather than empty: `sortBy=` is still a parameter the server reads, and the
 * whole point is to leave a collection in the order it was curated in.
 */
export function toSortQuery(sort: Sort): {
  sortBy: string[] | undefined
  sortOrder: string[] | undefined
} {
  if (!sort.sortBy) return { sortBy: undefined, sortOrder: undefined }
  return { sortBy: [sort.sortBy], sortOrder: [sort.order] }
}

export type WatchedState = 'all' | 'unwatched' | 'watched'

export interface LibraryFilters {
  genre: string
  watched: WatchedState
  yearFrom: number | null
  yearTo: number | null
  minRating: number | null
  subtitles: boolean
  /** One of `LETTERS`, or `''` for the whole alphabet. */
  letter: string
}

export type FilterKey = 'genre' | 'watched' | 'year' | 'rating' | 'subtitles' | 'letter'

export const NO_FILTERS: LibraryFilters = {
  genre: '',
  watched: 'all',
  yearFrom: null,
  yearTo: null,
  minRating: null,
  subtitles: false,
  letter: '',
}

/** The params this module owns. Anything else in the URL is someone else's. */
const FILTER_PARAMS = [
  'genre',
  'watched',
  'yearFrom',
  'yearTo',
  'minRating',
  'hasSubs',
  'letter',
] as const

/**
 * The oldest year worth believing. Films exist from the 1870s; a "year" below
 * that is a typo or a hand-edit, never a search someone meant to run.
 */
const MIN_YEAR = 1870
const MAX_YEAR = 2200
const MAX_RATING = 10

function parseYear(raw: string | null): number | null {
  if (!raw) return null
  const text = raw.trim()
  // Deliberately strict: "1990.5" and "-1990" are not years, and Number()
  // would happily turn both into something this could act on.
  if (!/^\d{1,4}$/.test(text)) return null
  const year = Number(text)
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null
}

/**
 * Ratings clamp where years drop, and the asymmetry is deliberate: a hand-typed
 * `minRating=99` still says "only the very best", so 10 honours it, whereas a
 * year of 99 says nothing a clamp could honour — pinning it to 1870 would
 * invent an intent nobody had and empty the grid for no stated reason.
 */
function parseRating(raw: string | null): number | null {
  if (!raw) return null
  const value = Number(raw.trim())
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.min(value, MAX_RATING)
}

/**
 * The 27 buckets the alphabet filter offers: numbers and symbols, then A–Z.
 *
 * Built from a range rather than typed out because a typo in a hand-written
 * list is a button that filters to nothing, and the only thing that would
 * notice is a viewer wondering where the Q titles went.
 */
export const LETTERS: readonly string[] = [
  '#',
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode('A'.charCodeAt(0) + i)),
]

/**
 * One of the 27 buckets, or nothing at all.
 *
 * Case is normalised on the way in so `?letter=m` and `?letter=M` are the same
 * grid and the same cache entry, and anything that is not exactly one bucket is
 * refused rather than passed along: these values become *bounds on a request*,
 * and `[` (one past Z in ASCII) or a 40-character paste would ask the server
 * for a range nobody chose and return a library that looks empty.
 */
export function parseLetter(raw: string | null | undefined): string {
  const value = (raw ?? '').trim().toUpperCase()
  return LETTERS.includes(value) ? value : ''
}

/**
 * What a bucket is called out loud — in the picker, in the chip, and as the
 * label on a rail button. Only `#` needs saying; the rest are a letter.
 */
export function letterLabel(letter: string): string {
  return letter === '#' ? 'Numbers & symbols' : letter
}

export function parseFilters(params: URLSearchParams): LibraryFilters {
  const watched = params.get('watched')
  const years = [parseYear(params.get('yearFrom')), parseYear(params.get('yearTo'))]
  // A range typed backwards is still a range, and is far likelier to be a slip
  // than a request for nothing at all.
  if (years[0] != null && years[1] != null && years[0] > years[1]) years.reverse()

  const subs = params.get('hasSubs')

  return {
    genre: (params.get('genre') ?? '').trim(),
    watched: watched === 'unwatched' || watched === 'watched' ? watched : 'all',
    yearFrom: years[0],
    yearTo: years[1],
    minRating: parseRating(params.get('minRating')),
    subtitles: subs === '1' || subs === 'true',
    letter: parseLetter(params.get('letter')),
  }
}

/**
 * Filters back into query params, on top of whatever else the URL carries.
 *
 * Params outside this module's own set are left untouched — Browse's
 * `personIds`, the sort, anything a future page adds — while an inactive filter
 * has its param removed rather than written as an empty value, so a URL with no
 * filters is genuinely bare and shareable.
 */
export function filtersToParams(
  filters: LibraryFilters,
  base?: URLSearchParams,
): URLSearchParams {
  const next = new URLSearchParams(base)
  for (const key of FILTER_PARAMS) next.delete(key)

  if (filters.genre) next.set('genre', filters.genre)
  if (filters.watched !== 'all') next.set('watched', filters.watched)
  if (filters.yearFrom != null) next.set('yearFrom', String(filters.yearFrom))
  if (filters.yearTo != null) next.set('yearTo', String(filters.yearTo))
  if (filters.minRating != null) next.set('minRating', String(filters.minRating))
  if (filters.subtitles) next.set('hasSubs', '1')
  if (filters.letter) next.set('letter', filters.letter)
  return next
}

export function isFilterActive(filters: LibraryFilters): boolean {
  return activeFilters(filters).length > 0
}

export interface FilterChip {
  key: FilterKey
  label: string
}

const yearLabel = (from: number | null, to: number | null): string => {
  if (from != null && to != null) return from === to ? String(from) : `${from}–${to}`
  if (from != null) return `${from} & newer`
  return `${to} & older`
}

/**
 * One label per filter that is hiding something, for a bar the grid always
 * shows while any of them are on.
 *
 * This is the whole defence against the failure mode this feature creates: a
 * viewer who filtered to unwatched three days ago, came back, and would
 * otherwise conclude the library had emptied itself. Sort is not in here on
 * purpose — reordering a grid never hides a title.
 */
export function activeFilters(filters: LibraryFilters): FilterChip[] {
  const chips: FilterChip[] = []
  if (filters.genre) chips.push({ key: 'genre', label: filters.genre })
  if (filters.letter) {
    chips.push({
      key: 'letter',
      label: filters.letter === '#' ? letterLabel('#') : `Starts with ${filters.letter}`,
    })
  }
  if (filters.watched !== 'all') {
    chips.push({ key: 'watched', label: filters.watched === 'unwatched' ? 'Unwatched' : 'Watched' })
  }
  if (filters.yearFrom != null || filters.yearTo != null) {
    chips.push({ key: 'year', label: yearLabel(filters.yearFrom, filters.yearTo) })
  }
  if (filters.minRating != null) {
    chips.push({ key: 'rating', label: `${filters.minRating}+ rating` })
  }
  if (filters.subtitles) chips.push({ key: 'subtitles', label: 'Has subtitles' })
  return chips
}

/** Turns one chip's × off. The year chip owns both bounds, so it clears both. */
export function clearFilter(filters: LibraryFilters, key: FilterKey): LibraryFilters {
  switch (key) {
    case 'genre':
      return { ...filters, genre: '' }
    case 'watched':
      return { ...filters, watched: 'all' }
    case 'year':
      return { ...filters, yearFrom: null, yearTo: null }
    case 'rating':
      return { ...filters, minRating: null }
    case 'subtitles':
      return { ...filters, subtitles: false }
    case 'letter':
      return { ...filters, letter: '' }
  }
}

/**
 * Which case the bounds go out in — the one thing here that only a live server
 * can settle, which is exactly why it is one constant and not three call sites.
 *
 * The comparison is ordinal, so the case is not cosmetic: `M` is 0x4D and `m`
 * is 0x6D. Asked for `>= 'M'` against a `SortName` the server has stored
 * lowercased, every title from `a` onwards comes back and the filter has
 * quietly stopped filtering — a bug that looks like no bug, because a grid of
 * the whole library is what the page shows anyway. Uppercase is what is in
 * force, and it is what the bound values are pinned to in the tests, so
 * flipping this line is the entire change and the tests say in one place what
 * the bounds become.
 */
const BOUND_CASE: 'upper' | 'lower' = 'upper'

const bound = (letter: string): string =>
  BOUND_CASE === 'upper' ? letter.toUpperCase() : letter.toLowerCase()

/**
 * The `/Items` bounds for one letter: a half-open interval over the field the
 * grid is already ordered by.
 *
 * ── Why an interval and not a prefix ──────────────────────────────────────
 *
 * `SortName` strips leading articles, so "The Office" sorts under **O**. The
 * grid is ordered by `SortName`; a prefix match (`nameStartsWith`) is against
 * the display name, so pressing T would produce a grid holding "The Office"
 * while the O section of that same grid also holds it, and the alphabet down
 * the side would be visibly disagreeing with the list beside it. An interval
 * over the same field the order comes from agrees with that order by
 * construction — there is nothing left to reconcile. `searchTerm` is worse
 * again: fuzzy, multi-field, matches overviews and cast, and has no defined
 * relationship to any sort.
 *
 * `nameLessThan` is documented as inclusive — "equally or lesser than a given
 * input string" — so the bound `N` can also catch a title whose sort name is
 * exactly `n`, putting it in both M's bucket and N's. That is the server's
 * inclusivity, not ours to correct: a client-side correction would need the
 * sort name of every item it has not loaded yet.
 *
 * ── Why the two ends are open ─────────────────────────────────────────────
 *
 * `#` has no lower bound and `Z` has no upper one, and both are the same
 * decision: every title must be reachable by some button. "Everything that
 * sorts before A" is digits, brackets and symbols in a single parameter, and
 * there is no character to start that range at. Past Z, an ordinal comparison
 * puts Cyrillic, CJK and accented capitals all *after* `Z` — so a closed
 * `[Z, '[')` bucket would leave "Ødipus" and "Звездные войны" in no bucket at
 * all, present in the library and reachable by no button on the rail.
 */
export function letterQuery(letter: string): Pick<
  ItemsFilterQuery,
  'nameStartsWithOrGreater' | 'nameLessThan'
> {
  const value = parseLetter(letter)
  if (!value) return { nameStartsWithOrGreater: undefined, nameLessThan: undefined }

  const next = LETTERS[LETTERS.indexOf(value) + 1]
  return {
    nameStartsWithOrGreater: value === '#' ? undefined : bound(value),
    nameLessThan: next ? bound(next) : undefined,
  }
}

/**
 * Whether a letter filter means anything beside a given sort.
 *
 * It is an interval over `SortName`, so it only lines up with the grid while
 * the grid is in `SortName` order. Offered beside "Recently Added" it would be
 * a control whose result nobody could read: the titles would all start with M
 * and sit in an order the letter had nothing to do with. Written as an
 * allow-list of one rather than a list of exclusions, so a sort added later
 * does not quietly inherit a filter nobody checked it against.
 */
export function letterApplies(sortKey: SortKey): boolean {
  return sortKey === 'name'
}

export interface ItemsFilterQuery {
  genres: string | undefined
  isPlayed: boolean | undefined
  years: number[] | undefined
  minCommunityRating: number | undefined
  hasSubtitles: boolean | undefined
  nameStartsWithOrGreater: string | undefined
  nameLessThan: string | undefined
}

/**
 * The `/Items` parameters for a filter set.
 *
 * `Years` takes a list of years rather than a range, so a range has to be
 * expanded — and an open-ended one has to be closed first, against the current
 * year going forward and the oldest plausible year going back. Every value is
 * left undefined when its filter is off: `hasSubtitles=false` and
 * `isPlayed=false` are real filters to the server, not "don't care", and
 * sending either by accident hides most of a library.
 */
export function toItemsQuery(filters: LibraryFilters, currentYear: number): ItemsFilterQuery {
  let years: number[] | undefined
  if (filters.yearFrom != null || filters.yearTo != null) {
    const from = filters.yearFrom ?? MIN_YEAR
    const to = Math.max(from, filters.yearTo ?? Math.max(currentYear, from))
    years = Array.from({ length: to - from + 1 }, (_, i) => from + i)
  }

  return {
    genres: filters.genre || undefined,
    isPlayed: filters.watched === 'all' ? undefined : filters.watched === 'watched',
    years,
    minCommunityRating: filters.minRating ?? undefined,
    hasSubtitles: filters.subtitles || undefined,
    ...letterQuery(filters.letter),
  }
}

/**
 * The cache-key fragment for a filter set.
 *
 * It is the serialised URL on purpose: a filter that reaches the request but
 * not the key gets answered from another filter's cache, and deriving both from
 * one function is what makes that impossible to forget when a filter is added.
 */
export function filterCacheKey(filters: LibraryFilters): string {
  return filtersToParams(filters).toString()
}

/**
 * Genres for the picker, guaranteed to contain the one being filtered on.
 *
 * The list is built from what has loaded, so a genre that came from a shared
 * link — or one whose only titles are excluded by the other filters — is not in
 * it, and a `<select>` with no matching option renders blank and drops the
 * filter the moment anything else is chosen.
 */
export function genreOptions(genres: string[], current: string): string[] {
  if (!current || genres.includes(current)) return genres
  return [current, ...genres]
}

const RATING_STEPS = [9, 8, 7, 6, 5]

/**
 * Rating thresholds for the picker, with whatever is currently in force folded
 * in. Same reason as the custom decade: a `minRating=7.5` arriving from a
 * hand-edited URL must have an option to sit in, or the control shows blank and
 * quietly discards the filter as soon as it is touched.
 */
export function ratingOptions(minRating: number | null): number[] {
  if (minRating == null || RATING_STEPS.includes(minRating)) return RATING_STEPS
  return [...RATING_STEPS, minRating].sort((a, b) => b - a)
}

export interface YearOption {
  value: string
  label: string
}

/** `from-to`, with either side allowed to be open. */
export function yearRangeValue(filters: LibraryFilters): string {
  if (filters.yearFrom == null && filters.yearTo == null) return ''
  return `${filters.yearFrom ?? ''}-${filters.yearTo ?? ''}`
}

export function parseYearRange(value: string): Pick<LibraryFilters, 'yearFrom' | 'yearTo'> {
  const [from, to] = value.split('-')
  return { yearFrom: parseYear(from ?? null), yearTo: parseYear(to ?? null) }
}

const OLDEST_DECADE = 1950

/**
 * Decade presets, plus the range currently in force when it is not one of them.
 *
 * That last part matters because these values drive a `<select>`: a hand-edited
 * `yearFrom=1977&yearTo=1983` with no matching option renders as a blank
 * control that silently rewrites the filter the moment anything else is
 * touched.
 */
export function decadeOptions(currentYear: number, filters: LibraryFilters): YearOption[] {
  const options: YearOption[] = [{ value: '', label: 'Any year' }]
  const newest = Math.floor(currentYear / 10) * 10
  for (let decade = newest; decade >= OLDEST_DECADE; decade -= 10) {
    options.push({ value: `${decade}-${decade + 9}`, label: `${decade}s` })
  }
  options.push({ value: `${MIN_YEAR}-${OLDEST_DECADE - 1}`, label: `Before ${OLDEST_DECADE}` })

  const current = yearRangeValue(filters)
  if (current && !options.some((o) => o.value === current)) {
    options.splice(1, 0, {
      value: current,
      label: yearLabel(filters.yearFrom, filters.yearTo),
    })
  }
  return options
}

/**
 * Where the rail's one tab stop moves next.
 *
 * The rail is 27 buttons and one tab stop — a roving tabindex — because 27 raw
 * tab stops in the middle of a page is a wall anybody who tabs has to get
 * through to reach the grid. The arithmetic lives here rather than in the
 * component for the usual reason: the component is the one thing this repo
 * cannot test, and off-by-one at the ends is exactly the bug that hides there.
 *
 * It clamps rather than wraps. A rail is a spatial object sitting against the
 * edge of the screen, and wrapping from Z back to `#` throws the focus ring the
 * whole height of the viewport for one keypress — a scroll bar does not do
 * that, and neither should this. Anything out of range is clamped too, so a
 * stale index can never focus a button that is not there.
 */
export function nextLetterIndex(current: number, key: string, length: number): number {
  const last = Math.max(length - 1, 0)
  const clamp = (i: number) => Math.min(Math.max(i, 0), last)
  switch (key) {
    case 'ArrowDown':
      return clamp(current + 1)
    case 'ArrowUp':
      return clamp(current - 1)
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return current
  }
}
