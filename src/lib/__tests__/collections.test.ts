import { describe, expect, it } from 'vitest'
import { browsableTypes, isBrowsableLibrary } from '../collections'

/**
 * Regression: a library with no collection type used to fall through to
 * `undefined`, and because these queries are recursive that returned every
 * series *plus* every season and episode inside it.
 */
describe('browsableTypes', () => {
  it('never returns an empty list, whatever it is handed', () => {
    for (const type of ['movies', 'tvshows', 'music', 'boxsets', 'weird', '', null, undefined]) {
      expect(browsableTypes(type).length).toBeGreaterThan(0)
    }
  })

  it('never includes child types that would flood a grid', () => {
    const children = ['Episode', 'Season', 'Audio']
    for (const type of ['movies', 'tvshows', 'mixed', null, undefined, 'nonsense']) {
      for (const child of children) {
        expect(browsableTypes(type)).not.toContain(child)
      }
    }
  })

  it('narrows known library types', () => {
    expect(browsableTypes('movies')).toEqual(['Movie'])
    expect(browsableTypes('tvshows')).toEqual(['Series'])
  })

  it('falls back to top-level entities for custom libraries', () => {
    expect(browsableTypes(null)).toEqual(['Movie', 'Series', 'BoxSet'])
    expect(browsableTypes('something-new')).toEqual(['Movie', 'Series', 'BoxSet'])
  })

  it('excludes only Live TV from browsing', () => {
    expect(isBrowsableLibrary('livetv')).toBe(false)
    expect(isBrowsableLibrary('movies')).toBe(true)
    expect(isBrowsableLibrary(null)).toBe(true)
  })
})
