import { useState } from 'react'
import { Modal } from './Modal'
import {
  LETTERS,
  SORTS,
  clearFilter,
  decadeOptions,
  filtersButtonLabel,
  genreOptions,
  letterApplies,
  letterLabel,
  parseLetter,
  parseYearRange,
  ratingOptions,
  sheetFilterCount,
  shownFilters,
  yearRangeValue,
  type LibraryFilters,
  type Sort,
  type SortKey,
  type WatchedState,
} from '../lib/libraryFilters'

const CONTROL =
  'rounded border border-white/15 bg-ink-soft px-3 py-2 text-sm outline-none transition hover:border-white/35'

/**
 * Lets a `<select>` give ground on a phone instead of wrapping the bar.
 *
 * A select is as wide as its widest *option*, not its current value, so the
 * letter picker is 172px because one of its 28 options is "Numbers & symbols",
 * and that alone is what pushed the three remaining mobile controls onto two
 * rows. `min-width: 0` is what flexbox needs before it is allowed to shrink a
 * form control at all.
 *
 * It costs almost nothing to read, because the two selects that get it are
 * only side by side under the alphabetical sort — where one reads "A–Z" and
 * the other reads a single letter. The only value long enough to be clipped is
 * "Numbers & symbols" itself, and the chip below the bar says it in full.
 *
 * Switched off at `sm:` so the desktop row wraps as it always has rather than
 * quietly squeezing seven controls into one line on a 700px window.
 */
const SHRINKS = 'min-w-0 sm:min-w-[auto]'

/**
 * The five filters that a narrow viewport keeps behind the Filters button, and
 * that a wide one lays out inline.
 *
 * One component rendered in two places rather than two copies of the controls,
 * because the alternative is five `onChange` handlers written twice: the kind
 * of duplication where the sheet and the bar drift apart and only one of them
 * still clears the year properly.
 *
 * `hidden sm:block` on each control rather than one wrapper around the group,
 * so that the bar's `flex-wrap` still sees seven siblings on a wide screen and
 * wraps them the way it always has. (`display: block` is what `inline-block` is
 * blockified to as a flex item anyway, so the class changes nothing that
 * renders.)
 *
 * The `sm:order-*` classes put the desktop row back in the order it has always
 * been in — Genre, first letter, then the other four. Grouping these five into
 * one component is what disturbed it: the letter picker has to be a sibling on
 * the bar, because it is one of the two controls a phone keeps out here, and a
 * sibling cannot be rendered into the middle of a component's output. Order is
 * a wide-screen concern only, which is why every one of them is behind `sm:`:
 * on a phone these five are not on the bar at all.
 */
