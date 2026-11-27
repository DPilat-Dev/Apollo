import { useCallback, useEffect, useRef, useState } from 'react'
import { canScrollLeft, canScrollRight, pageDistance } from './carousel'

/**
 * Wires a horizontal shelf to its arrows.
 *
 * Attach `scroller` to the overflowing element and call `measure` from its
 * `onScroll`. The arrows are told whether they can do anything before they
 * are drawn, so a shelf that fits its container shows none at all.
 *
 * `watch` is whatever changes the shelf's contents: a fresh measurement has
 * to happen when the cards arrive, not only when the box is resized.
 */
export function useCarousel(watch?: unknown) {
  const scroller = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setCanLeft(canScrollLeft(el))
    setCanRight(canScrollRight(el))
  }, [])

  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, watch])

  const page = useCallback((dir: -1 | 1) => {
    const el = scroller.current
    if (!el) return
    el.scrollBy({ left: pageDistance(el.clientWidth, dir), behavior: 'smooth' })
  }, [])

  return { scroller, canLeft, canRight, measure, page }
}
