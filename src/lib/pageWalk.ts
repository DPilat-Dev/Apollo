/**
 * Reading the state of an infinite query's walk through its pages.
 *
 * Four screens page through `/Items` and three of them do it to build a total,
 * and the question they all get wrong in the same way is what a *refused* page
 * means. A page that fails leaves `hasNextPage` true while `isFetchingNextPage`
 * goes back to false — which is indistinguishable from "there is more and
 * nobody has asked for it yet", and is why the walk has to be asked about
 * through something that knows better.
 *
 * `isFetchNextPageError` is the flag that knows: it is `isError &&
 * fetchDirection === 'forward'`, so it stays set until a page *succeeds* rather
 * than until `fetchNextPage` is called again. That is what makes it safe to
 * stop a walk on it — and what makes a Try again button, rather than another
 * scroll, the way out of the stopped state.
 */
export interface PageWalk {
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** Set by a refused page; cleared only by a page that arrives. */
  isFetchNextPageError: boolean
}

/**
 * Whether more pages are still coming.
 *
 * What the screens hang their skeletons, spinners and "Counting…" on. A total
 * is not a small number until the last page is in — it is a wrong one — so none
 * of them may show a figure while this is true.
 *
 * The error term is the whole reason this is a function. A walk that reads
 * "still settling" from `hasNextPage` alone never finishes once a page has been
 * refused, so the heat map counts for ever, the recap page shimmers for ever,
 * and the story's spinner outlives every request feeding it. A stopped walk is
 * not a settling one: it has given up, and the screen should show whatever did
 * arrive and say that it is partial.
 */
export function pagesSettling(walk: PageWalk & { isLoading: boolean }): boolean {
  if (walk.isLoading) return true
  if (walk.isFetchNextPageError) return false
  return walk.hasNextPage || walk.isFetchingNextPage
}
