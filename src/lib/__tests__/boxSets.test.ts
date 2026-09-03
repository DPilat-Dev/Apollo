import { describe, expect, it } from 'vitest'
import {
  boxSetHref,
  canManageCollections,
  collectionInView,
  collectionsSurface,
  planCollectionCreate,
  shouldShowCollections,
  COLLECTION_QUERY_KEYS,
  type CollectionsQuery,
} from '../boxSets'

const query = (over: Partial<CollectionsQuery> = {}): CollectionsQuery => ({
  isPending: false,
  isError: false,
  data: [],
  ...over,
})

describe('collectionsSurface', () => {
  it('reports the collections a server actually has', () => {
    expect(collectionsSurface(query({ data: [{ Id: 'a' }] }))).toBe('present')
  })

  it('separates a server with no collections from one still loading', () => {
    // The two used to be the same "falsy" branch, which is how the nav entry
    // came to appear and then disappear a moment later.
    expect(collectionsSurface(query({ data: [] }))).toBe('absent')
    expect(collectionsSurface(query({ isPending: true, data: undefined }))).toBe('pending')
  })

  it('separates a failed request from an empty server', () => {
    // Both hide the entry, but only one of them is worth telling anyone about.
    expect(collectionsSurface(query({ isError: true, data: undefined }))).toBe('failed')
    expect(collectionsSurface(query({ data: [] }))).toBe('absent')
  })

  it('keeps the last known list when a background refetch fails', () => {
    expect(collectionsSurface(query({ isError: true, data: [{ Id: 'a' }] }))).toBe('present')
    expect(collectionsSurface(query({ isError: true, data: [] }))).toBe('absent')
  })
})

describe('shouldShowCollections', () => {
  it('offers collections only once some are known to exist', () => {
    expect(shouldShowCollections(query({ data: [{ Id: 'a' }] }))).toBe(true)
  })

  it('shows nothing on a server with no collections', () => {
    expect(shouldShowCollections(query({ data: [] }))).toBe(false)
  })

  it('shows nothing while the answer is still in flight', () => {
    expect(shouldShowCollections(query({ isPending: true, data: undefined }))).toBe(false)
  })

  it('shows nothing when the request failed', () => {
    // An entry leading to a screen that can only apologise is worse than no
    // entry at all.
    expect(shouldShowCollections(query({ isError: true, data: undefined }))).toBe(false)
  })
})

describe('boxSetHref', () => {
  it('sends a box set to the grid of its members', () => {
    const href = boxSetHref({ Id: 'abc', Name: 'The Lord of the Rings', Type: 'BoxSet' })
    const params = new URLSearchParams(href!.split('?')[1])
    expect(href!.startsWith('/browse?')).toBe(true)
    expect(params.get('parentId')).toBe('abc')
    expect(params.get('name')).toBe('The Lord of the Rings')
  })

  it('survives names full of URL punctuation', () => {
    // "Fast & Furious" and friends: unescaped, the ampersand truncated the
    // title and left a stray query param behind.
    const href = boxSetHref({ Id: 'x', Name: 'Fast & Furious: 100% ?', Type: 'BoxSet' })
    const params = new URLSearchParams(href!.split('?')[1])
    expect(params.get('name')).toBe('Fast & Furious: 100% ?')
    expect(params.get('parentId')).toBe('x')
  })

  it('leaves anything that is not a box set alone', () => {
    expect(boxSetHref({ Id: 'abc', Name: 'Blade Runner', Type: 'Movie' })).toBeNull()
    expect(boxSetHref({ Id: 'abc', Name: 'A Show', Type: 'Series' })).toBeNull()
  })

  it('refuses an id-less item rather than linking to a broken grid', () => {
    expect(boxSetHref({ Name: 'Nameless', Type: 'BoxSet' })).toBeNull()
  })

  it('still links when the collection has no name', () => {
    const href = boxSetHref({ Id: 'abc', Type: 'BoxSet' })
    expect(href).not.toBeNull()
    expect(new URLSearchParams(href!.split('?')[1]).get('parentId')).toBe('abc')
  })
})

