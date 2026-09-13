import { describe, expect, it } from 'vitest'
import { buildUrl } from '../api'

const SERVER = 'http://jf:8096'

describe('buildUrl', () => {
  it('joins ordinary lists with commas, as Jellyfin expects', () => {
    const url = new URL(buildUrl(SERVER, '/Items', { fields: ['Genres', 'Overview'] }))
    expect(url.searchParams.get('fields')).toBe('Genres,Overview')
    expect(url.searchParams.getAll('fields')).toHaveLength(1)
  })

  it('repeats the ones that bind as enums', () => {
    /*
      An enum array binds through Enum.TryParse, which reads a comma separated
      string as flags syntax: two of these happened to make a representable
      value and answered 200, so the wrong form passed for a working one until
      all five types were asked for and the server answered 400. Nothing in
      Apollo noticed, because no skip segments meant no skip buttons either way.
    */
    const url = new URL(
      buildUrl(SERVER, '/MediaSegments/abc', {
        includeSegmentTypes: ['Intro', 'Outro', 'Recap', 'Preview', 'Commercial'],
      }),
    )
    expect(url.searchParams.getAll('includeSegmentTypes')).toEqual([
      'Intro',
      'Outro',
      'Recap',
      'Preview',
      'Commercial',
    ])
    expect(url.search).not.toContain('Intro%2COutro')
  })

  it('leaves a single value alone whichever list it is', () => {
    expect(
      new URL(buildUrl(SERVER, '/MediaSegments/abc', { includeSegmentTypes: ['Intro'] })).searchParams.get(
        'includeSegmentTypes',
      ),
    ).toBe('Intro')
  })

  it('drops empty and absent values rather than sending them', () => {
    const url = new URL(
      buildUrl(SERVER, '/Items', { a: undefined, b: null, c: '', d: 0, e: false }),
    )
    expect(url.searchParams.has('a')).toBe(false)
    expect(url.searchParams.has('b')).toBe(false)
    expect(url.searchParams.has('c')).toBe(false)
    // Zero and false are answers, not absences.
    expect(url.searchParams.get('d')).toBe('0')
    expect(url.searchParams.get('e')).toBe('false')
  })
})
