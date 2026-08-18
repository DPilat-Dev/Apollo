import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({
  server: 'http://s',
  userId: 'u',
  userName: 'D',
  token: 't',
})

const at = (url: string | null) => {
  if (!url) return null
  const u = new URL(url)
  return `${u.pathname}?tag=${u.searchParams.get('tag')}`
}

/**
 * Regression: landscape cards checked Backdrop first and never looked at Thumb
 * or SeriesThumbImageTag, so shows displayed generic scenery where the official
 * client shows the curated 16:9 art a library actually sets.
 */
describe('backdropUrl precedence', () => {
  it('prefers the item’s own Thumb over its Backdrop', () => {
    const item = {
      Id: 'i1',
      ImageTags: { Thumb: 'tt' },
      BackdropImageTags: ['bb'],
    } as unknown as BaseItemDto
    expect(at(api.backdropUrl(item))).toBe('/Items/i1/Images/Thumb?tag=tt')
  })

  it('inherits the series Thumb before falling back to any Backdrop', () => {
    const episode = {
      Id: 'e1',
      Type: 'Episode',
      SeriesId: 'sr1',
      SeriesThumbImageTag: 'st',
      ParentBackdropItemId: 'sr1',
      ParentBackdropImageTags: ['pb'],
      ImageTags: {},
    } as unknown as BaseItemDto
    expect(at(api.backdropUrl(episode))).toBe('/Items/sr1/Images/Thumb?tag=st')
  })

  it('uses the parent Thumb when there is no series one', () => {
    const item = {
      Id: 'i1',
      ParentThumbItemId: 'p1',
      ParentThumbImageTag: 'pt',
      BackdropImageTags: ['bb'],
      ImageTags: {},
    } as unknown as BaseItemDto
    expect(at(api.backdropUrl(item))).toBe('/Items/p1/Images/Thumb?tag=pt')
  })

  it('falls through Backdrop, then the parent’s', () => {
    const own = { Id: 'i1', ImageTags: {}, BackdropImageTags: ['bb'] } as unknown as BaseItemDto
    expect(at(api.backdropUrl(own))).toBe('/Items/i1/Images/Backdrop?tag=bb')

    const inherited = {
      Id: 'i1',
      ImageTags: {},
      ParentBackdropItemId: 'p1',
      ParentBackdropImageTags: ['pb'],
    } as unknown as BaseItemDto
    expect(at(api.backdropUrl(inherited))).toBe('/Items/p1/Images/Backdrop?tag=pb')
  })

  it('uses an episode’s own screenshot as the last resort', () => {
    const episode = {
      Id: 'e1',
      Type: 'Episode',
      ImageTags: { Primary: 'pp' },
    } as unknown as BaseItemDto
    expect(at(api.backdropUrl(episode))).toBe('/Items/e1/Images/Primary?tag=pp')
  })

  it('gives the hero scenery, not title-card Thumb art', () => {
    const series = {
      Id: 's1',
      ImageTags: { Thumb: 'tt' },
      BackdropImageTags: ['bb'],
    } as unknown as BaseItemDto
    expect(at(api.heroBackdropUrl(series))).toBe('/Items/s1/Images/Backdrop?tag=bb')
  })

  it('lets the hero fall back to Thumb when there is no Backdrop at all', () => {
    const series = { Id: 's1', ImageTags: { Thumb: 'tt' } } as unknown as BaseItemDto
    expect(at(api.heroBackdropUrl(series))).toBe('/Items/s1/Images/Thumb?tag=tt')
  })
})

/**
 * The official client multiplies requested dimensions by devicePixelRatio.
 * Without that, every image on a HiDPI screen is upscaled from a source half
 * the resolution it needed — the single biggest reason artwork looked softer
 * here than in Jellyfin's own web client.
 */
describe('request parameters', () => {
  const params = (url: string | null) => Object.fromEntries(new URL(url!).searchParams)

  // Tests run in Node, where there is no window; stub one rather than pull in
  // a whole DOM implementation for two assertions.
  const withPixelRatio = <T,>(ratio: number, fn: () => T): T => {
    const globals = globalThis as { window?: { devicePixelRatio: number } }
    const original = globals.window
    globals.window = { devicePixelRatio: ratio }
    try {
      return fn()
    } finally {
      globals.window = original
    }
  }

  it('asks for quality 96, matching the official client', () => {
    const item = { Id: 'i1', ImageTags: { Primary: 'p' } } as unknown as BaseItemDto
    expect(params(api.posterUrl(item, 200)).quality).toBe('96')
  })

  it('scales the request by device pixel ratio', () => {
    const item = { Id: 'i1', ImageTags: { Primary: 'p' } } as unknown as BaseItemDto
    const at1x = Number(params(withPixelRatio(1, () => api.posterUrl(item, 200))).fillWidth)
    const at2x = Number(params(withPixelRatio(2, () => api.posterUrl(item, 200))).fillWidth)
    expect(at2x).toBeGreaterThan(at1x)
  })

  it('snaps widths to buckets so the server can cache resizes', () => {
    const item = { Id: 'i1', ImageTags: { Primary: 'p' } } as unknown as BaseItemDto
    const widths = [181, 184, 190, 200].map((w) => params(api.posterUrl(item, w)).fillWidth)
    expect(new Set(widths).size).toBe(1)
  })

  it('caps the ratio so a 3x phone cannot demand an enormous image', () => {
    const item = { Id: 'i1', ImageTags: { Primary: 'p' } } as unknown as BaseItemDto
    const at2x = Number(params(withPixelRatio(2, () => api.posterUrl(item, 400))).fillWidth)
    const at3x = Number(params(withPixelRatio(3, () => api.posterUrl(item, 400))).fillWidth)
    expect(at3x).toBe(at2x)
  })
})

