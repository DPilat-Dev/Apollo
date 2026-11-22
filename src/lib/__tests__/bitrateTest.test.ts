import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })

afterEach(() => vi.unstubAllGlobals())

describe('the bitrate probe', () => {
  it('asks the server for exactly the size it wants to time', () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return Promise.resolve(new Response(new ArrayBuffer(500_000), { status: 200 }))
    })

    return api.bitrateTest(500_000).then((result) => {
      expect(calls[0].url).toBe('http://s/Playback/BitrateTest?size=500000')
      // Served from the disk cache, the probe measures the disk.
      expect(calls[0].init?.cache).toBe('no-store')
      expect(result.bytes).toBe(500_000)
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0)
    })
  })

  it('carries the session token, because the route is authenticated', async () => {
    // Verified against the 12.4.0 server this is for: unauthenticated it is a
    // 401, so a probe without the header would make every connection look
    // like a failure and pin Auto to the fallback.
    let headers: HeadersInit | undefined
    vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
      headers = init?.headers
      return Promise.resolve(new Response(new ArrayBuffer(8), { status: 200 }))
    })
    await api.bitrateTest(8)
    expect(String((headers as Record<string, string>).Authorization)).toMatch(/Token="t"/)
  })

  it('throws on a server that has no such route, rather than timing a 404 page', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('nope', { status: 404 })))
    await expect(api.bitrateTest(500_000)).rejects.toThrow(/BitrateTest failed \(404\)/)
  })
})
