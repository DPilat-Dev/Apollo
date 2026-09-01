import { describe, expect, it } from 'vitest'
import {
  boxSetHref,
  collectionsSurface,
  shouldShowCollections,
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
