/**
 * Choosing artwork from what the metadata providers hold.
 *
 * A scan takes whatever poster came back first, and for a film with a dozen
 * regional variants that is frequently the ugly one. /Items/{id}/RemoteImages
 * lists the alternatives — but a well-known title has hundreds of backdrops on
 * TMDb alone, and the naive dialog fetches every one of them at full size and
 * stalls the tab before it draws.
 *
 * So the window is paged by the server and drawn from provider thumbnails.
 * Both of those decisions live here, where the awkward cases — a page number
 * left pointing past the end of a shorter list, an entry with no thumbnail —
 * can be checked without a browser and without a provider.
 */

/** The image kinds worth offering. Jellyfin knows a dozen; a viewer sees three. */
export const ARTWORK_KINDS = [
  { type: 'Primary', label: 'Poster' },
  { type: 'Backdrop', label: 'Backdrop' },
  { type: 'Logo', label: 'Logo' },
] as const

export type ArtworkKind = (typeof ARTWORK_KINDS)[number]['type']

/**
 * Two dozen. Enough to fill the dialog and scroll a little, few enough that
 * the thumbnails behind it are a page load rather than a download.
 */
export const ARTWORK_PAGE_SIZE = 24

interface ItemLike {
  Id?: string | null
}

/**
 * Whether to offer the artwork picker.
 *
 * Same gate as Identify, and it exists for the same reason: downloading an
 * image is an elevated call, and this control sits on the page every viewer
 * opens rather than behind the /admin route.
 */
export function canEditArtwork(input: { isAdmin: boolean; item: ItemLike }): boolean {
  return Boolean(input.isAdmin && input.item.Id)
}

/** The startIndex/limit window to request for a page, counting from zero. */
export function artworkPageRequest(page: number): { startIndex: number; limit: number } {
  return { startIndex: Math.max(0, Math.floor(page)) * ARTWORK_PAGE_SIZE, limit: ARTWORK_PAGE_SIZE }
}

export interface ArtworkPaging {
  /** The page actually being shown, which is not always the one asked for. */
  page: number
  pageCount: number
  hasPrev: boolean
  hasNext: boolean
  /** One-based, for a "25–48 of 312" line. */
  from: number
  to: number
}

/**
 * Where the current page sits in the whole list.
 *
 * The clamp is the point. Switching from Backdrop, which has hundreds, to Logo,
 * which has four, while sitting on page five leaves the page number pointing
 * past the end — and without snapping it back the picker settles on an empty
 * grid with a Previous button that walks through more empty grids.
 */
export function artworkPaging(total: number | undefined, requestedPage: number): ArtworkPaging {
  const count = Math.max(0, total ?? 0)
  const pageCount = Math.ceil(count / ARTWORK_PAGE_SIZE)
  const page = Math.min(Math.max(0, Math.floor(requestedPage)), Math.max(0, pageCount - 1))
  const start = page * ARTWORK_PAGE_SIZE

  return {
    page,
    pageCount,
    hasPrev: page > 0,
    hasNext: page + 1 < pageCount,
    from: count === 0 ? 0 : start + 1,
    to: Math.min(start + ARTWORK_PAGE_SIZE, count),
  }
}

interface RemoteImageLike {
  Url?: string | null
  ThumbnailUrl?: string | null
  Width?: number | null
  Height?: number | null
  Language?: string | null
  CommunityRating?: number | null
}

/**
 * What to put in the grid's <img src>.
 *
 * Never `Url`. That is the provider's original — on TMDb a 2000px-wide poster
 * — and two dozen of those is the difference between a dialog that opens and
 * one that spends forty megabytes before it shows anything. `Url` is still
 * what gets downloaded; it is only the preview that is small.
 */
export function artworkThumbnail(image: RemoteImageLike): string | null {
  return image.ThumbnailUrl || image.Url || null
}

/**
 * The line under a thumbnail — dimensions, language, rating.
 *
 * "No language" rather than a blank: providers mark a textless poster by
 * leaving the language off, and a textless poster is the one worth having in a
 * library browsed in more than one language. An empty gap would read as
 * missing data instead of as the answer.
 */
export function artworkSummary(image: RemoteImageLike): string {
  const parts: string[] = []
  if (image.Width && image.Height) parts.push(`${image.Width} × ${image.Height}`)
  parts.push(image.Language || 'No language')
  if (image.CommunityRating) parts.push(image.CommunityRating.toFixed(1))
  return parts.join(' · ')
}
