import { describe, expect, it } from 'vitest'
import {
  applyWarnings,
  canIdentify,
  identifyKind,
  itemViewKeys,
  parseProviderId,
  remoteSearchQuery,
  replaceArtworkByDefault,
} from '../identify'

describe('identifyKind', () => {
  it('maps the types the server has a lookup endpoint for', () => {
    expect(identifyKind('Series')).toBe('Series')
    expect(identifyKind('Movie')).toBe('Movie')
    expect(identifyKind('BoxSet')).toBe('BoxSet')
    expect(identifyKind('Person')).toBe('Person')
    expect(identifyKind('Trailer')).toBe('Trailer')
  })

  /*
    Not an oversight on the server's part. MetadataService says so in as many
    words — "Episode and Season do not support Identify, so the search results
    are the Series'" — and there is no /Items/RemoteSearch/Episode to post to.
    An episode is fixed by identifying its series and refreshing.
  */
  it('has nothing to offer an episode or a season', () => {
    expect(identifyKind('Episode')).toBeNull()
    expect(identifyKind('Season')).toBeNull()
  })

  it('refuses anything else, including nothing at all', () => {
    expect(identifyKind('Audio')).toBeNull()
    expect(identifyKind('CollectionFolder')).toBeNull()
    expect(identifyKind(undefined)).toBeNull()
    expect(identifyKind(null)).toBeNull()
  })
})

describe('canIdentify', () => {
  const series = { Id: 'abc', Type: 'Series' }

  it('offers the control to an admin looking at a supported type', () => {
    expect(canIdentify({ isAdmin: true, item: series })).toBe(true)
  })

  /*
    The gate that matters. /admin is route-gated but the detail page is not,
    so every viewer renders this component tree; without the admin term here
    the buttons would simply be on everyone's screen.
  */
  it('offers nothing to an ordinary viewer', () => {
    expect(canIdentify({ isAdmin: false, item: series })).toBe(false)
  })

  it('stays hidden for a type with no endpoint, admin or not', () => {
    expect(canIdentify({ isAdmin: true, item: { Id: 'abc', Type: 'Episode' } })).toBe(false)
  })

  it('needs an id to identify against', () => {
    expect(canIdentify({ isAdmin: true, item: { Type: 'Series' } })).toBe(false)
  })
})

/*
  A search box that only takes a title cannot fix the case it exists for: two
  shows with the same name, where the provider's own ranking put the wrong one
  first. Pasting the id is the way out, and admins paste whatever their browser
  address bar was showing.
*/
describe('parseProviderId', () => {
  it('recognises a bare IMDb id by its tt prefix', () => {
    expect(parseProviderId('tt0903747')).toEqual({ provider: 'Imdb', id: 'tt0903747' })
    expect(parseProviderId('  TT0903747 ')).toEqual({ provider: 'Imdb', id: 'tt0903747' })
  })

  it('reads a prefixed id in either punctuation', () => {
    expect(parseProviderId('tmdb:1396')).toEqual({ provider: 'Tmdb', id: '1396' })
    expect(parseProviderId('TVDB=81189')).toEqual({ provider: 'Tvdb', id: '81189' })
    expect(parseProviderId('imdb: tt0903747')).toEqual({ provider: 'Imdb', id: 'tt0903747' })
  })

  it('pulls the id out of a pasted provider page url', () => {
    expect(parseProviderId('https://www.themoviedb.org/tv/1396-breaking-bad')).toEqual({
      provider: 'Tmdb',
      id: '1396',
    })
    expect(parseProviderId('https://www.themoviedb.org/movie/155')).toEqual({
      provider: 'Tmdb',
      id: '155',
    })
    expect(parseProviderId('https://www.imdb.com/title/tt0903747/')).toEqual({
      provider: 'Imdb',
      id: 'tt0903747',
    })
    expect(parseProviderId('https://thetvdb.com/dereferrer/series/81189')).toEqual({
      provider: 'Tvdb',
      id: '81189',
    })
  })

  /*
    TheTVDB's human-facing urls are slugs, and a slug is not something the
    lookup endpoint accepts. Treating one as an id would send a query that can
    only ever come back empty, with no hint as to why.
  */
  it('declines a provider url that carries no numeric id', () => {
    expect(parseProviderId('https://thetvdb.com/series/breaking-bad')).toBeNull()
  })

  it('leaves an ordinary title alone', () => {
    expect(parseProviderId('Breaking Bad')).toBeNull()
    expect(parseProviderId('   ')).toBeNull()
  })

  /*
    "1899" is a Netflix series as readily as it is a TMDb id, and there is no
    way to tell from four digits which one was meant. Guessing turns a title
    search into a lookup for something unrelated, silently.
  */
  it('will not guess a provider from bare digits', () => {
    expect(parseProviderId('1899')).toBeNull()
    expect(parseProviderId('1396')).toBeNull()
  })

  /*
    Plenty of titles contain a colon, and the prefixed form is the only reason
    this function looks at one at all.
  */
  it('is not fooled by a colon in a title', () => {
    expect(parseProviderId('Dune: Part Two')).toBeNull()
    expect(parseProviderId('Star Wars: A New Hope')).toBeNull()
  })
})

