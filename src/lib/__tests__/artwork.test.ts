import { describe, expect, it } from 'vitest'
import {
  ARTWORK_PAGE_SIZE,
  artworkPageRequest,
  artworkPaging,
  artworkSummary,
  artworkThumbnail,
  canEditArtwork,
} from '../artwork'

describe('canEditArtwork', () => {
  it('offers the control to an admin', () => {
    expect(canEditArtwork({ isAdmin: true, item: { Id: 'abc' } })).toBe(true)
  })

  /*
    Same gate as Identify, and for the same reason: this sits on the item page
    every viewer opens, not behind the /admin route.
  */
  it('offers nothing to an ordinary viewer', () => {
    expect(canEditArtwork({ isAdmin: false, item: { Id: 'abc' } })).toBe(false)
  })

  it('needs an id to download against', () => {
    expect(canEditArtwork({ isAdmin: true, item: {} })).toBe(false)
  })
})

/*
  A well-known film has hundreds of backdrops on TMDb alone. Asking for all of
  them and rendering the lot is a dialog that spends tens of megabytes before
  it draws — so the window is asked for one page at a time, by the server,
  rather than fetched whole and sliced here.
*/
describe('artworkPageRequest', () => {
  it('asks for one page from the top', () => {
    expect(artworkPageRequest(0)).toEqual({ startIndex: 0, limit: ARTWORK_PAGE_SIZE })
  })

  it('walks forward by whole pages', () => {
    expect(artworkPageRequest(2)).toEqual({
      startIndex: ARTWORK_PAGE_SIZE * 2,
      limit: ARTWORK_PAGE_SIZE,
    })
  })

  it('never asks for a negative offset', () => {
    expect(artworkPageRequest(-3)).toEqual({ startIndex: 0, limit: ARTWORK_PAGE_SIZE })
  })
})

describe('artworkPaging', () => {
  it('counts pages from the server total, not from what arrived', () => {
    const p = artworkPaging(200, 0)
    expect(p.pageCount).toBe(Math.ceil(200 / ARTWORK_PAGE_SIZE))
    expect(p.hasNext).toBe(true)
    expect(p.hasPrev).toBe(false)
  })

  it('describes the window in the numbers a human counts from', () => {
    const p = artworkPaging(200, 1)
    expect(p.from).toBe(ARTWORK_PAGE_SIZE + 1)
    expect(p.to).toBe(ARTWORK_PAGE_SIZE * 2)
  })

  it('stops the last page short of the total', () => {
    const p = artworkPaging(ARTWORK_PAGE_SIZE + 3, 1)
    expect(p.to).toBe(ARTWORK_PAGE_SIZE + 3)
    expect(p.hasNext).toBe(false)
  })

  /*
    Switching from Backdrop (hundreds) to Logo (a handful) while on page five
    leaves the page number pointing past the end. Clamping here is what stops
    the picker from settling on a permanently empty grid with a dead Previous
    button.
  */
  it('clamps a page that no longer exists', () => {
    expect(artworkPaging(10, 5).page).toBe(0)
    expect(artworkPaging(ARTWORK_PAGE_SIZE * 3, 9).page).toBe(2)
  })

  it('has no pages at all when the providers returned nothing', () => {
    const p = artworkPaging(0, 0)
    expect(p.pageCount).toBe(0)
    expect(p.hasNext).toBe(false)
    expect(p.hasPrev).toBe(false)
  })

  it('treats a missing total as nothing rather than guessing', () => {
    expect(artworkPaging(undefined, 0).pageCount).toBe(0)
  })
})

/*
  ThumbnailUrl is the provider's small copy; Url is the original — on TMDb a
  2000px-wide poster. A grid of two dozen originals is the difference between
  a dialog that opens and one that stalls the tab.
*/
describe('artworkThumbnail', () => {
  it('prefers the small copy the provider offers', () => {
    expect(artworkThumbnail({ Url: 'https://p/full.jpg', ThumbnailUrl: 'https://p/thumb.jpg' })).toBe(
      'https://p/thumb.jpg',
    )
  })

  it('falls back to the full image when there is no thumbnail', () => {
    expect(artworkThumbnail({ Url: 'https://p/full.jpg' })).toBe('https://p/full.jpg')
  })

  it('has nothing to show for an entry with no url at all', () => {
    expect(artworkThumbnail({})).toBeNull()
    expect(artworkThumbnail({ ThumbnailUrl: '' })).toBeNull()
  })
})

describe('artworkSummary', () => {
  it('reads out the facts a chooser compares on', () => {
    expect(
      artworkSummary({ Width: 1000, Height: 1500, Language: 'en', CommunityRating: 8.42 }),
    ).toBe('1000 × 1500 · en · 8.4')
  })

  it('skips dimensions and rating the provider left blank', () => {
    expect(artworkSummary({ Language: 'de' })).toBe('de')
    expect(artworkSummary({ Width: 1000, Height: 1500 })).toBe('1000 × 1500 · No language')
  })

  /*
    Language is the one fact always worth a word, because its absence is the
    interesting case: a language-neutral poster is the textless one, which is
    what a library browsed in several languages wants. A blank where the
    language goes would read as missing data rather than as the answer.
  */
  it('says so when an image carries no language', () => {
    expect(artworkSummary({})).toBe('No language')
    expect(artworkSummary({ Width: 1000, Height: 1500, CommunityRating: 8.42 })).toBe(
      '1000 × 1500 · No language · 8.4',
    )
  })
})
