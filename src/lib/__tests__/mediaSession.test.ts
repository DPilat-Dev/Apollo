import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { artworkSizes, mediaMetadata, positionState } from '../mediaSession'
import { JellyfinApi, scaleForDisplay } from '../api'

const episode = {
  Type: 'Episode',
  Name: 'The Constant',
  SeriesName: 'Lost',
  SeasonName: 'Season 4',
  ParentIndexNumber: 4,
  IndexNumber: 5,
} as unknown as BaseItemDto

describe('mediaMetadata', () => {
  /*
    The series is the recognisable name, and OS widgets render the "artist"
    line largest. Putting the episode title there instead leaves a lock screen
    reading "The Constant" with no clue what it belongs to.
  */
  it('gives an episode the series as its artist', () => {
    const meta = mediaMetadata(episode)
    expect(meta.title).toBe('The Constant')
    expect(meta.artist).toBe('Lost')
    expect(meta.album).toBe('Season 4 · S4:E5')
  })

  it('falls back to the year for a film, rather than an empty line', () => {
    const movie = { Type: 'Movie', Name: 'Heat', ProductionYear: 1995 } as BaseItemDto
    const meta = mediaMetadata(movie)
    expect(meta.title).toBe('Heat')
    expect(meta.artist).toBe('1995')
  })

  it('never yields undefined fields, which MediaMetadata renders as "undefined"', () => {
    const bare = { Type: 'Movie' } as BaseItemDto
    const meta = mediaMetadata(bare)
    expect(meta.title).toBe('Untitled')
    expect(meta.artist).toBe('')
    expect(meta.album).toBe('')
    expect(meta.artwork).toEqual([])
  })
})

describe('positionState', () => {
  /*
    Every case here throws a TypeError if passed to setPositionState, and that
    throw happens inside a timeupdate handler — it would take the player's own
    clock with it.
  */
  it('says nothing while the duration is still unknown', () => {
    expect(positionState(NaN, 10, 1)).toBeNull()
    expect(positionState(Infinity, 10, 1)).toBeNull()
    expect(positionState(0, 0, 1)).toBeNull()
    expect(positionState(-5, 0, 1)).toBeNull()
  })

  /*
    Regression: absoluteTime is measured against the file while
    absoluteDuration comes from the server's RunTimeTicks. They disagree by a
    second or two at the end of most episodes, so this is reached every time
    anything plays to the credits — not an edge case.
  */
  it('clamps a position that has run past the reported duration', () => {
    expect(positionState(100, 101.4, 1)?.position).toBe(100)
  })

  it('clamps a negative position', () => {
    expect(positionState(100, -3, 1)?.position).toBe(0)
  })

  it('substitutes a usable rate for the zero a paused video reports', () => {
    expect(positionState(100, 10, 0)?.playbackRate).toBe(1)
    expect(positionState(100, 10, NaN)?.playbackRate).toBe(1)
    expect(positionState(100, 10, -1)?.playbackRate).toBe(1)
  })

  it('passes a real rate through', () => {
    expect(positionState(100, 10, 1.5)).toEqual({
      duration: 100,
      position: 10,
      playbackRate: 1.5,
    })
  })
})

describe('artworkSizes', () => {
  it('declares the requested size when the source honours it exactly', () => {
    expect(artworkSizes((edge) => `/img?w=${edge}`, undefined, [96, 512])).toEqual([
      { src: '/img?w=96', sizes: '96x96' },
      { src: '/img?w=512', sizes: '512x512' },
    ])
  })

  /*
    Regression: the lock-screen artwork went missing on phones. Jellyfin image
    URLs are scaled by device pixel ratio and snapped to a bucket, so asking for
    512 delivers 1280 on a handset — while `sizes` still claimed 512. Every
    candidate was understated, worst on the small screens that ask for the
    largest one.
  */
  it('declares what the source will actually deliver, not what was asked', () => {
    const doubled = (edge: number) => edge * 2
    expect(artworkSizes((edge) => `/img?w=${edge}`, doubled, [256])).toEqual([
      { src: '/img?w=256', sizes: '512x512' },
    ])
  })

  it('keeps the declaration square even after resolving', () => {
    const [only] = artworkSizes((edge) => `/img?w=${edge}`, () => 1280, [512])
    const [w, h] = only.sizes.split('x')
    expect(w).toBe(h)
  })

  it('drops sizes with no image rather than emitting a null src', () => {
    expect(artworkSizes(() => null)).toEqual([])
  })
})

/**
 * The end-to-end invariant: what `sizes` claims must equal what the URL asks
 * the server for. Both halves derive from `scaleForDisplay`, and this is what
 * fails if either side stops going through it.
 */
describe('declared artwork size matches the URL', () => {
  const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })
  const movie = { Id: 'm1', Type: 'Movie', ImageTags: { Primary: 'pt' } } as unknown as BaseItemDto

  it('agrees with fillWidth and fillHeight at every offered size', () => {
    const art = artworkSizes((edge) => api.coverUrl(movie, edge, edge), scaleForDisplay)
    expect(art).toHaveLength(3)
    for (const a of art) {
      const url = new URL(a.src)
      const [w, h] = a.sizes.split('x')
      expect(url.searchParams.get('fillWidth')).toBe(w)
      expect(url.searchParams.get('fillHeight')).toBe(h)
    }
  })

  it('bucketing means the declaration is not simply the requested edge', () => {
    const [smallest] = artworkSizes((edge) => api.coverUrl(movie, edge, edge), scaleForDisplay)
    // 96 snaps up to the smallest bucket, 160. Declaring 96 would understate it.
    expect(smallest.sizes).toBe('160x160')
  })
})
