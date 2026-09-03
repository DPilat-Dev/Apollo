/**
 * Which item types a library should surface when browsing or searching it.
 *
 * This must never be left undefined: these queries are recursive, and an
 * unconstrained recursive query walks the whole tree, so a show library comes
 * back as every series *and* every season and episode inside it. Custom and
 * mixed libraries have no collection type at all, which is exactly the case
 * that used to fall through.
 */
export function browsableTypes(collectionType?: string | null): string[] {
  switch (collectionType) {
    case 'movies':
      return ['Movie']
    case 'tvshows':
      return ['Series']
    case 'music':
      return ['MusicAlbum']
    case 'boxsets':
      return ['BoxSet']
    case 'homevideos':
    case 'photos':
      return ['Video', 'Photo']
    case 'books':
      return ['Book']
    case 'musicvideos':
      return ['MusicVideo']
    default:
      // Mixed or custom library: top-level entities only, never their children.
      return ['Movie', 'Series', 'BoxSet']
  }
}

/** Live TV needs a tuner/guide UI this client doesn't have. */
export const isBrowsableLibrary = (collectionType?: string | null) => collectionType !== 'livetv'

/**
 * Seasons in the order a viewer expects, which is not the order they arrive in.
 *
 * `/Shows/{id}/Seasons` returns whatever order the server holds them in, and on
 * a real library that is often not the running order: One Piece arrives as
 * Specials, 17, 18, 19, 20, 21, 23, 1, 2 … 16, 22. Six of twenty-two
 * multi-season shows in one anime library were jumbled, and three of
 * forty-six in a television one, so this is not an anime problem — it is just
 * most visible there.
 *
 * Specials go last rather than first. They are season zero, so sorting on the
 * number alone puts them above Season 1, and someone opening a show wants the
 * beginning of it rather than the extras.
 *
 * Anything with no number at all goes after those, ordered by name so the
 * result does not depend on what the server felt like sending.
 */
export function orderedSeasons<T extends { IndexNumber?: number | null; Name?: string | null }>(
  seasons: readonly T[],
): T[] {
  const rank = (s: T) => {
    const n = s.IndexNumber
    if (typeof n !== 'number' || !Number.isFinite(n)) return 2
    return n === 0 ? 1 : 0
  }
  return [...seasons].sort((a, b) => {
    const byGroup = rank(a) - rank(b)
    if (byGroup !== 0) return byGroup
    const an = a.IndexNumber
    const bn = b.IndexNumber
    if (typeof an === 'number' && typeof bn === 'number' && an !== bn) return an - bn
    return (a.Name ?? '').localeCompare(b.Name ?? '')
  })
}
