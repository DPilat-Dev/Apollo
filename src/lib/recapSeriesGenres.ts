import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'

/**
 * Giving an episode the genres of the show it belongs to.
 *
 * The recap counts genres from what was played, and what was played is mostly
 * episodes. Jellyfin does not copy a show's genres onto them — not all of them,
 * and not consistently. One episode of Hunter x Hunter carries:
 *
 *     ["Animation", "Action", "Adventure"]
 *
 * while the series it belongs to carries:
 *
 *     ["Action", "Adventure", "Animation", "Anime", "Comedy", "Drama", "Fantasy"]
 *
 * `Anime` is on the show and nowhere else, so a year of anime counted zero of
 * it. Worse than the missing label: of 400 episodes sampled from a real
 * library, exactly one carried `Animation` and none carried anything else, so
 * the top-genres panel was describing whichever handful of episodes happened to
 * have been tagged rather than the year.
 *
 * The fix is to ask for the shows once and read their genres, which is one
 * request for the whole year — there are far fewer shows than episodes.
 */

/** The distinct shows behind a year's items, for one lookup. */
export function seriesIdsFrom(items: readonly BaseItemDto[]): string[] {
  const ids = new Set<string>()
  for (const item of items) {
    if (item.Type === 'Episode' && item.SeriesId) ids.add(item.SeriesId)
  }
  return [...ids]
}

/**
 * A URL can only be so long, and these are 32 characters each.
 *
 * Fifty is roughly 1,700 characters of ids, comfortably inside every limit
 * that matters, and a year with more than fifty shows in it is rare enough
 * that two requests is not worth avoiding.
 */
export const SERIES_LOOKUP_CHUNK = 50

export function chunkIds(ids: readonly string[], size = SERIES_LOOKUP_CHUNK): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
  return out
}

/** Genres by series id, from whatever the lookup returned. */
export function genresBySeries(series: readonly BaseItemDto[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const item of series) {
    if (item.Id && item.Genres?.length) map.set(item.Id, item.Genres)
  }
  return map
}

/**
 * The same items, with each episode also carrying its show's genres.
 *
 * A union, not a replacement: an episode occasionally carries something its
 * show does not, and losing that would be trading one gap for another. Items
 * that are not episodes, and episodes whose show was not found, come back
 * untouched — and untouched means the *same object*, so nothing downstream
 * re-renders for an item that did not change.
 */
export function withSeriesGenres(
  items: readonly BaseItemDto[],
  bySeries: Map<string, string[]>,
): BaseItemDto[] {
  if (bySeries.size === 0) return items as BaseItemDto[]
  return items.map((item) => {
    if (item.Type !== 'Episode' || !item.SeriesId) return item
    const fromSeries = bySeries.get(item.SeriesId)
    if (!fromSeries?.length) return item

    const own = item.Genres ?? []
    const merged = [...own]
    // Case-insensitively, because "Sci-Fi" on a show and "Sci-Fi" on an episode
    // are the same genre and two spellings of it would be counted twice.
    const seen = new Set(own.map((g) => g.toLowerCase()))
    for (const genre of fromSeries) {
      if (seen.has(genre.toLowerCase())) continue
      seen.add(genre.toLowerCase())
      merged.push(genre)
    }
    return merged.length === own.length ? item : { ...item, Genres: merged }
  })
}
