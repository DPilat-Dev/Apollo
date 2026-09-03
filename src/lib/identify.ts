/**
 * Identify — pointing a library item at a different provider match.
 *
 * The other half of metadata editing. `MetadataEditor` fixes a field that is
 * wrong; this fixes the case where the *whole record* belongs to something
 * else, because two shows share a name and the scan picked the popular one.
 *
 * Everything here is decided without a request so that the three things that
 * bite — which types can be identified at all, what a pasted id means, and
 * what Apply is about to destroy — can be checked in a test rather than
 * discovered against someone's real library.
 */

/** The lookup endpoints under /Items/RemoteSearch, as of Jellyfin 10.11. */
export type IdentifyKind = 'Series' | 'Movie' | 'BoxSet' | 'Person' | 'Trailer'

const KINDS: Record<string, IdentifyKind> = {
  Series: 'Series',
  Movie: 'Movie',
  BoxSet: 'BoxSet',
  Person: 'Person',
  Trailer: 'Trailer',
}

/**
 * Which endpoint an item is identified against, or null for the types that
 * have none.
 *
 * Episode and Season are the interesting nulls. It is not that Apollo has not
 * got round to them — the server has no endpoint to post to, and Jellyfin's
 * own MetadataService says why in a comment: "Episode and Season do not
 * support Identify, so the search results are the Series'". An episode with
 * the wrong data is fixed by identifying its series and refreshing.
 */
export function identifyKind(itemType?: string | null): IdentifyKind | null {
  return (itemType && KINDS[itemType]) || null
}

interface ItemLike {
  Id?: string | null
  Type?: string | null
  LockData?: boolean | null
  Name?: string | null
  ProductionYear?: number | null
  ImageTags?: { [key: string]: string } | null
}

/**
 * Whether to offer Identify at all.
 *
 * The admin term is not decoration. `/admin` is gated by its route, but this
 * control lives on the item page every viewer opens, so the only thing keeping
 * an elevated endpoint off an ordinary screen is this check — which is why it
 * is a function with a test and not a `&&` buried in a hero.
 */
export function canIdentify(input: { isAdmin: boolean; item: ItemLike }): boolean {
  return Boolean(input.isAdmin && input.item.Id && identifyKind(input.item.Type))
}

export interface ProviderId {
  /** Jellyfin's own key — the one that goes into ProviderIds. */
  provider: 'Imdb' | 'Tmdb' | 'Tvdb'
  id: string
}

const PREFIXES: Record<string, ProviderId['provider']> = {
  imdb: 'Imdb',
  tmdb: 'Tmdb',
  themoviedb: 'Tmdb',
  tvdb: 'Tvdb',
  thetvdb: 'Tvdb',
}

/**
 * Every one of these insists on an id and not a path segment. The url an admin
 * copies from TheTVDB is usually `/series/breaking-bad` — a slug, which the
 * lookup endpoint has no idea what to do with. Matching it would send a query
 * that can only come back empty, with nothing on screen to say why.
 */
const URL_PATTERNS: [RegExp, ProviderId['provider']][] = [
  [/imdb\.com\/title\/(tt\d+)/i, 'Imdb'],
  [/themoviedb\.org\/(?:movie|tv|person|collection)\/(\d+)/i, 'Tmdb'],
  [/thetvdb\.com\/(?:.*\/)?(?:series|movies|people)\/(\d+)/i, 'Tvdb'],
]

/**
 * A provider id out of whatever an admin pasted.
 *
 * Searching by title is exactly what already went wrong — the provider ranked
 * the wrong same-named title first, and asking it the same question a second
 * time gets the same answer. The way out is to name the match outright, and
 * what an admin has to hand is the address bar of the provider page they just
 * checked, so a full url has to work as well as a bare id.
 *
 * Returning null for anything unrecognised is what lets one input box serve as
 * both the title field and the id field.
 */
export function parseProviderId(input: string): ProviderId | null {
  const text = input.trim()
  if (!text) return null

  for (const [pattern, provider] of URL_PATTERNS) {
    const match = text.match(pattern)
    if (match) return { provider, id: match[1].toLowerCase() }
  }

  // The prefix has to be a provider we know. Titles contain colons — "Dune:
  // Part Two" would otherwise be read as an id for a provider called "Dune" —
  // and so does every url that got this far without matching above.
  const prefixed = text.match(/^([a-z]+)\s*[:=]\s*(.+)$/i)
  if (prefixed) {
    const provider = PREFIXES[prefixed[1].toLowerCase()]
    const id = prefixed[2].trim()
    if (provider && id) return { provider, id: id.toLowerCase() }
  }

  // Bare IMDb ids are self-describing; bare digits are not — "1899" is a show
  // as often as it is a TMDb id, and guessing would silently turn a title
  // search into a lookup for something unrelated.
  if (/^tt\d+$/i.test(text)) return { provider: 'Imdb', id: text.toLowerCase() }

  return null
}

