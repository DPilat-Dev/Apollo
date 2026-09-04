import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 'tok' })

/** Records what was asked for, and answers with whatever the test needs. */
function stubFetch(reply: { status?: number; body?: string } = {}) {
  const calls: { url: string; init?: RequestInit }[] = []
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return Promise.resolve(
      new Response(reply.body ?? '', { status: reply.status ?? 200 }),
    )
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

/*
  The converted WebVTT the <track> element loads has had the [Script Info]
  header stripped, which is where the resolution the whole layout is measured
  against lives. libass needs the file itself.
*/
describe('assSubtitle', () => {
  it('fetches the raw file as text, authenticated by header', async () => {
    const calls = stubFetch({ body: '[Script Info]\n' })
    const text = await api.assSubtitle('item-1', 'src-1', 3)

    expect(text).toBe('[Script Info]\n')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('http://s/Videos/item-1/src-1/Subtitles/3/0/Stream.ass')
    // No api_key in the query: nothing here is loaded by an element that
    // cannot set headers, so the token stays out of the URL.
    expect(calls[0].url).not.toContain('api_key')
    const headers = calls[0].init?.headers as Record<string, string> | undefined
    expect(headers?.Authorization).toContain('Token="tok"')
  })

  it('throws on a refusal rather than handing back an error page', async () => {
    // A 404 body rendered as a subtitle file is a screenful of HTML over the
    // video. Failing here is what lets the caller fall back to <track>.
    stubFetch({ status: 404, body: 'Not Found' })
    await expect(api.assSubtitle('item-1', 'src-1', 3)).rejects.toThrow()
  })
})

describe('fallbackFonts', () => {
  it('lists the fonts the server keeps for subtitles', async () => {
    const calls = stubFetch({ body: JSON.stringify([{ Name: 'NotoSansJP-Regular.ttf' }]) })
    const fonts = await api.fallbackFonts()

    expect(fonts).toEqual([{ Name: 'NotoSansJP-Regular.ttf' }])
    expect(calls[0].url).toBe('http://s/FallbackFont/Fonts')
  })

  it('answers with nothing when the server has none configured', async () => {
    /*
      The fallback font folder is opt-in and most servers never set it, so an
      empty list — or a 404 from a server that does not know the endpoint — is
      an ordinary answer and must not stop subtitles from rendering.
    */
    stubFetch({ status: 404, body: '' })
    await expect(api.fallbackFonts()).resolves.toEqual([])
  })

  it('names a font with the token in the URL, because libass fetches it', async () => {
    // The font is fetched inside the WASM worker, which is handed a string and
    // no way to attach a header to it.
    const url = api.fallbackFontUrl('NotoSansJP-Regular.ttf')
    expect(url).toBe('http://s/FallbackFont/Fonts/NotoSansJP-Regular.ttf?api_key=tok')
  })
})
