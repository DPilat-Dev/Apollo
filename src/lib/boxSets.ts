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

/** Just enough of a `UserDto` to decide who may curate. */
interface CuratorLike {
  Policy?: {
    IsAdministrator?: boolean | null
    EnableCollectionManagement?: boolean | null
  } | null
}

/**
 * Whether this viewer may make and unmake collections.
 *
 * Worth stating plainly because the obvious guess is wrong: making a
 * collection is *not* an administrator action. Jellyfin puts every
 * `/Collections` route behind its CollectionManagement policy, which reads a
 * per-user permission — `EnableCollectionManagement` — that a server owner can
 * grant to anyone without also handing them the dashboard. Gating this on
 * `IsAdministrator` would quietly take the feature away from the households
 * where it is most useful.
 *
 * The administrator bit still counts, for a reason that has nothing to do with
 * seniority: the permission only arrived in 10.9, so a policy saved before
 * that has no flag to read, and the server admits an admin regardless. Reading
 * only the flag would hide the action from the one person who certainly has it.
 */
export function canManageCollections(user: CuratorLike | null | undefined): boolean {
  const policy = user?.Policy
  return Boolean(policy?.IsAdministrator || policy?.EnableCollectionManagement)
}

/** The collection a members grid belongs to, named well enough to put on a button. */
export interface CollectionInView {
  id: string
  name: string
}

/**
 * The collection whose members are on screen and can be taken out of it.
 *
 * A collection has no route of its own — `boxSetHref` sends it to `/browse`,
 * which is the same grid that renders an actor's filmography and a genre. So
 * the only thing separating "these are the members of a box set" from "these
 * are every film with Toshiro Mifune in it" is the pair of parameters that
 * href writes, and a remove control offered on the wrong one aims a DELETE at
 * a library folder.
 *
 * The permission is folded in here rather than checked at the call site,
 * because the two conditions are one decision — whether this grid may be
 * edited — and a caller that remembered one of them and forgot the other is
 * exactly how a viewer ends up pressing a button that 403s.
 */
export function collectionInView(input: {
  params: URLSearchParams
  canManage: boolean
}): CollectionInView | null {
  if (!input.canManage) return null
  const id = input.params.get('parentId')
  if (!id || input.params.get('kind') !== 'Collection') return null
  // Something has to go in "Remove from …", and an unnamed box set is rare but
  // not impossible; a button reading "Remove from" is worse than a vague one.
  return { id, name: input.params.get('name') || 'this collection' }
}

/**
 * Whether a typed name can become a collection, and what would go in it.
 *
 * The duplicate check is the part that earns this a function. Jellyfin will
 * make a second box set called Marvel without complaint, and the result is two
 * collections with the same name and half the films in each — a mess nothing
 * in the UI can explain afterwards. Better to point at the one already in the
 * list, which is one press away.
 */
export type CollectionCreatePlan =
  | { ok: true; name: string; itemIds: string[] }
  | { ok: false; problem: 'empty' | 'duplicate' }

export function planCollectionCreate(input: {
  name: string
  itemId?: string | null
  existing?: readonly BoxSetLike[]
}): CollectionCreatePlan {
  const name = input.name.trim()
  if (!name) return { ok: false, problem: 'empty' }

  const taken = (input.existing ?? []).some(
    (c) => (c.Name ?? '').trim().toLowerCase() === name.toLowerCase(),
  )
  if (taken) return { ok: false, problem: 'duplicate' }

  return { ok: true, name, itemIds: input.itemId ? [input.itemId] : [] }
}

/**
 * Everything a change to a collection moves.
 *
 * `boxSets` is the one that matters and the one easiest to leave out. The nav
 * entry, the home shelf and the collections grid are all hidden while that
 * list is empty — `collectionsSurface` says `absent` — so on a server with no
 * collections at all, the create that finally makes one has to refetch it or
 * the app goes on insisting there are none and the thing just made is
 * unreachable. That server is the whole reason this feature exists.
 *
 * `browse` is the members grid, which is where an add or a remove is watched
 * from; it is also where the collection was opened from, so a stale one shows
 * the item still sitting there after it was taken out.
 */
export const COLLECTION_QUERY_KEYS = ['boxSets', 'browse'] as const

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
