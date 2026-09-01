import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })

interface Call {
  url: string
  method?: string
  body?: unknown
}

/** Records every request the api makes, and answers with `payload`. */
function stubFetch(payload: unknown = []) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

describe('remoteSearch', () => {
  it('posts the query to the endpoint for the kind being identified', async () => {
    const calls = stubFetch([{ Name: 'Breaking Bad' }])
    await api.remoteSearch('Series', { ItemId: 'item-1', SearchInfo: { Name: 'Breaking Bad' } })

    expect(calls[0].url).toBe('http://s/Items/RemoteSearch/Series')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].body).toEqual({ ItemId: 'item-1', SearchInfo: { Name: 'Breaking Bad' } })
  })

  it('posts a movie lookup somewhere else entirely', async () => {
    const calls = stubFetch([])
    await api.remoteSearch('Movie', { ItemId: 'item-1' })
    expect(calls[0].url).toBe('http://s/Items/RemoteSearch/Movie')
  })

  /*
    These endpoints answer with a bare array, and a server with every provider
    disabled answers 204. Both have to arrive as a list or the picker throws
    on .map before it can say "no matches".
  */
  it('always comes back as a list', async () => {
    stubFetch(undefined)
    await expect(api.remoteSearch('Series', { ItemId: 'item-1' })).resolves.toEqual([])
  })
})

/*
  Apply is destructive by default, and the default is the server's, not ours:
  replaceAllImages defaults to true on /Items/RemoteSearch/Apply, and combined
  with the RemoveOldMetadata the controller hardcodes it deletes every image on
  the item before re-downloading. An admin who fixed a wrong match on a series
  whose poster they had hand-picked would lose the poster without being asked.
*/
describe('applyRemoteSearch', () => {
  it('leaves existing artwork alone unless told otherwise', async () => {
    const calls = stubFetch()
    await api.applyRemoteSearch('item-1', { Name: 'Breaking Bad' })

    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/Items/RemoteSearch/Apply/item-1')
    expect(url.searchParams.get('replaceAllImages')).toBe('false')
    expect(calls[0].method).toBe('POST')
  })

  it('replaces artwork when the admin asks for it', async () => {
    const calls = stubFetch()
    await api.applyRemoteSearch('item-1', { Name: 'Breaking Bad' }, { replaceAllImages: true })
    expect(new URL(calls[0].url).searchParams.get('replaceAllImages')).toBe('true')
  })

  it('sends the whole chosen result, since the provider ids are the point', async () => {
    const calls = stubFetch()
    const chosen = { Name: 'Breaking Bad', ProviderIds: { Tmdb: '1396' }, ProductionYear: 2008 }
    await api.applyRemoteSearch('item-1', chosen)
    expect(calls[0].body).toEqual(chosen)
  })
})

describe('remoteImages', () => {
  it('asks for one window of one image type', async () => {
    const calls = stubFetch({ Images: [], TotalRecordCount: 0 })
    await api.remoteImages('item-1', { type: 'Backdrop', startIndex: 24, limit: 24 })

    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/Items/item-1/RemoteImages')
    expect(url.searchParams.get('type')).toBe('Backdrop')
    expect(url.searchParams.get('startIndex')).toBe('24')
    expect(url.searchParams.get('limit')).toBe('24')
  })

  /*
    Off by default. Providers hold a poster per language, and turning them all
    on multiplies a list that is already the reason this dialog pages.
  */
  it('keeps the language filter on unless it is turned off', async () => {
    const calls = stubFetch({ Images: [] })
    await api.remoteImages('item-1', { type: 'Primary' })
    expect(new URL(calls[0].url).searchParams.get('includeAllLanguages')).toBe('false')

    const more = stubFetch({ Images: [] })
    await api.remoteImages('item-1', { type: 'Primary', includeAllLanguages: true })
    expect(new URL(more[0].url).searchParams.get('includeAllLanguages')).toBe('true')
  })

  it('narrows to one provider when asked', async () => {
    const calls = stubFetch({ Images: [] })
    await api.remoteImages('item-1', { type: 'Primary', providerName: 'TheMovieDb' })
    expect(new URL(calls[0].url).searchParams.get('providerName')).toBe('TheMovieDb')
  })

  /*
    A server whose image providers all failed answers with a body that has no
    Images at all. The grid maps over this, so an empty list has to survive
    the trip rather than arriving as undefined.
  */
  it('survives a result carrying no images', async () => {
    stubFetch({})
    const res = await api.remoteImages('item-1', { type: 'Primary' })
    expect(res.Images).toEqual([])
    expect(res.TotalRecordCount).toBe(0)
  })
})

describe('downloadRemoteImage', () => {
  it('names the type and the url it is fetching', async () => {
    const calls = stubFetch()
    await api.downloadRemoteImage('item-1', 'Logo', 'https://p/logo.png?size=w500')

    const url = new URL(calls[0].url)
    expect(url.pathname).toBe('/Items/item-1/RemoteImages/Download')
    expect(url.searchParams.get('type')).toBe('Logo')
    // Round-tripped through URLSearchParams rather than interpolated: a
    // provider url with its own query string would otherwise fold into ours.
    expect(url.searchParams.get('imageUrl')).toBe('https://p/logo.png?size=w500')
    expect(calls[0].method).toBe('POST')
  })
})
