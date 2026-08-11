import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { hasTrailer, remoteTrailers, youtubeEmbedUrl, youtubeId } from '../trailers'

const item = (urls: { Url?: string; Name?: string }[]) =>
  ({ Id: 'i1', RemoteTrailers: urls }) as unknown as BaseItemDto

describe('youtubeId', () => {
  it('reads the shapes metadata providers actually store', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
    expect(youtubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ')
  })

  it('ignores extra parameters rather than folding them into the id', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1&t=42s')).toBe(
      'dQw4w9WgXcQ',
    )
    expect(youtubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ')
  })

  it('rejects non-YouTube and malformed URLs', () => {
    expect(youtubeId('https://vimeo.com/12345')).toBeNull()
    expect(youtubeId('not a url')).toBeNull()
    expect(youtubeId('')).toBeNull()
  })

  /** An id is exactly 11 characters; anything else is a path we misread. */
  it('rejects an id of the wrong shape', () => {
    expect(youtubeId('https://www.youtube.com/watch?v=short')).toBeNull()
    expect(youtubeId('https://www.youtube.com/results?search_query=x')).toBeNull()
  })

  it('is not fooled by a lookalike hostname', () => {
    expect(youtubeId('https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ')).toBeNull()
  })
})

describe('youtubeEmbedUrl', () => {
  it('embeds through the no-cookie host', () => {
    const url = youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ')!
    expect(url.startsWith('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?')).toBe(true)
    expect(new URL(url).searchParams.get('autoplay')).toBe('1')
    expect(new URL(url).searchParams.get('rel')).toBe('0')
  })

  it('can omit autoplay', () => {
    expect(new URL(youtubeEmbedUrl('https://youtu.be/dQw4w9WgXcQ', false)!)
      .searchParams.get('autoplay')).toBeNull()
  })

  it('returns null for something it cannot embed', () => {
    expect(youtubeEmbedUrl('https://vimeo.com/12345')).toBeNull()
  })
})

describe('remoteTrailers', () => {
  it('keeps the name and offers an embed for YouTube', () => {
    const [t] = remoteTrailers(item([{ Url: 'https://youtu.be/dQw4w9WgXcQ', Name: 'Official' }]))
    expect(t.name).toBe('Official')
    expect(t.embedUrl).toContain('youtube-nocookie.com')
  })

  it('keeps a non-embeddable trailer, with no embed URL', () => {
    const [t] = remoteTrailers(item([{ Url: 'https://vimeo.com/12345' }]))
    expect(t.url).toBe('https://vimeo.com/12345')
    expect(t.embedUrl).toBeNull()
    expect(t.name).toBe('Trailer')
  })

  it('de-duplicates the same video listed under different URL shapes', () => {
    expect(
      remoteTrailers(
        item([
          { Url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
          { Url: 'https://youtu.be/dQw4w9WgXcQ' },
        ]),
      ),
    ).toHaveLength(1)
  })

  /**
   * Metadata is untrusted input. A javascript: URL placed in an href would run
   * when someone clicked the trailer.
   */
  it('drops anything that is not http(s)', () => {
    expect(
      remoteTrailers(
        item([
          { Url: 'javascript:alert(1)' },
          { Url: 'data:text/html,<script>alert(1)</script>' },
          { Url: 'file:///etc/passwd' },
        ]),
      ),
    ).toEqual([])
  })

  it('copes with empty and missing values', () => {
    expect(remoteTrailers(item([{ Url: '' }, {}]))).toEqual([])
    expect(remoteTrailers(undefined)).toEqual([])
    expect(remoteTrailers({ Id: 'i1' } as BaseItemDto)).toEqual([])
  })
})

describe('hasTrailer', () => {
  it('is true for a local trailer even with no remote ones', () => {
    expect(hasTrailer({ Id: 'i1' } as BaseItemDto, 1)).toBe(true)
  })

  it('is true for a remote trailer with no local files', () => {
    expect(hasTrailer(item([{ Url: 'https://youtu.be/dQw4w9WgXcQ' }]), 0)).toBe(true)
  })

  it('is false when there is nothing to play', () => {
    expect(hasTrailer({ Id: 'i1' } as BaseItemDto, 0)).toBe(false)
    expect(hasTrailer(item([{ Url: 'javascript:alert(1)' }]), 0)).toBe(false)
  })
})