/**
 * Regression: after landscape cards were changed to prefer Thumb (so a row of
 * cards shows recognisable series art), episode list rows inherited the same
 * rule — and every episode in a season rendered the identical series image.
 *
 * The official client draws the same distinction: its list view reads
 * ImageTags.Primary before anything inherited.
 */
describe('stillUrl — one row per episode', () => {
  const episode = (over: Record<string, unknown> = {}) =>
    ({
      Id: 'e1',
      Type: 'Episode',
      SeriesId: 'sr1',
      SeriesThumbImageTag: 'series-thumb',
      SeriesPrimaryImageTag: 'series-poster',
      ParentBackdropItemId: 'sr1',
      ParentBackdropImageTags: ['series-backdrop'],
      ImageTags: {},
      ...over,
    }) as unknown as BaseItemDto

  it('uses the episode’s own screenshot ahead of any series art', () => {
    expect(at(api.stillUrl(episode({ ImageTags: { Primary: 'still' } })))).toBe(
      '/Items/e1/Images/Primary?tag=still',
    )
  })

  it('gives different episodes different images', () => {
    const a = api.stillUrl(episode({ Id: 'e1', ImageTags: { Primary: 'still-1' } }))
    const b = api.stillUrl(episode({ Id: 'e2', ImageTags: { Primary: 'still-2' } }))
    expect(a).not.toBe(b)
  })

  it('only inherits series art when the episode has none of its own', () => {
    expect(at(api.stillUrl(episode()))).toBe('/Items/sr1/Images/Thumb?tag=series-thumb')
  })

  it('still prefers series Thumb for a card, which is the opposite rule', () => {
    const withStill = episode({ ImageTags: { Primary: 'still' } })
    expect(at(api.backdropUrl(withStill))).toBe('/Items/sr1/Images/Thumb?tag=series-thumb')
    expect(at(api.stillUrl(withStill))).toBe('/Items/e1/Images/Primary?tag=still')
  })
})

/**
 * OS media artwork declares a `sizes` of NxN, and widgets lay out against that
 * number rather than the pixels they get back. A 2:3 poster returned for a
 * square declaration comes out stretched, so the request has to crop.
 */
describe('square artwork', () => {
  it('asks the server to crop to both edges, not just scale a width', () => {
    const item = { Id: 'i1', ImageTags: { Primary: 'pt' } } as unknown as BaseItemDto
    const url = new URL(api.posterUrl(item, 256, 256)!)
    expect(url.searchParams.get('fillWidth')).toBe(url.searchParams.get('fillHeight'))
    expect(url.searchParams.get('fillHeight')).not.toBeNull()
  })

  it('still crops when the art is inherited from the series', () => {
    const ep = {
      Id: 'e1',
      Type: 'Episode',
      SeriesId: 'sr1',
      SeriesPrimaryImageTag: 'sp',
      ImageTags: {},
    } as unknown as BaseItemDto
    const url = new URL(api.posterUrl(ep, 256, 256)!)
    expect(url.pathname).toBe('/Items/sr1/Images/Primary')
    expect(url.searchParams.get('fillWidth')).toBe(url.searchParams.get('fillHeight'))
  })

  it('leaves the poster shape alone when no height is asked for', () => {
    const item = { Id: 'i1', ImageTags: { Primary: 'pt' } } as unknown as BaseItemDto
    const url = new URL(api.posterUrl(item, 256)!)
    expect(url.searchParams.get('fillHeight')).toBeNull()
  })
})

/**
 * Regression: the player's poster and the OS lock-screen artwork both showed a
 * screenshot of the episode instead of the show's cover. `posterUrl` prefers an
 * item's own Primary image, and an episode's Primary *is* its screenshot, so it
 * only ever reached the series art for episodes that had no image of their own.
 */
describe('coverUrl', () => {
  const episode = {
    Id: 'e1',
    Type: 'Episode',
    ImageTags: { Primary: 'episode-still' },
    SeriesId: 'sr1',
    SeriesPrimaryImageTag: 'series-poster',
  } as unknown as BaseItemDto

  it('takes the series poster over the episode’s own screenshot', () => {
    expect(at(api.coverUrl(episode))).toBe('/Items/sr1/Images/Primary?tag=series-poster')
  })

  it('is the opposite of posterUrl, which keeps preferring the screenshot', () => {
    expect(at(api.posterUrl(episode))).toBe('/Items/e1/Images/Primary?tag=episode-still')
  })

  it('falls back to the episode’s own image when the series has no poster', () => {
    const orphan = { ...episode, SeriesPrimaryImageTag: undefined } as BaseItemDto
    expect(at(api.coverUrl(orphan))).toBe('/Items/e1/Images/Primary?tag=episode-still')
  })

  it('leaves a film alone — its Primary already is the cover', () => {
    const movie = {
      Id: 'm1',
      Type: 'Movie',
      ImageTags: { Primary: 'mp' },
    } as unknown as BaseItemDto
    expect(at(api.coverUrl(movie))).toBe('/Items/m1/Images/Primary?tag=mp')
  })

  it('still crops square when both edges are asked for', () => {
    const url = new URL(api.coverUrl(episode, 256, 256)!)
    expect(url.searchParams.get('fillWidth')).toBe(url.searchParams.get('fillHeight'))
  })
})
