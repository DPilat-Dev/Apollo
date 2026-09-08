import { describe, expect, it } from 'vitest'
import {
  BLOCK_ROWS,
  gridWindow,
  INITIAL_RENDER,
  metricsChanged,
  OVERSCAN_ROWS,
  type GridMetrics,
} from '../windowedGrid'

// Six columns, 250px rows, grid starting 300px down the page.
const metrics: GridMetrics = { columns: 6, rowStride: 250, gridTop: 300 }
const at = (scrollTop: number, over: Partial<Parameters<typeof gridWindow>[0]> = {}) =>
  gridWindow({ totalItems: 600, metrics, scrollTop, viewportHeight: 900, ...over })

describe('gridWindow', () => {
  it('renders from the top before anything has scrolled', () => {
    const w = at(0)
    expect(w.startIndex).toBe(0)
    expect(w.paddingTop).toBe(0)
  })

  it('renders enough to fill the viewport', () => {
    // 900px of viewport over 250px rows is four rows, plus one for the partial
    // row at each edge, plus the overscan.
    const w = at(0)
    expect(w.endIndex).toBeGreaterThanOrEqual(4 * 6)
  })

  it('moves the window down as the page scrolls', () => {
    const near = at(0)
    const far = at(5000)
    expect(far.startIndex).toBeGreaterThan(near.startIndex)
    expect(far.paddingTop).toBeGreaterThan(near.paddingTop)
  })

  it('keeps the page exactly as tall as it would have been', () => {
    // The invariant the scrollbar depends on: padding plus rendered rows must
    // come to the full height at any scroll position.
    const totalRows = Math.ceil(600 / 6)
    const fullHeight = totalRows * 250
    for (const scrollTop of [0, 1200, 5000, 12_000, 25_000]) {
      const w = at(scrollTop)
      const renderedRows = (w.endIndex - w.startIndex) / 6
      expect(w.paddingTop + renderedRows * 250 + w.paddingBottom).toBeCloseTo(fullHeight, 5)
    }
  })

  it('keeps rows above the viewport, so tabbing backwards lands on something', () => {
    // At least the overscan, and never more than a block beyond it — the
    // start is snapped down to a block boundary.
    const w = at(5000)
    const firstVisibleRow = Math.floor((5000 - 300) / 250)
    const startRow = w.startIndex / 6
    expect(startRow).toBeLessThanOrEqual(firstVisibleRow - OVERSCAN_ROWS)
    expect(startRow).toBeGreaterThan(firstVisibleRow - OVERSCAN_ROWS - BLOCK_ROWS)
  })

  it('does not scroll past the end', () => {
    const w = at(1_000_000)
    expect(w.endIndex).toBe(600)
    expect(w.paddingBottom).toBe(0)
  })

  it('starts at the first row while the grid is still below the fold', () => {
    // `scrollTop` under `gridTop` is a negative offset into the grid, which
    // must not become a negative row.
    const w = at(0, { metrics: { ...metrics, gridTop: 2000 } })
    expect(w.startIndex).toBe(0)
    expect(w.paddingTop).toBe(0)
  })

  it('handles a last row that is not full', () => {
    const w = gridWindow({ totalItems: 604, metrics, scrollTop: 1_000_000, viewportHeight: 900 })
    expect(w.endIndex).toBe(604)
  })

  it('renders everything when it all fits', () => {
    const w = gridWindow({ totalItems: 12, metrics, scrollTop: 0, viewportHeight: 900 })
    expect(w.startIndex).toBe(0)
    expect(w.endIndex).toBe(12)
    expect(w.paddingBottom).toBe(0)
  })

  it('has nothing to do with an empty grid', () => {
    const w = gridWindow({ totalItems: 0, metrics, scrollTop: 0, viewportHeight: 900 })
    expect(w).toEqual({ startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 })
  })
})

