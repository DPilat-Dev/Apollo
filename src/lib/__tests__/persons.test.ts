/*
  Pinned to a zone west of UTC before anything constructs a Date.

  Jellyfin sends a birth date as midnight UTC, so `new Date(...).getFullYear()`
  and friends report the *previous* day for every viewer in the Americas — the
  classic off-by-one that turns 9 July 1956 into 8 July 1956 for a third of the
  planet. Setting TZ here makes that failure reproducible on any machine rather
  than only on the machines it would have shipped broken to.
*/
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { JellyfinApi, buildUrl } from '../api'
import {
  bioIsLong,
  personBio,
  personBirthplace,
  personHeaderMode,
  personHref,
  personLifeline,
  personLinks,
  personRedirect,
  personRequestPath,
  personRoleLabel,
} from '../persons'

beforeAll(() => vi.stubEnv('TZ', 'America/Los_Angeles'))
afterAll(() => vi.unstubAllEnvs())

/*
  `/Persons/{name}` is keyed by the person's name, not their id, so every one of
  these strings ends up inside a URL path. Names carry spaces, accents,
  apostrophes, periods and — rarely but really — slashes and ampersands.
*/
describe('personRequestPath', () => {
  it('encodes the spaces and periods of an ordinary name', () => {
    expect(personRequestPath('Samuel L. Jackson')).toBe('/Persons/Samuel%20L.%20Jackson')
  })

  it('encodes non-ASCII rather than sending raw bytes', () => {
    expect(personRequestPath('Renée Zellweger')).toBe('/Persons/Ren%C3%A9e%20Zellweger')
  })

  it('leaves an apostrophe intact — it is legal in a path', () => {
    expect(personRequestPath("Peter O'Toole")).toBe("/Persons/Peter%20O'Toole")
  })

  it('encodes the characters that would otherwise end the path', () => {
    // A slash would invent a path segment; ? and # would start a query or a
    // fragment and drop the rest of the name on the floor.
    expect(personRequestPath('AC/DC')).toBe('/Persons/AC%2FDC')
    expect(personRequestPath('Who? Me#1')).toBe('/Persons/Who%3F%20Me%231')
  })

  it('has nothing to ask for when the name is missing or blank', () => {
    expect(personRequestPath(undefined)).toBeNull()
    expect(personRequestPath(null)).toBeNull()
    expect(personRequestPath('')).toBeNull()
    expect(personRequestPath('   ')).toBeNull()
  })

  /*
    The bug this repo already shipped once: a raw-interpolated "Fast & Furious"
    truncated the URL and left "Furious" behind as its own query parameter.
  */
  it('survives being resolved against the server base', () => {
    const url = new URL(buildUrl('http://s', personRequestPath('Bob & Carol')!))
    expect(url.pathname).toBe('/Persons/Bob%20%26%20Carol')
    expect(url.search).toBe('')
    expect(decodeURIComponent(url.pathname)).toBe('/Persons/Bob & Carol')
  })
})

describe('personHref', () => {
  it('points a credit at the person page, carrying the id and the credit', () => {
    expect(
      personHref({ Id: 'p1', Name: "Peter O'Toole", Type: 'Actor', Role: 'T. E. Lawrence' }),
    ).toBe("/person/Peter%20O'Toole?personIds=p1&kind=Actor&role=T.+E.+Lawrence")
  })

  it('encodes the name in the path, not just in the query', () => {
    const href = personHref({ Id: 'p2', Name: 'Renée Zellweger', Type: 'Actor' })
    expect(href).toBe('/person/Ren%C3%A9e%20Zellweger?personIds=p2&kind=Actor')
  })

  it('falls back to the filmography grid when a credit has no name to key on', () => {
    // Nameless credits cannot reach /Persons/{name}, but their id still filters
    // /browse, so the link keeps working rather than disappearing.
    expect(personHref({ Id: 'p3', Type: 'Director' })).toBe('/browse?personIds=p3&kind=Director')
  })

  it('is not a link at all with neither a name nor an id', () => {
    expect(personHref({})).toBeNull()
  })
})