describe('canManageCollections', () => {
  const user = (policy: Record<string, boolean> | null) => ({ Policy: policy })

  it('lets an ordinary viewer who was granted the permission curate', () => {
    // /Collections sits behind Jellyfin's CollectionManagement policy, which
    // is a per-user flag rather than the administrator bit — a server owner
    // can hand it to a housemate without handing over the dashboard.
    expect(canManageCollections(user({ EnableCollectionManagement: true }))).toBe(true)
  })

  it('withholds it from a viewer who was not granted it', () => {
    expect(canManageCollections(user({ EnableCollectionManagement: false }))).toBe(false)
    expect(canManageCollections(user({}))).toBe(false)
  })

  it('gives it to an administrator whose flag was never written', () => {
    // The flag arrived in 10.9; a policy saved before that carries only the
    // administrator bit, and the server lets an admin through either way.
    expect(canManageCollections(user({ IsAdministrator: true }))).toBe(true)
  })

  it('says no while nobody is loaded, rather than offering an action that 403s', () => {
    expect(canManageCollections(undefined)).toBe(false)
    expect(canManageCollections(user(null))).toBe(false)
  })
})

describe('collectionInView', () => {
  const view = (search: string, canManage = true) =>
    collectionInView({ params: new URLSearchParams(search), canManage })

  it('finds the collection whose members are on screen', () => {
    expect(view('parentId=bs1&kind=Collection&name=Marvel')).toEqual({
      id: 'bs1',
      name: 'Marvel',
    })
  })

  it('leaves every other browse grid alone', () => {
    // There is no removing from a person or a genre, and a DELETE aimed at a
    // library folder is not something to offer by accident.
    expect(view('personIds=p1')).toBeNull()
    expect(view('parentId=lib1')).toBeNull()
    expect(view('parentId=lib1&kind=Library')).toBeNull()
    expect(view('kind=Collection')).toBeNull()
  })

  it('withholds it from a viewer who may not curate', () => {
    // Anyone the collection is visible to can read the grid; taking something
    // out of it is a different permission entirely.
    expect(view('parentId=bs1&kind=Collection&name=Marvel', false)).toBeNull()
  })

  it('names an unnamed collection something a button can say', () => {
    expect(view('parentId=bs1&kind=Collection')).toEqual({
      id: 'bs1',
      name: 'this collection',
    })
  })
})

describe('planCollectionCreate', () => {
  const existing = [{ Id: 'a', Name: 'Marvel', Type: 'BoxSet' }]

  it('plans a collection holding the item it was started from', () => {
    expect(planCollectionCreate({ name: 'Studio Ghibli', itemId: 'i1' })).toEqual({
      ok: true,
      name: 'Studio Ghibli',
      itemIds: ['i1'],
    })
  })

  it('trims, because a trailing space becomes part of the name on the server', () => {
    expect(planCollectionCreate({ name: '  Ghibli \n', itemId: 'i1' })).toMatchObject({
      ok: true,
      name: 'Ghibli',
    })
  })

  it('refuses a name that is only whitespace', () => {
    expect(planCollectionCreate({ name: '   ', itemId: 'i1' })).toEqual({
      ok: false,
      problem: 'empty',
    })
  })

  it('refuses a name a collection already has, whatever the case', () => {
    // Jellyfin will happily make a second box set called Marvel, and then
    // neither of the two holds everything.
    expect(planCollectionCreate({ name: ' marvel ', itemId: 'i1', existing })).toEqual({
      ok: false,
      problem: 'duplicate',
    })
  })

  it('lets a name that merely resembles an existing one through', () => {
    expect(planCollectionCreate({ name: 'Marvel Phase 2', itemId: 'i1', existing })).toMatchObject({
      ok: true,
    })
  })

  it('plans an empty collection when no item started it', () => {
    expect(planCollectionCreate({ name: 'Later' })).toEqual({
      ok: true,
      name: 'Later',
      itemIds: [],
    })
  })
})

describe('COLLECTION_QUERY_KEYS', () => {
  it('includes the box-set list, or the very first collection stays invisible', () => {
    // The nav entry and the home shelf are both drawn from ['boxSets'], and
    // both stay hidden while it is empty. A create that does not refetch it
    // leaves the app insisting this server has no collections — which is the
    // exact state this feature exists to get out of.
    expect(COLLECTION_QUERY_KEYS).toContain('boxSets')
  })

  it('includes the members grid, which is where a removal has to show', () => {
    expect(COLLECTION_QUERY_KEYS).toContain('browse')
  })
})
