/**
 * Whether a horizontal strip is scrolled to its end — or never scrolled at all.
 *
 * Used to decide whether to draw the fade that says "there is more this way".
 * The case worth being careful about is the one a browser test cannot easily
 * reach: a strip that fits. It has no end to be short of, so it is *already*
 * at the end, and a fade over it is a lie about there being more.
 */
export function atScrollEnd(el: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'> | null): boolean {
  if (!el) return true
  /*
    A pixel of slack. Fractional layouts leave scrollLeft a hair short of the
    arithmetic end, and a fade that never quite goes away is worse than one
    that was never drawn.
  */
  return el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
}
