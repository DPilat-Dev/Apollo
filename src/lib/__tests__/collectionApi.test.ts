import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })

/** Records every request the api makes, and answers with a created box set. */
function stubFetch() {
  const calls: { url: URL; init: RequestInit }[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url: new URL(url), init })
    return Promise.resolve(
      new Response(JSON.stringify({ Id: 'bs-new' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

/*
  The three collection routes take everything in the query string — there is no
  JSON body anywhere, unlike /Playlists next door, which takes one. Posting the
  ids as a body is not an error the server reports: it answers 200 with a brand
  new, completely empty collection, and the only symptom is a box set with
  nothing in it appearing on the home page.
*/
describe('collection endpoints put everything in the query string', () => {
  it('creates a collection with its name and members as parameters', async () => {
    const calls = stubFetch()
    const created = await api.createCollection('Studio Ghibli', ['a', 'b'])

    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.body).toBeUndefined()
    expect(calls[0].url.pathname).toBe('/Collections')
    expect(calls[0].url.searchParams.get('name')).toBe('Studio Ghibli')
    expect(calls[0].url.searchParams.get('ids')).toBe('a,b')
    expect(created.Id).toBe('bs-new')
  })

  it('omits ids entirely rather than sending an empty one', async () => {
    // `ids=` is not the same as no ids: the comma-delimited binder reads it as
    // a list with one blank entry, which is a 400 on a good day.
    const calls = stubFetch()
    await api.createCollection('Later')
    expect(calls[0].url.searchParams.has('ids')).toBe(false)
  })

  it('adds members by comma-joined ids', async () => {
    const calls = stubFetch()
    await api.addToCollection('bs1', ['a', 'b'])

    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].url.pathname).toBe('/Collections/bs1/Items')
    expect(calls[0].url.searchParams.get('ids')).toBe('a,b')
    expect(calls[0].init.body).toBeUndefined()
  })

  it('removes members by comma-joined ids', async () => {
    const calls = stubFetch()
    await api.removeFromCollection('bs1', ['a'])

    expect(calls[0].init.method).toBe('DELETE')
    expect(calls[0].url.pathname).toBe('/Collections/bs1/Items')
    expect(calls[0].url.searchParams.get('ids')).toBe('a')
  })

  it('sends nothing at all when there is nothing to add or remove', async () => {
    // `ids` is required on both, so an empty list is a round trip that can
    // only fail — and on the remove side a request the viewer never asked for.
    const calls = stubFetch()
    await api.addToCollection('bs1', [])
    await api.removeFromCollection('bs1', [])
    expect(calls).toHaveLength(0)
  })
})
