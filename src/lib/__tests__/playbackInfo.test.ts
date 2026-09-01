import { afterEach, describe, expect, it, vi } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })

/*
  The device profile probes codec support with a real <video>, which the node
  test environment has none of. Answering "no" to everything is fine here: the
  profile's contents are not what these tests are about.
*/
function stubDocument() {
  vi.stubGlobal('document', {
    createElement: () => ({ canPlayType: () => '' }),
  })
}

/** Records every PlaybackInfo body the api posts, and answers with a source. */
// `null`, not `undefined` — an undefined argument takes the default and the
// stub would answer with a source after all, quietly passing the one test that
// exists to prove the no-source path.
function stubFetch(sourceId: string | null = 'src-1') {
  stubDocument()
  const bodies: Record<string, unknown>[] = []
  vi.stubGlobal('fetch', (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? '{}')))
    return Promise.resolve(
      new Response(JSON.stringify({ MediaSources: sourceId ? [{ Id: sourceId }] : [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
  return bodies
}

afterEach(() => vi.unstubAllGlobals())

/*
  Regression, found against a real server on BoJack S3E1 — a file whose default
  audio is French. Asking for the English track came back as a TranscodingUrl
  carrying the *first* track's index, so the viewer got the language they were
  trying to leave. Nothing errored; the choice was silently dropped.

  Jellyfin only applies AudioStreamIndex and SubtitleStreamIndex when the same
  request names a MediaSourceId, and the id is only knowable from a reply.
*/
describe('playbackInfo pins the media source when a track is chosen', () => {
  it('asks again with the source id after choosing an audio track', async () => {
    const bodies = stubFetch()
    await api.playbackInfo('item-1', { audioStreamIndex: 2 })

    expect(bodies).toHaveLength(2)
    expect(bodies[0].MediaSourceId).toBeUndefined()
    expect(bodies[1]).toMatchObject({ MediaSourceId: 'src-1', AudioStreamIndex: 2 })
  })

  it('does the same for a burned-in subtitle', async () => {
    const bodies = stubFetch()
    await api.playbackInfo('item-1', { subtitleStreamIndex: 3 })
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toMatchObject({ MediaSourceId: 'src-1', SubtitleStreamIndex: 3 })
  })

  it('costs nothing on ordinary playback', async () => {
    // The common path by a wide margin. A second round trip before every
    // episode, to pin something nobody asked to change, would be pure delay.
    const bodies = stubFetch()
    await api.playbackInfo('item-1', {})
    expect(bodies).toHaveLength(1)
  })

  it('does not ask twice when the caller already pinned a source', async () => {
    const bodies = stubFetch()
    await api.playbackInfo('item-1', { audioStreamIndex: 2, mediaSourceId: 'chosen' })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ MediaSourceId: 'chosen', AudioStreamIndex: 2 })
  })

  it('still returns a plan when the server names no source', async () => {
    // Better the unpinned answer than no playback at all.
    const bodies = stubFetch(null)
    const res = await api.playbackInfo('item-1', { audioStreamIndex: 2 })
    expect(bodies).toHaveLength(1)
    expect(res).toBeTruthy()
  })

  it('keeps disabling direct play, which the pin does not replace', async () => {
    // Direct play serves the original file untouched, so the track choice is
    // ignored however the source is pinned. Both guards are needed.
    const bodies = stubFetch()
    await api.playbackInfo('item-1', { audioStreamIndex: 2 })
    expect(bodies[1].EnableDirectPlay).toBe(false)
    expect(bodies[1].EnableDirectStream).toBe(true)
  })
})
