import {
  SORTS,
  activeFilters,
  clearFilter,
  decadeOptions,
  genreOptions,
  parseYearRange,
  ratingOptions,
  yearRangeValue,
  type LibraryFilters,
  type Sort,
  type SortKey,
  type WatchedState,
} from '../lib/libraryFilters'

const CONTROL =
  'rounded border border-white/15 bg-ink-soft px-3 py-2 text-sm outline-none transition hover:border-white/35'

/**
 * The sort and filter controls above a grid, plus a running summary of what is
 * currently being hidden.
 *
 * Shared by Library and Browse because the two grids had already grown two
 * different sort menus for the same five sorts, and a second copy of the filter
 * logic would have been a third. The one thing that differs is the genre
 * control: on Browse the genre *is* the page — the URL's `genre` param is the
 * subject of "everything in Horror", not a filter over it — so that page passes
 * no genre list, and the control and its chip are left out rather than offering
 * an × that would delete the page out from under the viewer.
 */
export function FilterBar({
  filters,
  onFilters,
  sortKey,
  onSort,
  genres,
  sorts = SORTS,
}: {
  filters: LibraryFilters
  onFilters: (next: LibraryFilters) => void
  sortKey: SortKey
  onSort: (key: SortKey) => void
  /** Genre options. Omitted where the genre is the page's subject. */
  genres?: string[]
  /** The orders on offer, for a page that has one the shared list does not. */
  sorts?: readonly Sort[]
}) {
  const currentYear = new Date().getFullYear()
  const years = decadeOptions(currentYear, filters)

  // Only ever offer to clear what is actually on screen: on Browse the genre
  // filter is the page itself, and "Clear all" must not take it with it.
  const chips = activeFilters(filters).filter((c) => c.key !== 'genre' || genres != null)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {genres && (
          <select
            aria-label="Genre"
            value={filters.genre}
            onChange={(e) => onFilters({ ...filters, genre: e.target.value })}
            className={CONTROL}
          >
            <option value="">All genres</option>
            {genreOptions(genres, filters.genre).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Watched state"
          value={filters.watched}
          onChange={(e) => onFilters({ ...filters, watched: e.target.value as WatchedState })}
          className={CONTROL}
        >
          <option value="all">Watched &amp; unwatched</option>
          <option value="unwatched">Unwatched only</option>
          <option value="watched">Watched only</option>
        </select>

        <select
          aria-label="Year"
          value={yearRangeValue(filters)}
          onChange={(e) => onFilters({ ...filters, ...parseYearRange(e.target.value) })}
          className={CONTROL}
        >
          {years.map((y) => (
            <option key={y.value} value={y.value}>
              {y.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Minimum rating"
          value={filters.minRating ?? ''}
          onChange={(e) =>
            onFilters({ ...filters, minRating: e.target.value ? Number(e.target.value) : null })
          }
          className={CONTROL}
        >
          <option value="">Any rating</option>
          {ratingOptions(filters.minRating).map((r) => (
            <option key={r} value={r}>
              {r}+ rating
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-pressed={filters.subtitles}
          onClick={() => onFilters({ ...filters, subtitles: !filters.subtitles })}
          className={`${CONTROL} ${filters.subtitles ? 'border-accent/60 bg-accent/15 text-white' : 'text-white/70'}`}
        >
          Subtitled
        </button>

        <select
          aria-label="Sort"
          value={sortKey}
          onChange={(e) => onSort(e.target.value as SortKey)}
          className={CONTROL}
        >
          {sorts.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-white/45">Filtered by</span>
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => onFilters(clearFilter(filters, chip.key))}
              title={`Remove the ${chip.label} filter`}
              className="flex items-center gap-1.5 rounded-full border border-accent/50 bg-accent/15 py-1 pl-3 pr-2 font-medium transition hover:border-accent hover:bg-accent/25"
            >
              {chip.label}
              <span aria-hidden className="text-white/60">
                ✕
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onFilters(chips.reduce((f, c) => clearFilter(f, c.key), filters))}
            className="rounded px-2 py-1 text-white/50 underline underline-offset-4 transition hover:text-white"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  )
}