function OccasionalFilters({
  filters,
  onFilters,
  genres,
  stacked = false,
}: {
  filters: LibraryFilters
  onFilters: (next: LibraryFilters) => void
  genres?: string[]
  /** A column with visible labels, for the sheet. Otherwise a row. */
  stacked?: boolean
}) {
  const years = decadeOptions(new Date().getFullYear(), filters)
  const control = stacked ? `${CONTROL} w-full` : `${CONTROL} hidden sm:order-3 sm:block`
  const genreControl = stacked ? `${CONTROL} w-full` : `${CONTROL} hidden sm:order-1 sm:block`

  /*
    In the bar, each control says what it is through its own idle option — "Any
    year", "All genres". In a column of five that is not enough: once a year is
    chosen the control reads "1990s" and nothing on screen says which filter
    that is. So the sheet labels them, and the bar does not grow labels it has
    never needed.
  */
  const field = (label: string, input: React.ReactNode) =>
    stacked ? (
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-white/55">{label}</span>
        {input}
      </label>
    ) : (
      input
    )

  return (
    <>
      {genres &&
        field(
          'Genre',
          <select
            aria-label="Genre"
            value={filters.genre}
            onChange={(e) => onFilters({ ...filters, genre: e.target.value })}
            className={genreControl}
          >
            <option value="">All genres</option>
            {genreOptions(genres, filters.genre).map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>,
        )}

      {field(
        'Watched',
        <select
          aria-label="Watched state"
          value={filters.watched}
          onChange={(e) => onFilters({ ...filters, watched: e.target.value as WatchedState })}
          className={control}
        >
          <option value="all">Watched &amp; unwatched</option>
          <option value="unwatched">Unwatched only</option>
          <option value="watched">Watched only</option>
        </select>,
      )}

      {field(
        'Year',
        <select
          aria-label="Year"
          value={yearRangeValue(filters)}
          onChange={(e) => onFilters({ ...filters, ...parseYearRange(e.target.value) })}
          className={control}
        >
          {years.map((y) => (
            <option key={y.value} value={y.value}>
              {y.label}
            </option>
          ))}
        </select>,
      )}

      {field(
        'Minimum rating',
        <select
          aria-label="Minimum rating"
          value={filters.minRating ?? ''}
          onChange={(e) =>
            onFilters({ ...filters, minRating: e.target.value ? Number(e.target.value) : null })
          }
          className={control}
        >
          <option value="">Any rating</option>
          {ratingOptions(filters.minRating).map((r) => (
            <option key={r} value={r}>
              {r}+ rating
            </option>
          ))}
        </select>,
      )}

      {/* Not wrapped in a label even in the sheet: a toggle button already says
          its own name, and a <label> around a button labels nothing. */}
      <button
        type="button"
        aria-pressed={filters.subtitles}
        onClick={() => onFilters({ ...filters, subtitles: !filters.subtitles })}
        className={`${control} ${filters.subtitles ? 'border-accent/60 bg-accent/15 text-white' : 'text-white/70'}`}
      >
        Subtitled
      </button>
    </>
  )
}

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
 *
 * ── Why a phone sees two controls and a button ────────────────────────────
 *
 * Seven controls in one `flex-wrap` is four rows at 390px wide, and measured in
 * the live app that put the first poster 368px down an 840px screen: 44% of a
 * library spent on its own settings. So the five that are set once and left
 * alone go behind one button, the two that are pressed while reading the grid
 * stay out on the bar, and `libraryFilters` holds which is which and why.
 *
 * The chip row below is not part of that trade. It is the only thing standing
 * between a viewer and concluding their library has emptied itself, so it stays
 * on screen at every width — moving it into the sheet would hide the warning
 * behind the thing it is warning about.
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
  const [sheetOpen, setSheetOpen] = useState(false)

  // Only ever offer to clear what is actually on screen: on Browse the genre
  // filter is the page itself, and "Clear all" must not take it with it. The
  // same question decides whether the badge counts it.
  const hasGenreControl = genres != null
  const chips = shownFilters(filters, hasGenreControl)
  const behindButton = sheetFilterCount(filters, hasGenreControl)

  return (
    <div className="flex flex-col gap-3">
      {/*
        `flex-nowrap` on a phone, because the whole point is one row and
        wrapping wins over shrinking in flexbox: a line breaks first, and only
        then do the items on it give ground. Left wrapping, the letter picker
        keeps all 172px it asks for and puts the Filters button on a second row
        while there is room beside it. Nothing overflows instead, because the
        two selects are allowed to shrink (see `SHRINKS`) and the button, which
        has nothing to give, is not.
      */}
      <div className="flex flex-nowrap items-center gap-2 sm:flex-wrap">
        <OccasionalFilters filters={filters} onFilters={onFilters} genres={genres} />

        {/*
          The letter picker, and the whole feature on a phone: keyboard- and
          screen-reader-native for free, where the rail beside the grid is
          neither. It is also what lets the rail be a desktop embellishment
          that could be removed without removing the feature. Shown only beside
          the alphabetical sort, because that is the only order it agrees with.
        */}
        {letterApplies(sortKey) && (
          <select
            aria-label="First letter"
            value={filters.letter}
            onChange={(e) => onFilters({ ...filters, letter: parseLetter(e.target.value) })}
            className={`${CONTROL} ${SHRINKS} sm:order-2`}
          >
            <option value="">All titles</option>
            {LETTERS.map((letter) => (
              <option key={letter} value={letter}>
                {letterLabel(letter)}
              </option>
            ))}
          </select>
        )}

        <select
          aria-label="Sort"
          value={sortKey}
          onChange={(e) => onSort(e.target.value as SortKey)}
          className={`${CONTROL} ${SHRINKS} sm:order-4`}
        >
          {sorts.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          aria-label={filtersButtonLabel(behindButton)}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
          className={`${CONTROL} flex shrink-0 items-center gap-2 sm:hidden ${
            behindButton > 0 ? 'border-accent/60 bg-accent/15 text-white' : 'text-white/70'
          }`}
        >
          Filters
          {/* The count is in the accessible name already, so the badge is a
              picture of it rather than a second reading of the same number. */}
          {behindButton > 0 && (
            <span
              aria-hidden
              className="rounded-full bg-accent px-1.5 text-xs font-semibold leading-5 text-white"
            >
              {behindButton}
            </span>
          )}
        </button>
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

      {/*
        A dialog, not a popover: it is the whole lower half of the screen and
        the page behind it cannot be used, which is what `Modal` already means
        in this app — Escape, the backdrop, a focus trap and focus handed back
        to the button, all from the one place that is tested.

        The `sm:hidden` wrapper is for rotation. A phone turned to landscape is
        844px wide, which is past `sm:`, and the five controls are suddenly
        inline behind an open sheet holding the same five. Hiding it there
        resolves that into the desktop bar the viewer is now looking at,
        instead of a dialog arguing with the row underneath it.
      */}
      {sheetOpen && (
        <div className="sm:hidden">
          <Modal bottom title="Filters" onClose={() => setSheetOpen(false)}>
            <OccasionalFilters filters={filters} onFilters={onFilters} genres={genres} stacked />
          </Modal>
        </div>
      )}
    </div>
  )
}
