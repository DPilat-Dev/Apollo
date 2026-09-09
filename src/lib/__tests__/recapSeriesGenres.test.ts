import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import {
  chunkIds,
  genresBySeries,
  SERIES_LOOKUP_CHUNK,
  seriesIdsFrom,
  withSeriesGenres,
} from '../recapSeriesGenres'

const ep = (id: string, seriesId?: string, genres?: string[]): BaseItemDto =>
  ({ Id: id, Type: 'Episode', SeriesId: seriesId, Genres: genres }) as BaseItemDto
const movie = (id: string, genres?: string[]): BaseItemDto =>
  ({ Id: id, Type: 'Movie', Genres: genres }) as BaseItemDto

describe('seriesIdsFrom', () => {
  it('collects each show once, however many episodes were watched', () => {
    expect(seriesIdsFrom([ep('1', 's1'), ep('2', 's1'), ep('3', 's2')])).toEqual(['s1', 's2'])
  })

  it('ignores films, which carry their own genres already', () => {
    expect(seriesIdsFrom([movie('m1'), ep('1', 's1')])).toEqual(['s1'])
  })

  it('ignores an episode with no show', () => {
    expect(seriesIdsFrom([ep('1', undefined)])).toEqual([])
  })
})

describe('chunkIds', () => {
  it('keeps a request short enough to send', () => {
    // Ids are 32 characters each; fifty is about 1,700 characters of them.
    const ids = Array.from({ length: 120 }, (_, i) => `id${i}`)
    const chunks = chunkIds(ids)
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toHaveLength(SERIES_LOOKUP_CHUNK)
    expect(chunks.flat()).toEqual(ids)
  })

  it('has nothing to chunk when there is nothing', () => {
    expect(chunkIds([])).toEqual([])
  })
})

describe('withSeriesGenres', () => {
  const bySeries = genresBySeries([
    { Id: 's1', Genres: ['Action', 'Adventure', 'Animation', 'Anime'] } as BaseItemDto,
  ])

  it('gives an episode the genre that only its show carries', () => {
    // The whole reason this exists: `Anime` is on the show and nowhere else,
    // so a year of anime counted none of it.
    const out = withSeriesGenres([ep('1', 's1', ['Animation', 'Action'])], bySeries)
    expect(out[0].Genres).toContain('Anime')
  })

  it('keeps what the episode already had', () => {
    // An episode occasionally carries something its show does not, and losing
    // that would trade one gap for another.
    const out = withSeriesGenres([ep('1', 's1', ['Musical'])], bySeries)
    expect(out[0].Genres).toContain('Musical')
    expect(out[0].Genres).toContain('Anime')
  })

  it('does not count one genre twice for a difference in case', () => {
    const out = withSeriesGenres([ep('1', 's1', ['animation'])], bySeries)
    const animation = (out[0].Genres ?? []).filter((g) => /^animation$/i.test(g))
    expect(animation).toHaveLength(1)
  })

  it('leaves films alone', () => {
    const film = movie('m1', ['Drama'])
    expect(withSeriesGenres([film], bySeries)[0]).toBe(film)
  })

  it('leaves an episode whose show was not found exactly as it was', () => {
    // The same object, not a copy: an item that did not change must not make
    // anything downstream re-render.
    const orphan = ep('1', 'unknown', ['Drama'])
    expect(withSeriesGenres([orphan], bySeries)[0]).toBe(orphan)
  })

  it('does nothing at all when no shows were looked up', () => {
    const items = [ep('1', 's1', ['Drama'])]
    expect(withSeriesGenres(items, new Map())[0]).toBe(items[0])
  })

  it('handles an episode with no genres of its own', () => {
    // Twenty-one of one account's played items had none at all.
    const out = withSeriesGenres([ep('1', 's1')], bySeries)
    expect(out[0].Genres).toEqual(['Action', 'Adventure', 'Animation', 'Anime'])
  })
})

describe('genresBySeries', () => {
  it('skips a show with no genres rather than storing an empty list', () => {
    const map = genresBySeries([{ Id: 's1', Genres: [] } as BaseItemDto])
    expect(map.size).toBe(0)
  })
})
