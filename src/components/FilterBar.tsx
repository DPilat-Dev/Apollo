import { Fragment, useRef, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import {
  ALL_TITLES_LABEL,
  BAR_CONTROLS,
  LETTERS,
  SHEET_FILTER_KEYS,
  SORTS,
  chipFocusAfterRemoval,
  clearFilter,
  decadeOptions,
  filtersButtonLabel,
  genreOptions,
  letterApplies,
  letterOptionLabel,
  parseLetter,
  parseYearRange,
  ratingOptions,
  sheetFilterCount,
  shownFilters,
  yearRangeValue,
  type BarControl,
  type FilterKey,
  type LibraryFilters,
  type Sort,
  type SortKey,
  type WatchedState,
} from '../lib/libraryFilters'

/*
  No `outline-none` here, and the note is so it does not come back. It used to
  be, and `outline-none` lands in `@layer utilities` while the app's
  `:focus-visible` ring is in `@layer base` — so it beat the ring regardless of
  specificity, and every `<select>` in this bar reported `outline-style: none`
  while focused. Keyboard focus had no indicator at all on the one row of
  controls a keyboard viewer has to pass through to reach the grid. It was not
  buying anything either: `:focus:not(:focus-visible)` in `index.css` is what
  keeps a mouse click from drawing a ring.
*/

/*
  The shape and the skin are separate strings, and that is the whole fix for a
  control whose "on" state was invisible.

  `${CONTROL} border-accent/60 bg-accent/15` emits *both* backgrounds. They are
  single utilities of equal specificity, so nothing about the order they are
  written in decides it — source order in the built stylesheet does, and that
  order put `bg-ink-soft` last. Measured on the live Subtitled toggle: off and
  on both computed `background: rgb(20, 20, 22)` with the same border, and the
  only thing that changed between them was the label going from white/70 to
  white. `aria-pressed` was correct throughout, so the control was honest to a
  screen reader and a lie to everyone else — while the chips below it and the
  rail letters beside it did show the accent tint, because both of those choose
  a whole skin rather than appending an override to one.

  So an active control takes `CONTROL_ON` *instead of* `CONTROL_IDLE`, and
  nothing has to win: only one background is ever emitted for it.
*/
const CONTROL_SHAPE = 'rounded border px-3 py-2 text-sm transition'
const CONTROL_IDLE = 'border-white/15 bg-ink-soft hover:border-white/35'
const CONTROL_ON = 'border-accent/60 bg-accent/15 text-white'

/** A `<select>` on the bar, which has no on-state to show. */
const CONTROL = `${CONTROL_SHAPE} ${CONTROL_IDLE}`

/** A toggle on the bar, which does. */
const toggleClass = (on: boolean) =>
  `${CONTROL_SHAPE} ${on ? CONTROL_ON : `${CONTROL_IDLE} text-white/70`}`

/**
 * Lets a `<select>` give ground on a phone instead of wrapping the bar.
 *
 * A select is as wide as its widest *option*, not its current value, so the
 * letter picker is around 172px because one of its 28 options spells the
 * numbers bucket out in full, and that alone is what pushed the three
 * remaining mobile controls onto two rows. `min-width: 0` is what flexbox needs before it is allowed to shrink a
 * form control at all.
 *
 * It costs almost nothing to read, because the two selects that get it are
 * only side by side under the alphabetical sort — where one reads "A–Z" and
 * the other reads a single letter. The only value long enough to be clipped is
 * the numbers bucket itself, and the chip below the bar says it in full.
 *
 * Switched off at `sm:` so the desktop row wraps as it always has rather than
 * quietly squeezing seven controls into one line on a 700px window.
 */
const SHRINKS = 'min-w-0 sm:min-w-[auto]'

/** The five filters a phone keeps behind the Filters button. */
type OccasionalKey = (typeof SHEET_FILTER_KEYS)[number]

/**
 * The five occasional filters, as five separate nodes the caller places itself.
 *
 * One source for them rather than two copies of the controls, because the
 * alternative is five `onChange` handlers written twice: the kind of
 * duplication where the sheet and the bar drift apart and only one of them
 * still clears the year properly.
 *
 * It hands back a record rather than a fragment, and that is the point. As a
 * fragment the five were adjacent in the DOM wherever they were used, so the
 * letter picker — which has to be a sibling on the bar, because it is one of
 * the two controls a phone keeps out here — could not be rendered into the
 * middle of them, and an `order` utility at `sm:` put it back visually while
 * leaving the tab order reading Genre, Watched, Year, Rating, Subtitled, First
 * letter, Sort. (Spelled out rather than quoted, because Tailwind scans
 * comments too and a quoted class here emits a utility nothing uses.)
 * Named nodes let the bar lay all seven out in one order (`BAR_CONTROLS`) with
 * no `order` utility anywhere, and let the sheet go on rendering the same five
 * together. Nothing about the controls themselves changed.
 *
 * `hidden sm:block` is on each control rather than on a wrapper around the
 * group, so the bar's `flex-wrap` still sees seven siblings on a wide screen
 * and wraps them the way it always has. (`display: block` is what
 * `inline-block` is blockified to as a flex item anyway, so the class changes
 * nothing that renders.)
 */
function occasionalFilters({
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
}): Record<OccasionalKey, ReactNode> {
  const years = decadeOptions(new Date().getFullYear(), filters)
  const layout = stacked ? 'w-full' : 'hidden sm:block'
  const control = `${CONTROL} ${layout}`

  /*
    In the bar, each control says what it is through its own idle option — "Any
    year", "All genres". In a column of five that is not enough: once a year is
    chosen the control reads "1990s" and nothing on screen says which filter
    that is. So the sheet labels them, and the bar does not grow labels it has
    never needed.
  */
  const field = (label: string, input: ReactNode) =>
    stacked ? (
      <label className="flex flex-col gap-1.5">
        <span className="text-sm text-white/55">{label}</span>
        {input}
      </label>
    ) : (
      input
    )

  return {
    // Omitted where the genre is the page's subject rather than a filter on it.
    genre:
      genres &&
      field(
        'Genre',
        <select
          aria-label="Genre"
          value={filters.genre}
          onChange={(e) => onFilters({ ...filters, genre: e.target.value })}
          className={control}
        >
          <option value="">All genres</option>
          {genreOptions(genres, filters.genre).map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>,
      ),

    watched: field(
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
    ),

    year: field(
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
    ),

    rating: field(
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
    ),

    /* Not wrapped in a label even in the sheet: a toggle button already says
       its own name, and a <label> around a button labels nothing. */
    subtitles: (
      <button
        type="button"
        aria-pressed={filters.subtitles}
        onClick={() => onFilters({ ...filters, subtitles: !filters.subtitles })}
        className={`${toggleClass(filters.subtitles)} ${layout}`}
      >
        Subtitled
      </button>
    ),
  }
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

  /*
    Where focus can be sent when a chip's × unmounts itself. Keyed by chip, plus
    "clear" and "sort" — `chipFocusAfterRemoval` decides which, and says why
    those are the three answers.
  */
  const focusable = useRef(new Map<string, HTMLElement | null>())
  const register = (key: string) => (el: HTMLElement | null) => {
    if (el) focusable.current.set(key, el)
    else focusable.current.delete(key)
  }

  const removeChip = (key: FilterKey) => {
    /*
      Moved before the filter is written, not after. The nodes this can land on
      are all keyed and all survive the re-render, so focusing one now and
      removing the chip a line later leaves the focus where it was put — where
      focusing afterwards would need a layout effect to run first, and the
      browser will have dropped focus on `<body>` in the meantime.
    */
    focusable.current.get(chipFocusAfterRemoval(chips.map((c) => c.key), key))?.focus()
    onFilters(clearFilter(filters, key))
  }

  /*
    Every control the bar can show, by name. Laid out below in one declared
    order rather than written in the order they happen to be constructed in —
    see `BAR_CONTROLS` for what went wrong when those two were different things.
  */
  const slots: Record<BarControl, ReactNode> = {
    ...occasionalFilters({ filters, onFilters, genres }),

    /*
      The letter picker, and the whole feature on a phone: keyboard- and
      screen-reader-native for free, where the rail beside the grid is
      neither. It is also what lets the rail be a desktop embellishment
      that could be removed without removing the feature. Shown only beside
      the alphabetical sort, because that is the only order it agrees with.
    */
    letter: letterApplies(sortKey) && (
      <select
        aria-label="First letter"
        value={filters.letter}
        onChange={(e) => onFilters({ ...filters, letter: parseLetter(e.target.value) })}
        className={`${CONTROL} ${SHRINKS}`}
      >
        {/*
          Both option texts are chosen around native type-ahead, which
          matches the start of an option rather than its value: "All
          titles" answered to A and "Numbers & symbols" to N, so the two
          likeliest keystrokes in an alphabet picker each landed on
          something else first and took a second press. `libraryFilters`
          holds both labels and why they read as they do.
        */}
        <option value="">{ALL_TITLES_LABEL}</option>
        {LETTERS.map((letter) => (
          <option key={letter} value={letter}>
            {letterOptionLabel(letter)}
          </option>
        ))}
      </select>
    ),

    sort: (
      <select
        ref={register('sort')}
        aria-label="Sort"
        value={sortKey}
        onChange={(e) => onSort(e.target.value as SortKey)}
        className={`${CONTROL} ${SHRINKS}`}
      >
        {sorts.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>
    ),
  }

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

        The seven are walked in `BAR_CONTROLS` order, so the DOM order *is* the
        visual order and the tab order is both. A phone has five of them
        `hidden`, which leaves the inline sequence First letter, Sort, Filters
        with nothing having to be moved.
      */}
      <div className="flex flex-nowrap items-center gap-2 sm:flex-wrap">
        {BAR_CONTROLS.map((key) => (
          <Fragment key={key}>{slots[key]}</Fragment>
        ))}

        <button
          type="button"
          aria-label={filtersButtonLabel(behindButton)}
          aria-expanded={sheetOpen}
          onClick={() => setSheetOpen(true)}
          className={`${toggleClass(behindButton > 0)} flex shrink-0 items-center gap-2 sm:hidden`}
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
              ref={register(chip.key)}
              type="button"
              onClick={() => removeChip(chip.key)}
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
            ref={register('clear')}
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
        in this app — Escape, the backdrop, a focus trap, a page that does not
        scroll underneath it and focus handed back to the button, all from the
        one place that is tested.

        The `sm:hidden` wrapper is for rotation. A phone turned to landscape is
        844px wide, which is past `sm:`, and the five controls are suddenly
        inline behind an open sheet holding the same five. Hiding it there
        resolves that into the desktop bar the viewer is now looking at,
        instead of a dialog arguing with the row underneath it.
      */}
      {sheetOpen && (
        <div className="sm:hidden">
          <Modal bottom title="Filters" onClose={() => setSheetOpen(false)}>
            <SheetFilters filters={filters} onFilters={onFilters} genres={genres} />
          </Modal>
        </div>
      )}
    </div>
  )
}

/**
 * The same five controls, stacked in the sheet — in `SHEET_FILTER_KEYS` order,
 * which is the order the badge counts them in and the order they sit in on a
 * wide screen.
 */
function SheetFilters({
  filters,
  onFilters,
  genres,
}: {
  filters: LibraryFilters
  onFilters: (next: LibraryFilters) => void
  genres?: string[]
}) {
  const slots = occasionalFilters({ filters, onFilters, genres, stacked: true })
  return (
    <>
      {SHEET_FILTER_KEYS.map((key) => (
        <Fragment key={key}>{slots[key]}</Fragment>
      ))}
    </>
  )
}
