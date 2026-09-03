import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })

interface Sent {
  url: string
  method: string
  body: unknown
}

/** Records every request and answers each with the next queued response. */
function stubFetch(...responses: { status: number; body?: unknown }[]) {
  const sent: Sent[] = []
  let at = 0
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    })
    const next = responses[Math.min(at++, responses.length - 1)] ?? { status: 200 }
    return Promise.resolve(
      // Null, not '': a 204 with a body is not a response the platform will
      // construct, and the save endpoint answers 204.
      new Response(next.body === undefined ? null : JSON.stringify(next.body), {
        status: next.status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return sent
}

afterEach(() => vi.unstubAllGlobals())

describe('reading a plugin configuration', () => {
  it('fetches the document for an admin', async () => {
    const sent = stubFetch({ status: 200, body: { TmdbApiKey: '', IncludeAdult: false } })
    expect(await api.pluginConfiguration({ isAdmin: true, pluginId: 'p1' })).toEqual({
      TmdbApiKey: '',
      IncludeAdult: false,
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].url).toContain('/Plugins/p1/Configuration')
  })

  it('sends nothing at all for a non-admin', async () => {
    // The gate is here rather than in the panel, so a second caller that
    // forgets the route is elevated cannot make the request either.
    const sent = stubFetch({ status: 200, body: {} })
    expect(await api.pluginConfiguration({ isAdmin: false, pluginId: 'p1' })).toBeNull()
    expect(sent).toHaveLength(0)
  })

  it('reads a 404 as "this plugin has no configuration", not as a failure', async () => {
    // Every plugin the server did not load answers this way. It is the normal
    // case on a server with an out-of-date plugin, and a thrown error would
    // put a red box where a plain sentence belongs.
    stubFetch({ status: 404, body: { title: 'Not Found' } })
    expect(await api.pluginConfiguration({ isAdmin: true, pluginId: 'p1' })).toBeNull()
  })

  it('still reports a real failure', async () => {
    stubFetch({ status: 500, body: { title: 'boom' } })
    await expect(api.pluginConfiguration({ isAdmin: true, pluginId: 'p1' })).rejects.toThrow()
  })
})

describe('saving a plugin configuration', () => {
  it('posts the whole document, keys the form never showed included', async () => {
    const sent = stubFetch({ status: 204 })
    await api.savePluginConfiguration({
      isAdmin: true,
      pluginId: 'p1',
      config: { TmdbApiKey: 'real-key', Nested: { a: 1 }, IncludeAdult: true },
    })
    expect(sent[0].method).toBe('POST')
    expect(sent[0].url).toContain('/Plugins/p1/Configuration')
    expect(sent[0].body).toEqual({
      TmdbApiKey: 'real-key',
      Nested: { a: 1 },
      IncludeAdult: true,
    })
  })

  it('refuses to write for a non-admin instead of letting the server decide', async () => {
    const sent = stubFetch({ status: 204 })
    await expect(
      api.savePluginConfiguration({ isAdmin: false, pluginId: 'p1', config: {} }),
    ).rejects.toThrow(/administrator/i)
    expect(sent).toHaveLength(0)
  })
})

describe('enabling and disabling a plugin', () => {
  it('posts to the versioned route', async () => {
    const sent = stubFetch({ status: 204 })
    await api.setPluginEnabled({ isAdmin: true, pluginId: 'p1', version: '2.0.0', enable: false })
    expect(sent[0].method).toBe('POST')
    expect(sent[0].url).toContain('/Plugins/p1/2.0.0/Disable')
  })

  it('refuses for a non-admin', async () => {
    const sent = stubFetch({ status: 204 })
    await expect(
      api.setPluginEnabled({ isAdmin: false, pluginId: 'p1', version: '2.0.0', enable: true }),
    ).rejects.toThrow(/administrator/i)
    expect(sent).toHaveLength(0)
  })
})
