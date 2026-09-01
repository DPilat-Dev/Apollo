/**
 * Collections — Jellyfin's `BoxSet`, the thing a curator makes when they group
 * the three Lord of the Rings films or put Marvel in release order.
 *
 * Unrelated to `collections.ts`, which is about which item *types* a library
 * surfaces. This one is about the box sets themselves.
 *
 * The whole surface is conditional: plenty of servers have never had a box set
 * made on them, and for those the app has to look exactly as it did before this
 * existed — no nav entry, no shelf, no "Collections (0)". That decision depends
 * on a request, so it lives here where all four of its outcomes can be checked
 * without a browser.
 */

/** The shape of the box-set query, narrow enough to build one by hand in a test. */
export interface CollectionsQuery {
  /** No answer yet — the first fetch is still in flight. */
  isPending: boolean
  isError: boolean
  data: readonly unknown[] | undefined
}

/**
 * The four outcomes, kept apart on purpose.
 *
 * `absent` and `failed` both end up hiding things, but they are not the same
 * fact and the pages that can say so should say so: one means this server has
 * no collections, the other means we never got to ask.
 */
export type CollectionsSurface = 'pending' | 'failed' | 'absent' | 'present'

export function collectionsSurface(query: CollectionsQuery): CollectionsSurface {
  // Loading is its own answer, never "none". Guessing here is what produces
  // the flash — an entry rendered optimistically and pulled away a moment
  // later when the empty result lands.
  if (query.isPending) return 'pending'

  // A failed refetch that still has last time's list is not a failure worth
  // reporting; without this, a flaky refresh makes the shelf someone is
  // looking at vanish.
  if (query.isError && !query.data) return 'failed'

  return (query.data?.length ?? 0) > 0 ? 'present' : 'absent'
}

/**
 * Whether to offer collections anywhere the user did not ask for them — the
 * home shelf and the nav. Only a list we have actually seen counts.
 */
export function shouldShowCollections(query: CollectionsQuery): boolean {
  return collectionsSurface(query) === 'present'
}

/** Just enough of a `BaseItemDto` to decide where a card leads. */
interface BoxSetLike {
  Id?: string | null
  Name?: string | null
  Type?: string | null
}

/**
 * Where a collection opens: the members grid, not a detail page.
 *
 * `/browse` already renders "every item matching this filter" with paging and
 * sorting, and a box set's members are exactly that — `ParentId` is one more
 * filter alongside the person and genre ones, so a collection needs no route of
 * its own. Returning null for everything else lets a card ask unconditionally
 * and fall back to its normal destination.
 */
export function boxSetHref(item: BoxSetLike): string | null {
  if (item.Type !== 'BoxSet' || !item.Id) return null
  const params = new URLSearchParams({ parentId: item.Id, kind: 'Collection' })
  // Encoded rather than interpolated: an unescaped "Fast & Furious" cut the
  // title in half and left the tail behind as its own query parameter.
  if (item.Name) params.set('name', item.Name)
  return `/browse?${params.toString()}`
}