describe('remoteSearchQuery', () => {
  it('searches by name and year', () => {
    expect(remoteSearchQuery('item-1', { search: ' The Office ', year: 2005 })).toEqual({
      ItemId: 'item-1',
      SearchInfo: { Name: 'The Office', Year: 2005 },
      IncludeDisabledProviders: false,
    })
  })

  it('drops a year nobody typed', () => {
    const q = remoteSearchQuery('item-1', { search: 'The Office' })
    expect(q?.SearchInfo).toEqual({ Name: 'The Office' })
  })

  /*
    The whole reason one box takes both: typing an id into a field labelled
    "name" searches the providers for the literal string "tt0903747", which
    matches nothing and looks like the server is broken.
  */
  it('sends a pasted id as a provider id, never as a name', () => {
    const q = remoteSearchQuery('item-1', { search: 'https://www.themoviedb.org/tv/1396' })
    expect(q?.SearchInfo).toEqual({ ProviderIds: { Tmdb: '1396' } })
    expect(q?.SearchInfo?.Name).toBeUndefined()
  })

  /*
    An id names exactly one title. Pinning a year on top of it can only
    exclude the right answer when the year in the library is the wrong one —
    which, on an item being re-identified, it usually is.
  */
  it('ignores the year once an id is given', () => {
    const q = remoteSearchQuery('item-1', { search: 'tt0903747', year: 1999 })
    expect(q?.SearchInfo).toEqual({ ProviderIds: { Imdb: 'tt0903747' } })
  })

  it('passes the disabled-provider opt-in through', () => {
    const q = remoteSearchQuery('item-1', { search: 'Dune', includeDisabledProviders: true })
    expect(q?.IncludeDisabledProviders).toBe(true)
  })

  it('refuses to build a query with nothing to search for', () => {
    expect(remoteSearchQuery('item-1', { search: '   ' })).toBeNull()
    expect(remoteSearchQuery('item-1', { search: '', year: 2005 })).toBeNull()
  })
})

describe('replaceArtworkByDefault', () => {
  /*
    The destructive option is never the one already ticked when there is
    something to destroy. Apply pairs replaceAllImages with a hardcoded
    RemoveOldMetadata, so a ticked box costs the admin the poster they chose.
  */
  it('leaves artwork alone when the item has some', () => {
    expect(replaceArtworkByDefault({ ImageTags: { Primary: 'abc' } })).toBe(false)
  })

  it('fetches artwork for an item that has none', () => {
    expect(replaceArtworkByDefault({})).toBe(true)
    expect(replaceArtworkByDefault({ ImageTags: {} })).toBe(true)
    expect(replaceArtworkByDefault({ ImageTags: { Logo: 'abc' } })).toBe(true)
  })
})

/*
  What the server actually does with Apply, read off Jellyfin 10.11.8:

  ItemLookupController.ApplySearchCriteria hardcodes ReplaceAllMetadata = true
  and RemoveOldMetadata = true, and exposes only replaceAllImages as a knob.
  MetadataService.RefreshWithProviders then returns early on item.IsLocked, so
  the editor's "Locked" toggle really does hold the text fields — but the image
  half runs outside that early return, and RemoveOldMetadata + ReplaceAllImages
  deletes every existing image before the providers are asked for new ones.

  So the lock protects words and not pictures, and an admin who set it gets a
  half-applied identify: new provider ids, old fields. All three of those are
  surprises worth saying out loud rather than discovering afterwards.
*/
describe('applyWarnings', () => {
  const codes = (item: { LockData?: boolean }, replaceAllImages: boolean) =>
    applyWarnings(item, { replaceAllImages }).map((w) => w.code)

  it('always says that the text fields are replaced', () => {
    expect(codes({}, false)).toContain('replaces-metadata')
  })

  it('warns that a locked item will keep its fields and only re-point the ids', () => {
    expect(codes({ LockData: true }, false)).toContain('locked-keeps-metadata')
    expect(codes({}, false)).not.toContain('locked-keeps-metadata')
  })

  it('warns about artwork only when artwork is being replaced', () => {
    expect(codes({}, true)).toContain('images-replaced')
    expect(codes({}, false)).not.toContain('images-replaced')
  })

  /*
    The one an admin would otherwise be caught by: locking an item reads as
    "leave my item alone", and for the poster it does not.
  */
  it('says plainly that the lock does not cover artwork', () => {
    expect(codes({ LockData: true }, true)).toContain('lock-ignores-images')
    expect(codes({ LockData: true }, false)).not.toContain('lock-ignores-images')
    expect(codes({}, true)).not.toContain('lock-ignores-images')
  })

  it('gives every warning a line of prose to show', () => {
    for (const warning of applyWarnings({ LockData: true }, { replaceAllImages: true })) {
      expect(warning.text.length).toBeGreaterThan(20)
    }
  })
})

/*
  Both halves of the fix change server-side data the page is already showing,
  and both end the same way. Applying a match and seeing nothing move is what
  makes an admin apply it a second time.
*/
describe('itemViewKeys', () => {
  it('names the item itself, scoped to the user whose cache holds it', () => {
    expect(itemViewKeys('user-1', 'item-1')).toContainEqual(['item', 'user-1', 'item-1'])
  })

  it('names the lists that render the same artwork and titles', () => {
    const keys = itemViewKeys('user-1', 'item-1')
    expect(keys).toContainEqual(['seasons'])
    expect(keys).toContainEqual(['episodes'])
    expect(keys).toContainEqual(['itemsRow'])
  })
})
