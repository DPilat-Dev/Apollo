import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'

/**
 * Trailers come from two places and behave differently.
 *
 * A local trailer is a real media item on the server, so it plays in this
 * client's own player like anything else. A remote trailer is a URL — nearly
 * always YouTube — which has to be embedded or opened elsewhere.
 */

export interface RemoteTrailer {
  name: string
  /** The original URL, for opening externally. */
  url: string
  /** A privacy-preserving embed URL, when the host supports one. */
  embedUrl: string | null
}

/**
 * Pulls the video id out of the YouTube URL shapes Jellyfin's metadata
 * providers actually store: watch links, short links, and embeds, any of them
 * carrying playlist or timestamp parameters.
 */
export function youtubeId(rawUrl: string): string | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  const host = url.hostname.replace(/^www\./, '')
  const valid = (id: string | undefined | null) =>
    id && /^[\w-]{11}$/.test(id) ? id : null

  if (host === 'youtu.be') return valid(url.pathname.slice(1).split('/')[0])
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') return valid(url.searchParams.get('v'))
    const embedded = url.pathname.match(/^\/(?:embed|v|shorts)\/([^/?]+)/)
    if (embedded) return valid(embedded[1])
  }
  return null
}

/**
 * Builds the embed URL.
 *
 * youtube-nocookie.com is used deliberately: it is the same player without the
 * tracking cookies, and a trailer is not worth handing someone's viewing to a
 * third party. `rel=0` keeps the end screen to the same channel rather than
 * recommending whatever YouTube likes.
 */
export function youtubeEmbedUrl(rawUrl: string, autoplay = true): string | null {
  const id = youtubeId(rawUrl)
  if (!id) return null
  const params = new URLSearchParams({ rel: '0', modestbranding: '1' })
  if (autoplay) params.set('autoplay', '1')
  return `https://www.youtube-nocookie.com/embed/${id}?${params}`
}

/** Normalises the item's remote trailers, dropping anything unusable. */
export function remoteTrailers(item: BaseItemDto | undefined | null): RemoteTrailer[] {
  const raw = item?.RemoteTrailers ?? []
  const seen = new Set<string>()
  const out: RemoteTrailer[] = []

  for (const entry of raw) {
    const url = entry?.Url?.trim()
    if (!url) continue
    // Providers sometimes list the same trailer more than once.
    const key = youtubeId(url) ?? url
    if (seen.has(key)) continue

    // Only http(s) — a metadata field is untrusted input, and javascript: in
    // an href would run on click.
    let scheme: string
    try {
      scheme = new URL(url).protocol
    } catch {
      continue
    }
    if (scheme !== 'http:' && scheme !== 'https:') continue

    seen.add(key)
    out.push({
      name: entry.Name?.trim() || 'Trailer',
      url,
      embedUrl: youtubeEmbedUrl(url),
    })
  }
  return out
}

/** Whether anything is worth showing a trailer button for. */
export function hasTrailer(item: BaseItemDto | undefined | null, localCount = 0): boolean {
  return localCount > 0 || remoteTrailers(item).length > 0
}
