import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'me', userName: 'D', token: 't' })

interface Sent {
  url: string
  method?: string
  headers: Record<string, string>
  body: unknown
}

function stubFetch() {
  const sent: Sent[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    sent.push({
      url: String(url),
      method: init?.method,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body,
    })
    return Promise.resolve(new Response(null, { status: 204 }))
  })
  return sent
}

afterEach(() => vi.unstubAllGlobals())

const png = () => new Blob(['not really a png'], { type: 'image/png' })

describe('uploadUserImage', () => {
  /*
    Jellyfin wants the bytes themselves under an image/* content type. The
    request helper labels anything with a body as application/json, which the
    server accepts happily enough to store — and what comes back out is a
    broken image with no error anywhere to explain it.
  */
  it('posts the raw bytes under the image’s own content type', async () => {
    const sent = stubFetch()
    await api.uploadUserImage({ isAdmin: false, userId: 'me', blob: png(), contentType: 'image/png' })

    expect(sent).toHaveLength(1)
    expect(sent[0].method).toBe('POST')
    expect(new URL(sent[0].url).pathname).toBe('/UserImage')
    expect(new URL(sent[0].url).searchParams.get('userId')).toBe('me')
    expect(sent[0].headers['Content-Type']).toBe('image/png')
    expect(sent[0].body).toBeInstanceOf(Blob)
  })

  it('lets an administrator set someone else’s', async () => {
    const sent = stubFetch()
    await api.uploadUserImage({
      isAdmin: true,
      userId: 'other',
      blob: png(),
      contentType: 'image/png',
    })
    expect(new URL(sent[0].url).searchParams.get('userId')).toBe('other')
  })

  // Refused here rather than sent and left to the server to reject, so an
  // upload that should never have been offered cannot be what discovers it.
  it('sends nothing when a viewer aims at another account', async () => {
    const sent = stubFetch()
    await expect(
      api.uploadUserImage({
        isAdmin: false,
        userId: 'other',
        blob: png(),
        contentType: 'image/png',
      }),
    ).rejects.toThrow(/administrator/i)
    expect(sent).toHaveLength(0)
  })
})

describe('deleteUserImage', () => {
  it('deletes by user id in the query', async () => {
    const sent = stubFetch()
    await api.deleteUserImage({ isAdmin: false, userId: 'me' })
    expect(sent[0].method).toBe('DELETE')
    expect(new URL(sent[0].url).pathname).toBe('/UserImage')
    expect(new URL(sent[0].url).searchParams.get('userId')).toBe('me')
  })

  it('sends nothing when a viewer aims at another account', async () => {
    const sent = stubFetch()
    await expect(api.deleteUserImage({ isAdmin: false, userId: 'other' })).rejects.toThrow(
      /administrator/i,
    )
    expect(sent).toHaveLength(0)
  })
})