describe('before the grid has been measured', () => {
  const unmeasured = (metrics: GridMetrics | null) =>
    gridWindow({ totalItems: 600, metrics, scrollTop: 0, viewportHeight: 900 })

  it('renders a screenful and reserves nothing', () => {
    // Guessing a height for a grid whose shape is unknown would move the
    // scrollbar under the viewer's hand a frame later.
    const w = unmeasured(null)
    expect(w.startIndex).toBe(0)
    expect(w.endIndex).toBe(INITIAL_RENDER)
    expect(w.paddingTop).toBe(0)
    expect(w.paddingBottom).toBe(0)
  })

  it('treats nonsense measurements as no measurement', () => {
    // A grid measured while display:none reports zeroes.
    expect(unmeasured({ columns: 0, rowStride: 250, gridTop: 0 }).endIndex).toBe(INITIAL_RENDER)
    expect(unmeasured({ columns: 6, rowStride: 0, gridTop: 0 }).endIndex).toBe(INITIAL_RENDER)
  })

  it('never renders more than there is', () => {
    expect(gridWindow({ totalItems: 5, metrics: null, scrollTop: 0, viewportHeight: 900 }).endIndex).toBe(5)
  })
})

describe('metricsChanged', () => {
  it('notices a column count changing, which is what a resize means', () => {
    expect(metricsChanged(metrics, { ...metrics, columns: 5 })).toBe(true)
  })

  it('ignores sub-pixel noise', () => {
    // A ResizeObserver fires for changes that cannot move a card, and each one
    // would otherwise rebuild every visible row.
    expect(metricsChanged(metrics, { ...metrics, rowStride: 250.3 })).toBe(false)
    expect(metricsChanged(metrics, { ...metrics, gridTop: 300.4 })).toBe(false)
  })

  it('notices a real move', () => {
    expect(metricsChanged(metrics, { ...metrics, gridTop: 340 })).toBe(true)
    expect(metricsChanged(metrics, { ...metrics, rowStride: 260 })).toBe(true)
  })

  it('treats appearing and disappearing as a change', () => {
    expect(metricsChanged(null, metrics)).toBe(true)
    expect(metricsChanged(metrics, null)).toBe(true)
    expect(metricsChanged(null, null)).toBe(false)
  })
})

describe('the window moves in blocks', () => {
  it('changes once per block of rows, not once per row', () => {
    // Recomputed per row, the slice changed about a hundred times over a full
    // scroll and React reconciled the visible range each time — which cost
    // more than not windowing at all.
    const seen = new Set<string>()
    for (let row = 20; row < 40; row++) {
      const w = at(300 + row * 250)
      seen.add(`${w.startIndex}:${w.endIndex}`)
    }
    // Twenty rows crossed; one distinct window per block, give or take the
    // one the range starts inside.
    expect(seen.size).toBeLessThanOrEqual(20 / BLOCK_ROWS + 1)
    expect(seen.size).toBeGreaterThan(1)
  })

  it('snaps outwards, never inwards', () => {
    // Rounding the start up or the end down would uncover the rows the
    // overscan exists to hold. Clamped at the top, where there is nothing
    // above row zero to hold.
    for (const scrollTop of [1000, 3300, 7700, 15_000]) {
      const w = at(scrollTop)
      const firstVisibleRow = Math.max(0, Math.floor((scrollTop - 300) / 250))
      expect(w.startIndex / 6).toBeLessThanOrEqual(Math.max(0, firstVisibleRow - OVERSCAN_ROWS))
      const lastNeeded = firstVisibleRow + Math.ceil(900 / 250) + 1
      expect(w.endIndex / 6).toBeGreaterThanOrEqual(Math.min(100, lastNeeded))
    }
  })

  it('still ends exactly at the last item', () => {
    const w = at(1_000_000)
    expect(w.endIndex).toBe(600)
    expect(w.paddingBottom).toBe(0)
  })

  it('still keeps the page the right height', () => {
    const totalRows = Math.ceil(600 / 6)
    for (const scrollTop of [0, 2500, 9000, 20_000]) {
      const w = at(scrollTop)
      const renderedRows = (w.endIndex - w.startIndex) / 6
      expect(w.paddingTop + renderedRows * 250 + w.paddingBottom).toBeCloseTo(totalRows * 250, 5)
    }
  })
})
