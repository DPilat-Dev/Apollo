import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { hasItemActions, itemActions } from '../itemActions'

const item = (over: Partial<BaseItemDto> = {}): BaseItemDto =>
  ({ Id: 'i1', Name: 'Thing', Type: 'Series', ...over }) as BaseItemDto

const ids = (isAdmin: boolean, over: Partial<BaseItemDto> = {}) =>
  itemActions({ isAdmin, canManageCollections: false, item: item(over) }).map((a) => a.id)

describe('itemActions', () => {
  it('offers a series the full set', () => {
    expect(ids(true)).toEqual(['playlist', 'remote', 'edit', 'identify', 'artwork', 'refresh'])
  })

  it('offers a movie the full set', () => {
    expect(ids(true, { Type: 'Movie' })).toEqual([
      'playlist', 'remote', 'edit', 'identify', 'artwork', 'refresh',
    ])
  })

  it('drops Identify for an episode, which the server cannot identify', () => {
    // There is no /Items/RemoteSearch/Episode. A dead entry is worse than a
    // shorter menu, because the viewer concludes the feature is broken.
    const entries = ids(true, { Type: 'Episode' })
    expect(entries).not.toContain('identify')
    expect(entries).toContain('edit')
  })

  it('drops Identify for a season too', () => {
    expect(ids(true, { Type: 'Season' })).not.toContain('identify')
  })

  it('gives a non-admin the everyday actions and not one elevated one', () => {
    // The detail page is open to every viewer. Adding to a playlist is theirs;
    // editing metadata is not, whoever chose to render the menu.
    expect(ids(false)).toEqual(['playlist', 'remote'])
    for (const elevated of ['edit', 'identify', 'artwork', 'refresh']) {
      expect(ids(false)).not.toContain(elevated)
    }
    expect(hasItemActions({ isAdmin: false, canManageCollections: false, item: item() })).toBe(true)
  })

  it('gives nothing for an item that has not loaded', () => {
    const none = { canManageCollections: false }
    expect(itemActions({ ...none, isAdmin: true, item: undefined })).toEqual([])
    expect(itemActions({ ...none, isAdmin: true, item: item({ Id: undefined }) })).toEqual([])
    expect(itemActions({ ...none, isAdmin: false, item: undefined })).toEqual([])
  })

  it('leads with the actions everyone has, whatever the type', () => {
    for (const type of ['Series', 'Movie', 'Season', 'Episode']) {
      expect(ids(true, { Type: type as BaseItemDto['Type'] }).slice(0, 2)).toEqual([
        'playlist',
        'remote',
      ])
    }
  })

  it('always ends with Refresh, which never depends on the type', () => {
    for (const type of ['Series', 'Movie', 'Season', 'Episode']) {
      expect(ids(true, { Type: type as BaseItemDto['Type'] }).at(-1)).toBe('refresh')
    }
  })

  it('offers Add to collection to a viewer allowed to curate, beside Add to playlist', () => {
    // Filing something into a collection is the same gesture as filing it into
    // a playlist, so they sit together rather than one of them being marooned
    // among the admin entries.
    const entries = itemActions({
      isAdmin: false,
      canManageCollections: true,
      item: item(),
    }).map((a) => a.id)
    expect(entries).toEqual(['playlist', 'collection', 'remote'])
  })

  it('withholds it from a viewer who may not curate, admin or not', () => {
    // /Collections answers 403 without the CollectionManagement permission,
    // and being an administrator is not the thing that grants it — a menu
    // entry that always fails is worse than one that is not there.
    expect(ids(false)).not.toContain('collection')
    expect(ids(true)).not.toContain('collection')
  })

  it('offers it alongside the elevated entries when the curator is also an admin', () => {
    const entries = itemActions({ isAdmin: true, canManageCollections: true, item: item() }).map(
      (a) => a.id,
    )
    expect(entries).toEqual([
      'playlist',
      'collection',
      'remote',
      'edit',
      'identify',
      'artwork',
      'refresh',
    ])
  })

  it('offers it for an episode too, which a collection can hold like anything else', () => {
    expect(
      itemActions({ isAdmin: false, canManageCollections: true, item: item({ Type: 'Episode' }) })
        .map((a) => a.id),
    ).toContain('collection')
  })

  it('gives nothing at all for an item that has not loaded, curator or not', () => {
    expect(itemActions({ isAdmin: false, canManageCollections: true, item: undefined })).toEqual([])
  })

  it('hasItemActions agrees with the list it summarises', () => {
    for (const isAdmin of [true, false]) {
      for (const type of ['Series', 'Episode']) {
        const args = {
          isAdmin,
          canManageCollections: isAdmin,
          item: item({ Type: type as BaseItemDto['Type'] }),
        }
        expect(hasItemActions(args)).toBe(itemActions(args).length > 0)
      }
    }
  })
})
