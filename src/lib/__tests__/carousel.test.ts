import { describe, expect, it } from 'vitest'
import {
  EDGE_SLACK,
  canScrollLeft,
  canScrollRight,
  pageDistance,
  type ScrollBox,
} from '../carousel'

/**
 * The arithmetic behind a horizontal shelf's arrows.
 *
 * Pulled out of `Row` so the home page's schedule strip can have the same
 * arrows without a second copy of these numbers. The rules worth pinning:
 * an arrow that does nothing must never be offered, and a page must leave
 * part of the previous card on screen so the shelf reads as continuous.
 */
const box = (scrollLeft: number, clientWidth: number, scrollWidth: number): ScrollBox => ({
  scrollLeft,
  clientWidth,
  scrollWidth,
})

describe('carousel arrows', () => {
  it('offers neither arrow for a shelf that fits', () => {
    const fits = box(0, 500, 500)
    expect(canScrollLeft(fits)).toBe(false)
    expect(canScrollRight(fits)).toBe(false)
  })

  it('offers no left arrow at the start', () => {
    expect(canScrollLeft(box(0, 500, 2000))).toBe(false)
  })

  it('offers no right arrow at the end', () => {
    expect(canScrollRight(box(1500, 500, 2000))).toBe(false)
  })

  it('offers both arrows in the middle', () => {
    const middle = box(700, 500, 2000)
    expect(canScrollLeft(middle)).toBe(true)
    expect(canScrollRight(middle)).toBe(true)
  })

  it('ignores a sliver of overflow at either edge', () => {
    // Sub-pixel layout and rounded scroll positions both land a few pixels
    // short of the real end; an arrow that moves nothing is worse than none.
    expect(canScrollLeft(box(EDGE_SLACK, 500, 2000))).toBe(false)
    expect(canScrollLeft(box(EDGE_SLACK + 1, 500, 2000))).toBe(true)
    expect(canScrollRight(box(0, 500, 500 + EDGE_SLACK))).toBe(false)
    expect(canScrollRight(box(0, 500, 500 + EDGE_SLACK + 1))).toBe(true)
  })

  it('pages by less than a full width, so a card stays in view', () => {
    const step = pageDistance(500, 1)
    expect(step).toBeGreaterThan(0)
    expect(step).toBeLessThan(500)
  })

  it('pages the other way on the way back', () => {
    expect(pageDistance(500, -1)).toBe(-pageDistance(500, 1))
  })
})