describe('personRedirect', () => {
  it('sends the old filmography URL to the person page', () => {
    const to = personRedirect(new URLSearchParams('personIds=p1&name=Tom%20Hanks&kind=Actor'))
    expect(to).toBe('/person/Tom%20Hanks?personIds=p1&kind=Actor')
  })

  it('keeps the filters and sort the viewer had applied', () => {
    const to = personRedirect(new URLSearchParams('personIds=p1&name=Tom%20Hanks&sort=released'))
    expect(to).toBe('/person/Tom%20Hanks?personIds=p1&sort=released')
  })

  it('stays put when there is no name to key the person page on', () => {
    expect(personRedirect(new URLSearchParams('personIds=p1'))).toBeNull()
  })

  it('leaves every other kind of browse alone', () => {
    expect(personRedirect(new URLSearchParams('genreIds=g1&name=Comedy'))).toBeNull()
    expect(personRedirect(new URLSearchParams('parentId=b1&name=Alien'))).toBeNull()
  })

  it('does not bounce a person page back to itself', () => {
    // The person route renders the same grid, so a redirect that fired on its
    // own parameters would loop forever.
    const to = personRedirect(new URLSearchParams('personIds=p1&kind=Actor'))
    expect(to).toBeNull()
  })
})

describe('personRoleLabel', () => {
  it('names the credit the viewer arrived from', () => {
    expect(personRoleLabel({ kind: 'Actor', role: 'Ellen Ripley' })).toBe('Actor · as Ellen Ripley')
  })

  it('drops the character when there is none', () => {
    expect(personRoleLabel({ kind: 'Director' })).toBe('Director')
  })

  it('ignores the placeholder kinds a server sends when it does not know', () => {
    expect(personRoleLabel({ kind: 'Unknown' })).toBeNull()
    expect(personRoleLabel({ kind: 'Person', role: 'Herself' })).toBe('as Herself')
    expect(personRoleLabel({})).toBeNull()
  })

  it('does not repeat a role that only restates the kind', () => {
    // Servers routinely set Role to the job title, and "Director · as Director"
    // is noise.
    expect(personRoleLabel({ kind: 'Director', role: 'Director' })).toBe('Director')
  })
})

describe('personLifeline', () => {
  it('reads the day off the ISO string rather than the local clock', () => {
    expect(personLifeline({ PremiereDate: '1956-07-09T00:00:00.0000000Z' })).toBe('Born 9 July 1956')
  })

  it('gives a span and an age when the person has died', () => {
    expect(
      personLifeline({
        PremiereDate: '1956-07-09T00:00:00.0000000Z',
        EndDate: '2009-06-25T00:00:00.0000000Z',
      }),
    ).toBe('9 July 1956 – 25 June 2009 (aged 52)')
  })

  it('counts the birthday that had already passed', () => {
    expect(
      personLifeline({
        PremiereDate: '1932-08-25T00:00:00.0000000Z',
        EndDate: '1999-09-06T00:00:00.0000000Z',
      }),
    ).toBe('25 August 1932 – 6 September 1999 (aged 67)')
  })

  it('says what it knows when only the death date survived', () => {
    expect(personLifeline({ EndDate: '2009-06-25T00:00:00.0000000Z' })).toBe('Died 25 June 2009')
  })

  it('has nothing to say about a person with no dates', () => {
    expect(personLifeline({})).toBeNull()
    expect(personLifeline({ PremiereDate: '' })).toBeNull()
    expect(personLifeline({ PremiereDate: 'not a date' })).toBeNull()
  })
})

