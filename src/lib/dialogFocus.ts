/**
 * Making a dialog behave like one.
 *
 * Every overlay in this app was a `<div>` with a click-away backdrop. Nothing
 * announced itself as a dialog, Escape did nothing, and Tab walked straight out
 * of an open modal into the page behind it — where the links still worked, so a
 * keyboard could navigate away from a dialog that was still covering the screen.
 *
 * The arithmetic of the trap is here, away from the DOM, so it can be tested at
 * all: this repo's tests run in node with no document by design. What is left in
 * the component is finding the focusable elements and calling `focus`.
 */

/**
 * What counts as focusable.
 *
 * `[tabindex="-1"]` is excluded deliberately: it means "focusable by script,
 * not by Tab", which is exactly what the dialog container itself is given so it
 * can take focus on open without joining the cycle it defines.
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

/** Escape, including the name old browsers report. */
export function isDismissKey(key: string): boolean {
  return key === 'Escape' || key === 'Esc'
}

/**
 * Where Tab should go, or null to let the browser move focus itself.
 *
 * Null is the common answer and the important one: a trap that intercepts every
 * Tab has to reimplement the browser's own idea of document order, and gets it
 * wrong for anything it did not think of. This only steps in at the two ends of
 * the cycle, and when focus has escaped the dialog entirely — which is what
 * happens after the browser's address bar hands focus back.
 */
export function trapTarget<T>({
  items,
  active,
  backwards = false,
}: {
  items: readonly T[]
  active: T | null | undefined
  backwards?: boolean
}): T | null {
  if (items.length === 0) return null

  const first = items[0]
  const last = items[items.length - 1]
  const at = active == null ? -1 : items.indexOf(active)

  // Focus is somewhere else entirely: pull it back to the near end.
  if (at === -1) return backwards ? last : first

  if (!backwards && at === items.length - 1) return first
  if (backwards && at === 0) return last

  return null
}

/**
 * What to focus when a dialog opens.
 *
 * The first focusable thing, so Tab starts inside and a screen reader begins on
 * something actionable. A dialog with nothing focusable in it gets the fallback
 * — its own container — because focus has to be somewhere, and leaving it on the
 * button that opened the dialog means Escape and Tab both apply to the page
 * behind.
 */
export function initialFocus<T>(items: readonly T[], fallback: T): T {
  return items.length > 0 ? items[0] : fallback
}
