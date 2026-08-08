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