describe('personBirthplace', () => {
  it('takes the first production location', () => {
    expect(personBirthplace({ ProductionLocations: ['Concord, California, USA'] })).toBe(
      'Concord, California, USA',
    )
  })

  it('ignores an empty list or a blank entry', () => {
    expect(personBirthplace({ ProductionLocations: [] })).toBeNull()
    expect(personBirthplace({ ProductionLocations: ['  '] })).toBeNull()
    expect(personBirthplace({})).toBeNull()
  })
})

describe('personLinks', () => {
  it('offers the databases the server recorded ids for', () => {
    expect(personLinks({ ProviderIds: { Imdb: 'nm0000158', Tmdb: '31' } })).toEqual([
      { label: 'IMDb', href: 'https://www.imdb.com/name/nm0000158/' },
      { label: 'TMDB', href: 'https://www.themoviedb.org/person/31' },
    ])
  })

  it('offers nothing for a person nobody has matched to a database', () => {
    expect(personLinks({})).toEqual([])
    expect(personLinks({ ProviderIds: { Imdb: '' } })).toEqual([])
  })
})

describe('personBio', () => {
  it('is the overview, or nothing at all', () => {
    expect(personBio({ Overview: '  Grew up in Concord.  ' })).toBe('Grew up in Concord.')
    expect(personBio({ Overview: '   ' })).toBeNull()
    expect(personBio({})).toBeNull()
  })

  it('collapses only the biographies long enough to bury the filmography', () => {
    expect(bioIsLong('Grew up in Concord.')).toBe(false)
    expect(bioIsLong('a'.repeat(600))).toBe(true)
    expect(bioIsLong(null)).toBe(false)
  })
})

/*
  Minor cast are the common case: no photo, no biography, no dates. The old
  behaviour for them was `/browse?personIds=`, which is a perfectly good page —
  so the header collapses back to exactly that rather than reserving half the
  screen for a grey circle and a name.
*/
describe('personHeaderMode', () => {
  const bio = { Overview: 'Born in Concord, California…' }

  it('uses the portrait layout when there is a portrait', () => {
    expect(personHeaderMode(bio, true)).toBe('full')
  })

  it('drops the portrait column rather than showing a placeholder', () => {
    expect(personHeaderMode(bio, false)).toBe('text')
    expect(personHeaderMode({ PremiereDate: '1956-07-09T00:00:00Z' }, false)).toBe('text')
    expect(personHeaderMode({ ProductionLocations: ['Concord'] }, false)).toBe('text')
    expect(personHeaderMode({ ProviderIds: { Imdb: 'nm1' } }, false)).toBe('text')
  })

  it('collapses to the bare filmography when nothing is known', () => {
    expect(personHeaderMode({}, false)).toBe('compact')
    expect(personHeaderMode({ Overview: '   ' }, false)).toBe('compact')
  })

  it('still shows a portrait for someone with no other detail', () => {
    expect(personHeaderMode({}, true)).toBe('full')
  })
})

/*
  The pure function above says how a name should be encoded; this says the api
  method actually uses it. Without this pair, `/Persons/${name}` could be
  interpolated raw in api.ts and every test above would still pass.
*/
describe('api.person', () => {
  const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })

  const stubFetch = () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(String(url))
      return Promise.resolve(
        new Response(JSON.stringify({ Id: 'p1', Name: 'x' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    return urls
  }

  afterEach(() => vi.unstubAllGlobals())

  it('asks for the person by their encoded name, as this user', async () => {
    const urls = stubFetch()
    await api.person("Peter O'Toole")
    expect(urls).toEqual(["http://s/Persons/Peter%20O'Toole?userId=u"])
  })

  it('keeps an ampersand inside the path instead of splitting the URL', async () => {
    const urls = stubFetch()
    await api.person('Bob & Carol')
    expect(urls).toEqual(['http://s/Persons/Bob%20%26%20Carol?userId=u'])
  })

  it('refuses a blank name instead of fetching the whole person list', async () => {
    const urls = stubFetch()
    await expect(api.person('   ')).rejects.toThrow(/name/i)
    expect(urls).toEqual([])
  })
})