/** The POST body shared by every /Items/RemoteSearch/{kind} endpoint. */
export interface RemoteSearchQuery {
  ItemId: string
  SearchInfo?: {
    Name?: string
    Year?: number
    ProviderIds?: Record<string, string>
  }
  IncludeDisabledProviders: boolean
}

/**
 * The lookup to send, or null when there is nothing to look up.
 *
 * One box takes both a title and an id, so this is where the two are told
 * apart. A pasted id must never travel as `Name`: the providers would search
 * their catalogues for the literal string "tt0903747", find nothing, and leave
 * the admin looking at an empty list with no hint that the box wanted a title.
 */
export function remoteSearchQuery(
  itemId: string,
  input: { search: string; year?: number | null; includeDisabledProviders?: boolean },
): RemoteSearchQuery | null {
  const provider = parseProviderId(input.search)
  const name = provider ? '' : input.search.trim()
  if (!provider && !name) return null

  const searchInfo: RemoteSearchQuery['SearchInfo'] = provider
    ? { ProviderIds: { [provider.provider]: provider.id } }
    : { Name: name }

  // Only alongside a name. An id already names one title, and pinning a year
  // on top can only exclude it — on an item being re-identified the year in
  // the library is usually part of what is wrong.
  if (!provider && input.year) searchInfo.Year = input.year

  return {
    ItemId: itemId,
    SearchInfo: searchInfo,
    IncludeDisabledProviders: Boolean(input.includeDisabledProviders),
  }
}

/**
 * Whether the "replace artwork" toggle starts switched on.
 *
 * Off wherever there is artwork to lose, because an admin fixing a wrong match
 * on a series whose poster they hand-picked did not ask to lose the poster —
 * and the server would take it, since Apply pairs replaceAllImages with a
 * hardcoded RemoveOldMetadata.
 *
 * On when the item has no primary image at all. That is the item nobody has
 * curated: it was never matched to anything, so there is nothing to protect
 * and a poster is the visible half of the fix.
 */
export function replaceArtworkByDefault(item: Pick<ItemLike, 'ImageTags'>): boolean {
  return !item.ImageTags?.Primary
}

export type ApplyWarningCode =
  | 'replaces-metadata'
  | 'locked-keeps-metadata'
  | 'images-replaced'
  | 'lock-ignores-images'

export interface ApplyWarning {
  code: ApplyWarningCode
  text: string
}

/**
 * What Apply is about to do, said before it happens.
 *
 * Read off Jellyfin 10.11.8 rather than assumed. `ApplySearchCriteria`
 * hardcodes `ReplaceAllMetadata = true` and `RemoveOldMetadata = true` and
 * exposes only `replaceAllImages` as a query parameter, so there is no polite
 * version of this call to make. The editor's "Locked" toggle does hold — but
 * only for the words: `MetadataService.RefreshWithProviders` returns early on
 * `item.IsLocked`, while the image half runs outside that early return, and
 * `RemoveOldMetadata` plus `ReplaceAllImages` deletes every existing image
 * before the providers are asked for new ones.
 *
 * That leaves a locked item in a state worth naming out loud: its provider ids
 * are re-pointed (the controller assigns those before the refresh) and its
 * fields are not, which looks from the outside like an identify that did
 * nothing. Warning is the honest option here; there is no flag to respect.
 */
export function applyWarnings(
  item: Pick<ItemLike, 'LockData'>,
  opts: { replaceAllImages: boolean },
): ApplyWarning[] {
  const locked = Boolean(item.LockData)
  const warnings: ApplyWarning[] = []

  if (locked) {
    warnings.push({
      code: 'locked-keeps-metadata',
      text:
        'This item is locked, so the server will keep the fields it has and only re-point its ' +
        'provider ids. Unlock it first if you want the new match’s title, overview and dates.',
    })
  } else {
    warnings.push({
      code: 'replaces-metadata',
      text:
        'Every text field is replaced with the chosen match, including anything edited here by ' +
        'hand. Lock the item first if you want to keep what is there.',
    })
  }

  if (opts.replaceAllImages) {
    warnings.push({
      code: 'images-replaced',
      text: 'Existing artwork is deleted before new artwork is fetched, so any poster chosen by hand goes with it.',
    })
    if (locked) {
      warnings.push({
        code: 'lock-ignores-images',
        text: 'The lock does not cover artwork — the server removes images on a locked item just the same.',
      })
    }
  }

  return warnings
}

/**
 * Everything on screen that is drawn from an item's own metadata or artwork.
 *
 * Both halves of this feature change server-side data the page is already
 * showing, and both end the same way. Skipping this is the failure the admin
 * feels: they apply a fix, nothing on the page moves, so they apply it again.
 *
 * Season and episode lists are in here unqualified because identifying a
 * series re-scrapes its children, and the lists are keyed by the series rather
 * than by the item that was edited.
 */
export function itemViewKeys(userId: string | undefined, itemId: string): unknown[][] {
  return [['item', userId, itemId], ['seasons'], ['episodes'], ['itemsRow']]
}
