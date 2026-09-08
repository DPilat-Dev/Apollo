import { useCallback, useEffect, useRef, useState } from 'react'
import {
  gridWindow,
  metricsChanged,
  sameWindow,
  type GridMetrics,
  type GridWindow,
} from './windowedGrid'

/**
 * Measures a grid and says which of its items to render.
 *
 * Everything decided here is measured from the laid-out grid rather than
 * mirrored from the stylesheet. The column count comes from the resolved
 * `grid-template-columns`, so `sm:grid-cols-4 md:grid-cols-5 …` can change
 * without this knowing they exist; a copy of those breakpoints in JavaScript
 * would be a second source of truth that silently goes wrong.
 */
export function useWindowedGrid(totalItems: number): {
  ref: (node: HTMLDivElement | null) => void
  window: GridWindow
} {
  const [metrics, setMetrics] = useState<GridMetrics | null>(null)
  const nodeRef = useRef<HTMLDivElement | null>(null)

  /*
    The window itself is the state, not the scroll position.

    Storing the scroll position re-rendered the grid on every frame of every
    scroll, whether or not a different row had come into view. Measured on a
    throttled phone that turned three long tasks into eleven and total blocking
    work from 380ms to 700ms — worse than not windowing at all. What matters is
    whether the slice changed, which happens once per row crossed.
  */
  const [view, setView] = useState<GridWindow>(() =>
    gridWindow({ totalItems, metrics: null, scrollTop: 0, viewportHeight: 0 }),
  )
  const metricsRef = useRef<GridMetrics | null>(null)
  metricsRef.current = metrics
  const totalRef = useRef(totalItems)
  totalRef.current = totalItems

  const recompute = useCallback(() => {
    const next = gridWindow({
      totalItems: totalRef.current,
      metrics: metricsRef.current,
      scrollTop: window.scrollY,
      viewportHeight: window.innerHeight,
    })
    setView((current) => (sameWindow(current, next) ? current : next))
  }, [])

  const measure = useCallback(() => {
    const node = nodeRef.current
    if (!node) return
    const style = getComputedStyle(node)

    /*
      The resolved track list — "168px 168px 168px …" — one entry per column.
      `none` while the element is not laid out, which reads as zero columns and
      leaves the window unmeasured rather than guessing one.
    */
    const tracks = style.gridTemplateColumns
    const columns = tracks && tracks !== 'none' ? tracks.split(/\s+/).filter(Boolean).length : 0

    // The first child is a rendered card, so this is a real row height rather
    // than one derived from an aspect ratio that a badge might overflow.
    const firstRow = node.firstElementChild as HTMLElement | null
    const rowHeight = firstRow?.offsetHeight ?? 0
    const rowGap = Number.parseFloat(style.rowGap) || 0

    const rect = node.getBoundingClientRect()
    const next: GridMetrics = {
      columns,
      rowStride: rowHeight > 0 ? rowHeight + rowGap : 0,
      /*
        Where the first row would be if every row were rendered — which is the
        element's own top, because the padding standing in for the skipped rows
        is inside it. Subtracting that padding, as this did at first, counts it
        twice: the window then believed the page was scrolled further than it
        was and rendered rows below the viewport, leaving a blank screen that
        got worse the further you went.

        Document coordinates, because the scroll position is measured that way
        and the two are subtracted.
      */
      gridTop: rect.top + window.scrollY,
    }
    setMetrics((current) => (metricsChanged(current, next) ? next : current))
    metricsRef.current = next
    recompute()
  }, [recompute])

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      nodeRef.current = node
      if (node) measure()
    },
    [measure],
  )

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      // At most one calculation a frame; it only reaches React when the slice
      // it produces is different from the one on screen.
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        recompute()
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [recompute])

  useEffect(() => {
    const node = nodeRef.current
    if (!node || typeof ResizeObserver === 'undefined') return
    /*
      The grid's own box for a column-count change, and the window for anything
      that moves the grid down the page — a filter bar wrapping onto a second
      line moves every row with it.
    */
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  /*
    Re-measured when the item count changes: the first page arriving is what
    turns an empty grid into one with a row to measure, and nothing else fires
    for it.
  */
  useEffect(() => {
    measure()
  }, [measure, totalItems])

  return { ref, window: view }
}
