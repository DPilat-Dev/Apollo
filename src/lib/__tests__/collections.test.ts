import { describe, expect, it } from 'vitest'
import { browsableTypes, orderedSeasons, isBrowsableLibrary } from '../collections'

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

describe('orderedSeasons', () => {
  const s = (IndexNumber: number | null | undefined, Name = `Season ${IndexNumber}`) =>
    ({ IndexNumber, Name })
  const nums = (list: ReturnType<typeof s>[]) => orderedSeasons(list).map((x) => x.IndexNumber)

  it('puts the running order back', () => {
    // The real order One Piece arrives in from the server.
    const arrived = [0, 17, 18, 19, 20, 21, 23, 1, 2, 3, 16, 22].map((n) => s(n))
    expect(nums(arrived)).toEqual([1, 2, 3, 16, 17, 18, 19, 20, 21, 22, 23, 0])
  })

  it('sends specials to the end, not to the front', () => {
    // Season zero sorts above Season 1 on the number alone, and someone
    // opening a show wants the beginning of it rather than the extras.
    expect(nums([s(0, 'Specials'), s(1), s(2)])).toEqual([1, 2, 0])
  })

  it('puts seasons with no number after everything numbered', () => {
    const list = [s(undefined, 'Extras & Movies'), s(2), s(0, 'Specials'), s(1)]
    expect(orderedSeasons(list).map((x) => x.Name)).toEqual([
      'Season 1', 'Season 2', 'Specials', 'Extras & Movies',
    ])
  })

  it('orders unnumbered seasons by name rather than by arrival', () => {
    const a = [s(null, 'Zebra'), s(null, 'Alpha')]
    expect(orderedSeasons(a).map((x) => x.Name)).toEqual(['Alpha', 'Zebra'])
  })

  it('does not mutate what it was given', () => {
    const list = [s(3), s(1), s(2)]
    orderedSeasons(list)
    expect(list.map((x) => x.IndexNumber)).toEqual([3, 1, 2])
  })

  it('leaves an already-correct list alone, and copes with nothing', () => {
    expect(nums([s(1), s(2), s(3)])).toEqual([1, 2, 3])
    expect(orderedSeasons([])).toEqual([])
  })

  it('is not fooled by a non-finite number', () => {
    expect(nums([s(Number.NaN, 'Odd'), s(1)])).toEqual([1, Number.NaN])
  })
})
