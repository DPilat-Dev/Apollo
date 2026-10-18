import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'u1', userName: 'D', token: 't' })

/** Records the urls asked for, and answers with `payload`. */
function stubFetch(payload: unknown = []) {
  const urls: string[] = []
  vi.stubGlobal('fetch', (url: string) => {
    urls.push(String(url))
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return urls
}

afterEach(() => vi.unstubAllGlobals())

describe('controllableSessions', () => {
  /*
    The whole point of the endpoint call. Without controllableByUserId the
    server answers with every session the caller may see, so the device picker
    listed other household members by name alongside what they were watching,
    and offered transport controls over it. Dropping this parameter would put
    that back.
  */
  it('asks the server which sessions this account may control', async () => {
    const urls = stubFetch([])
    await api.controllableSessions()

    const url = new URL(urls[0])
    expect(url.pathname).toBe('/Sessions')
    expect(url.searchParams.get('controllableByUserId')).toBe('u1')
    expect(url.searchParams.get('activeWithinSeconds')).toBe('600')
  })

  // A session that cannot be driven is not an option to offer, and this
  // device is already the thing being looked at.
  it('drops sessions that take no commands', async () => {
    stubFetch([
      { Id: 's1', SupportsRemoteControl: true, DeviceId: 'other' },
      { Id: 's2', SupportsRemoteControl: false, DeviceId: 'another' },
      { SupportsRemoteControl: true, DeviceId: 'no-id' },
    ])
    const sessions = await api.controllableSessions()
    expect(sessions.map((s) => s.Id)).toEqual(['s1'])
  })
})
