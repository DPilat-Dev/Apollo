/**
 * The arithmetic behind a horizontal shelf's arrows.
 *
 * Shared by every shelf that scrolls sideways, so there is one answer to
 * "can this move?" rather than one per component that drifts from the rest.
 */

/** What a scroller has to tell us. A real element satisfies this as it is. */
export interface ScrollBox {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/**
 * Overflow smaller than this does not earn an arrow. Sub-pixel layout and
 * rounded scroll positions both stop a few pixels short of the true end, and
 * an arrow that moves nothing reads as broken.
 */
export const EDGE_SLACK = 8;

/** Short of a full page, so part of the previous card stays on screen. */
export const PAGE_FRACTION = 0.85;

export function canScrollLeft({ scrollLeft }: ScrollBox): boolean {
  return scrollLeft > EDGE_SLACK;
}

export function canScrollRight({
  scrollLeft,
  clientWidth,
  scrollWidth,
}: ScrollBox): boolean {
  return scrollLeft + clientWidth < scrollWidth - EDGE_SLACK;
}

/** How far one press of an arrow moves the shelf. */
export function pageDistance(clientWidth: number, dir: -1 | 1): number {
  return dir * clientWidth * PAGE_FRACTION;
}
