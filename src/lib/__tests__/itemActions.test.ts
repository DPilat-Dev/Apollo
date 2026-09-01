import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { hasItemActions, itemActions } from '../itemActions'

const item = (over: Partial<BaseItemDto> = {}): BaseItemDto =>
  ({ Id: 'i1', Name: 'Thing', Type: 'Series', ...over }) as BaseItemDto

const ids = (isAdmin: boolean, over: Partial<BaseItemDto> = {}) =>
  itemActions({ isAdmin, item: item(over) }).map((a) => a.id)

describe('itemActions', () => {
  it('offers a series the full set', () => {
    expect(ids(true)).toEqual(['edit', 'identify', 'artwork', 'refresh'])
  })

  it('offers a movie the full set', () => {
    expect(ids(true, { Type: 'Movie' })).toEqual(['edit', 'identify', 'artwork', 'refresh'])
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

  it('gives a non-admin nothing at all', () => {
    // The detail page is open to every viewer. This list must never name an
    // elevated action for one, whoever chose to render the menu.
    expect(ids(false)).toEqual([])
    expect(hasItemActions({ isAdmin: false, item: item() })).toBe(false)
  })

  it('gives nothing for an item that has not loaded', () => {
    expect(itemActions({ isAdmin: true, item: undefined })).toEqual([])
    expect(itemActions({ isAdmin: true, item: item({ Id: undefined }) })).toEqual([])
  })

  it('puts Edit metadata first, because it is the one that always applies', () => {
    for (const type of ['Series', 'Movie', 'Season', 'Episode']) {
      expect(ids(true, { Type: type as BaseItemDto['Type'] })[0]).toBe('edit')
    }
  })

  it('always ends with Refresh, which never depends on the type', () => {
    for (const type of ['Series', 'Movie', 'Season', 'Episode']) {
      expect(ids(true, { Type: type as BaseItemDto['Type'] }).at(-1)).toBe('refresh')
    }
  })

  it('hasItemActions agrees with the list it summarises', () => {
    for (const isAdmin of [true, false]) {
      for (const type of ['Series', 'Episode']) {
        const args = { isAdmin, item: item({ Type: type as BaseItemDto['Type'] }) }
        expect(hasItemActions(args)).toBe(itemActions(args).length > 0)
      }
    }
  })
})
