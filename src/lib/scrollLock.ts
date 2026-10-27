/**
 * Holding the page still behind a dialog.
 *
 * Every overlay in this app stopped the page being *used* — a backdrop over it,
 * a focus trap inside it — and none of them stopped it moving. Measured on the
 * phone Filters sheet at 390×844: with the sheet open, a drag on the dimmed
 * backdrop scrolled the grid underneath from 0 to 500px while the sheet stayed
 * where it was. `body` computed to `overflow: hidden auto`, which is the
 * `overflow-x: hidden` in `index.css` and nothing at all on the axis that
 * matters. On a handset, a swipe on the dim area scrolling the list underneath
 * is the one thing a modal must not allow: the thing you are reading leaves the
 * screen while the dialog asking about it does not.
 *
 * ── Why a count and not a flag ─────────────────────────────────────────────
 *
 * Two dialogs can be over the page at once — the admin panels open the metadata
 * editor over a library, and either can be closed first. A flag set on open and
 * cleared on close hands the page back when the *inner* one closes, which is
 * the bug this fixes happening again with a dialog still on screen. So the
 * dialogs are counted, the first one locks, and the last one restores.
 *
 * ── Why the arithmetic is here and not in the component ───────────────────
 *
 * This repo's tests run in Node with no document by design, so what is left in
 * `Modal` is two style assignments and what is here is every decision they
 * depend on. The count and the gap are the two things that were wrong in every
 * hand-rolled scroll lock this file replaces.
 */

/** How many dialogs are over the page. */
let depth = 0

/**
 * One more dialog is over the page. True for the one that has to apply the
 * lock — everything after it is already locked.
 */
export function acquireScrollLock(): boolean {
  depth += 1
  return depth === 1
}

/**
 * One fewer. True for the one that has to restore the page.
 *
 * Clamped at zero, so a cleanup that ran without its setup — a Strict Mode
 * remount, a hot reload — cannot leave the count negative, which would make the
 * *next* dialog believe the lock was already held and never apply it.
 */
export function releaseScrollLock(): boolean {
  if (depth === 0) return false
  depth -= 1
  return depth === 0
}

/** Test seam — the count is deliberately not exported directly. */
export function scrollLockDepth(): number {
  return depth
}

/** Test seam, for a suite where one case must not leak into the next. */
export function resetScrollLock(): void {
  depth = 0
}

/**
 * The custom property the gap is published on, for the chrome that cannot be
 * compensated by padding the page.
 *
 * `body` padding holds the *page* still, and that is most of it. It cannot
 * reach anything `position: fixed`, which is laid out against the viewport —
 * and the viewport is the thing that just got 15px wider. Measured on a 1908px
 * window: the grid stayed exactly where it was and the nav bar's avatar, and
 * the letter rail, both slid 15px right. So the gap is also published here, and
 * the two pieces of right-anchored fixed chrome pad themselves by it. They
 * default to `0px` when no dialog is open, which is every other moment.
 */
export const SCROLLBAR_GAP_PROPERTY = '--dialog-scrollbar-gap'

/**
 * The width the page's scrollbar was occupying, to be given back as padding
 * while the lock holds.
 *
 * Hiding the page's overflow removes its scrollbar, and the viewport grows by
 * exactly that width — so without this every column, every centred thing and
 * the dialog itself slide sideways as it opens, which reads as the page
 * flinching. Zero where the scrollbar floats over the page instead of taking
 * width from it (phones, macOS), and clamped because a fractionally-scaled or
 * zoomed window can report a client width a hair wider than the inner width,
 * and negative padding is not a thing to apply.
 */
export function scrollbarGap(innerWidth: number, clientWidth: number): number {
  return Math.max(0, innerWidth - clientWidth)
}
