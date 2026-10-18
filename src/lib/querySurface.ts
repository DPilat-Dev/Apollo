/**
 * What a screen can honestly say about a list it asked the server for.
 *
 * Four outcomes rather than two, because the two that look the same on screen
 * are not the same fact: a list that came back empty and a list that never came
 * back both render nothing, and collapsing them is how a broken server comes to
 * look like an empty one. "No collections here yet" over a 500, or "this
 * account has no libraries" over a refused `/UserViews`, sends people to look
 * for the fault in the one place it is not.
 *
 * Decided here rather than in each screen so there is one rule — the box-set
 * shelf and the nav entry read it as `collectionsSurface`, Home reads it to
 * decide whether it has a page to draw at all, and both got it wrong in the
 * same way before it existed.
 */

/** Narrow enough to build one by hand in a test. */
export interface ListQuery {
  /** No answer yet — the first fetch is still in flight. */
  isPending: boolean
  isError: boolean
  data: readonly unknown[] | undefined
}

export type QuerySurface = 'pending' | 'failed' | 'empty' | 'ready'

export function querySurface(query: ListQuery): QuerySurface {
  // Loading is its own answer, never "none". Guessing here is what produces the
  // flash: an explanation, or a nav entry, rendered optimistically and pulled
  // away a moment later when the real answer lands.
  if (query.isPending) return 'pending'

  // A failed refetch that still holds last time's list is not a failure worth
  // reporting — the page it describes is on screen and still correct.
  if (query.isError && !query.data) return 'failed'

  return (query.data?.length ?? 0) > 0 ? 'ready' : 'empty'
}
