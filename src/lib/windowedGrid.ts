/**
 * Rendering only the rows of a grid that are near the viewport.
 *
 * A library grid pages itself in as you scroll and keeps every card. By the
 * bottom of one real library that was 12,142 DOM nodes and 415 decoded images,
 * and — measured on a throttled phone — the cost that actually showed was not
 * holding them but *making* them: each new page of 60 rendered in one go, in
 * long tasks of 150ms or more landing exactly on the appends.
 *
 * Two earlier attempts on this are worth recording, because both look like the
 * answer and neither was. `content-visibility: auto` skips layout and paint
 * for off-screen cards, saved 9 MB of heap on a desktop and nothing at all on
 * a phone, and clipped the hover effect — a card grows past its box and cannot
 * if its paint is contained. Memoising the card stopped re-rendering the ones
 * already there, which is right and helped a little, but the new ones still
 * have to be built.
 *
 * Only rendering the rows in view addresses that: appending a page adds to an
 * array rather than to the document.
 *
 * ── How the height is kept ─────────────────────────────────────────────────
 *
 * With padding on the grid itself, not spacer elements — a spacer inside a
 * grid is a grid item and would take a cell. The padding stands in for the
 * rows that are not rendered, so the page is exactly as tall as it would have
 * been, the scrollbar does not move as you scroll, and the "keep your place"
 * restore still finds a page tall enough to scroll into.
 *
 * ── What this costs ────────────────────────────────────────────────────────
 *
 * Find-in-page only matches cards that are rendered, and tab order only
 * reaches them. That is the trade every windowing implementation makes and it
 * cannot be avoided while the point is to not render things. The overscan
 * exists to soften it: a few rows beyond the viewport in each direction are
 * kept, so tabbing or arrowing past the edge lands on something real.
 */

/** Rows kept beyond the viewport in each direction. */
export const OVERSCAN_ROWS = 3

/**
 * The window moves in steps of this many rows rather than one at a time.
 *
 * Recomputed per row, the slice changed about a hundred times over a full
 * scroll of one library and React reconciled the whole visible range each
 * time — which cost more in total than never windowing at all. Snapping the
 * range to a block means one re-render per four rows crossed, and since the
 * overscan is wider than the block nothing is ever blank while it catches up.
 */
export const BLOCK_ROWS = 4

const floorTo = (value: number, step: number) => Math.floor(value / step) * step

/**
 * How many items to render before the grid has been measured.
 *
 * Columns and row height are read from the laid-out grid, which cannot happen
 * until something has been laid out. This is enough to fill the tallest
 * plausible viewport at the widest column count, so the first paint is a full
 * screen rather than a gap that fills in a frame later.
 */
export const INITIAL_RENDER = 48

export interface GridMetrics {
  /** Resolved column count, from the grid's own tracks. */
  columns: number
  /** One row plus the gap under it, in pixels. */
  rowStride: number
  /** Distance from the top of the document to the top of the grid. */
  gridTop: number
}

export interface GridWindow {
  /** First item to render. */
  startIndex: number
  /** One past the last item to render. */
  endIndex: number
  paddingTop: number
  paddingBottom: number
}

/**
 * The slice to render, and the space to leave for the rest.
 *
 * Before the grid has been measured — `columns` or `rowStride` at zero — this
 * renders a first screenful with no padding. Windowing something whose shape
 * is unknown would mean guessing a height, and a wrong guess moves the
 * scrollbar under the viewer's hand.
 */
export function gridWindow({
  totalItems,
  metrics,
  scrollTop,
  viewportHeight,
  overscanRows = OVERSCAN_ROWS,
}: {
  totalItems: number
  metrics: GridMetrics | null
  scrollTop: number
  viewportHeight: number
  overscanRows?: number
}): GridWindow {
  if (totalItems <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 }
  }

  if (!metrics || metrics.columns <= 0 || metrics.rowStride <= 0) {
    return {
      startIndex: 0,
      endIndex: Math.min(totalItems, INITIAL_RENDER),
      paddingTop: 0,
      paddingBottom: 0,
    }
  }

  const { columns, rowStride, gridTop } = metrics
  const totalRows = Math.ceil(totalItems / columns)

  // How far the grid has scrolled past the top of the viewport. Negative while
  // it is still below the fold, which simply means starting at the first row.
  const scrolledInto = scrollTop - gridTop
  const firstVisibleRow = Math.max(0, Math.floor(scrolledInto / rowStride))
  const rowsInView = Math.ceil(viewportHeight / rowStride) + 1

  /*
    Both edges are measured from one snapped anchor rather than snapped
    separately. Snapped separately they cross their block boundaries at
    different moments, so the slice changed twice per block instead of once —
    eleven times over twenty rows, when the whole point was four.

    The anchor lags the first visible row by up to a block, so the bottom edge
    carries a block of slack on top of the overscan; without it, a viewer at
    the far end of a block would have the overscan below them eaten by the lag.
  */
  const anchorRow = floorTo(firstVisibleRow, BLOCK_ROWS)
  const startRow = Math.max(0, anchorRow - overscanRows)
  const endRow = Math.min(
    totalRows,
    anchorRow + rowsInView + overscanRows + BLOCK_ROWS,
  )

  return {
    startIndex: startRow * columns,
    endIndex: Math.min(totalItems, endRow * columns),
    /*
      `rowStride` includes the gap below a row, so `startRow` strides is
      exactly the space those rows occupied — their own height and the gaps
      between them. The same arithmetic below leaves the page the height it
      would have had, one trailing gap short, which is what a grid is anyway.
    */
    paddingTop: startRow * rowStride,
    paddingBottom: Math.max(0, (totalRows - endRow) * rowStride),
  }
}

/**
 * Whether a change in measurements is worth re-rendering for.
 *
 * A ResizeObserver fires for sub-pixel changes that cannot move a card, and
 * every one of them would otherwise rebuild the visible rows.
 */
export function metricsChanged(a: GridMetrics | null, b: GridMetrics | null): boolean {
  if (!a || !b) return a !== b
  return (
    a.columns !== b.columns ||
    Math.abs(a.rowStride - b.rowStride) > 0.5 ||
    Math.abs(a.gridTop - b.gridTop) > 0.5
  )
}

/** Whether two windows would render the same thing in the same place. */
export function sameWindow(a: GridWindow, b: GridWindow): boolean {
  return (
    a.startIndex === b.startIndex &&
    a.endIndex === b.endIndex &&
    a.paddingTop === b.paddingTop &&
    a.paddingBottom === b.paddingBottom
  )
}
