/**
 * People — the actor, director or writer behind a credit.
 *
 * Everything about a person is keyed by their *name*: `/Persons/{name}` is the
 * only way to reach a biography, and the name goes in the path. Names are the
 * worst possible path segment — spaces, accents, apostrophes, periods, the
 * occasional slash — and this app has already shipped one bug of exactly this
 * shape, where an unescaped "Fast & Furious" cut a URL in half and left the
 * tail behind as a stray query parameter. So no name is ever interpolated into
 * a URL anywhere else in the app; it goes through the functions here, which can
 * be checked against those characters without a server.
 *
 * Names are also not unique, which is why a credit's id travels alongside the
 * name rather than being looked up from it: the id names the exact person whose
 * chip was clicked, while `/Persons/{name}` answers with whichever one the
 * server matched first.
 */

/** A credit as it appears in `item.People`. */
export interface PersonCredit {
  Id?: string | null
  Name?: string | null
  /** The `PersonKind` — Actor, Director, Writer… */
  Type?: string | null
  /** The character, for an acting credit. */
  Role?: string | null
}

/** The person themselves, as `/Persons/{name}` returns them. */
export interface PersonDetails {
  Id?: string | null
  Name?: string | null
  Overview?: string | null
  /** Jellyfin stores a person's birth date here. */
  PremiereDate?: string | null
  /** …and their death date here, where one is known. */
  EndDate?: string | null
  /** Birthplace, as a one-element list. */
  ProductionLocations?: string[] | null
  ProviderIds?: Record<string, string | null | undefined> | null
  ImageTags?: Record<string, string> | null
}

const clean = (value: string | null | undefined): string | null => {
  const trimmed = (value ?? '').trim()
  return trimmed || null
}

/**
 * The API path for one person, or null when there is no name to ask about.
 *
 * `encodeURIComponent` rather than a template literal: it is the only thing
 * standing between a name like "AC/DC" and a request for a person called "AC"
 * inside a folder called "DC".
 */
export function personRequestPath(name: string | null | undefined): string | null {
  const trimmed = clean(name)
  return trimmed ? `/Persons/${encodeURIComponent(trimmed)}` : null
}

/** The in-app route for a person, built from a name and whatever else we know. */
function personPath(name: string, params: URLSearchParams): string {
  const query = params.toString()
  return `/person/${encodeURIComponent(name)}${query ? `?${query}` : ''}`
}

/**
 * Where a cast or crew chip leads.
 *
 * The id and the credit ride along in the query: the id because it identifies
 * this exact person where the name may be shared, and the credit because "as
 * Ellen Ripley" is the fact that made someone click.
 *
 * A credit with no name cannot reach a person page at all, so it keeps the
 * filmography grid it has always had rather than losing its link.
 */
export function personHref(person: PersonCredit): string | null {
  const name = clean(person.Name)
  const id = clean(person.Id)
  const kind = clean(person.Type)
  const role = clean(person.Role)

  if (!name) {
    if (!id) return null
    const params = new URLSearchParams({ personIds: id })
    if (kind) params.set('kind', kind)
    return `/browse?${params.toString()}`
  }

  const params = new URLSearchParams()
  if (id) params.set('personIds', id)
  if (kind) params.set('kind', kind)
  if (role) params.set('role', role)
  return personPath(name, params)
}

/**
 * Whether `/browse` should hand a request over to the person page.
 *
 * `/browse?personIds=…&name=…` was the only person view this app had, and those
 * links are in browser histories and shared messages. Rather than keeping two
 * pages that show the same grid, the old URL redirects into the new one, which
 * *is* that grid with a header above it — see `Person`.
 *
 * Returns null without a name, because a person page cannot be keyed without
 * one, and null on the person route's own parameters, which is what stops the
 * redirect from looping.
 */
export function personRedirect(params: URLSearchParams): string | null {
  const id = clean(params.get('personIds'))
  const name = clean(params.get('name'))
  if (!id || !name) return null

  const rest = new URLSearchParams(params)
  rest.delete('name')
  return personPath(name, rest)
}

/**
 * Kinds a server sends when it has not decided what someone did. Showing them
 * as a heading tells the viewer nothing they cannot see for themselves.
 */
const VAGUE_KINDS = new Set(['', 'Unknown', 'Person'])

/** "Actor · as Ellen Ripley" — the credit that brought you here. */
export function personRoleLabel(credit: { kind?: string | null; role?: string | null }): string | null {
  const kind = clean(credit.kind)
  const role = clean(credit.role)
  const shown = kind && !VAGUE_KINDS.has(kind) ? kind : null
  // Libraries routinely fill Role with the job title, and "Director · as
  // Director" is noise rather than information.
  const character = role && role.toLowerCase() !== shown?.toLowerCase() ? role : null

  if (shown && character) return `${shown} · as ${character}`
  if (shown) return shown
  return character ? `as ${character}` : null
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

interface Day {
  year: number
  month: number
  day: number
}

/**
 * The calendar day out of an ISO timestamp, read as text.
 *
 * Deliberately not `new Date(...)`: a birth date arrives as midnight UTC, and
 * every local-time getter reports the day before it for anyone west of
 * Greenwich. A date of birth has no time of day to convert.
 */
function isoDay(value: string | null | undefined): Day | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value ?? '')
  if (!match) return null
  const [, year, month, day] = match
  const parsed = { year: Number(year), month: Number(month), day: Number(day) }
  if (parsed.month < 1 || parsed.month > 12 || parsed.day < 1 || parsed.day > 31) return null
  return parsed
}

const formatDay = (day: Day) => `${day.day} ${MONTHS[day.month - 1]} ${day.year}`

const yearsBetween = (from: Day, to: Day) => {
  const hadBirthday = to.month > from.month || (to.month === from.month && to.day >= from.day)
  return to.year - from.year - (hadBirthday ? 0 : 1)
}

/** "Born 9 July 1956" / "9 July 1956 – 25 June 2009 (aged 52)" / "Died …". */
export function personLifeline(person: PersonDetails): string | null {
  const born = isoDay(person.PremiereDate)
  const died = isoDay(person.EndDate)

  if (born && died) return `${formatDay(born)} – ${formatDay(died)} (aged ${yearsBetween(born, died)})`
  if (born) return `Born ${formatDay(born)}`
  return died ? `Died ${formatDay(died)}` : null
}

export function personBirthplace(person: PersonDetails): string | null {
  return clean(person.ProductionLocations?.[0])
}

/**
 * Outward links, matching how `Ratings` treats a film's provider ids.
 *
 * These carry most of the weight for someone the library knows nothing about:
 * a bare name and a filmography plus "IMDb" is a page that still answers the
 * question the viewer came with.
 */
export function personLinks(person: PersonDetails): { label: string; href: string }[] {
  const ids = person.ProviderIds ?? {}
  const links: { label: string; href: string }[] = []
  const imdb = clean(ids.Imdb)
  const tmdb = clean(ids.Tmdb)
  if (imdb) links.push({ label: 'IMDb', href: `https://www.imdb.com/name/${imdb}/` })
  if (tmdb) links.push({ label: 'TMDB', href: `https://www.themoviedb.org/person/${tmdb}` })
  return links
}

export function personBio(person: PersonDetails): string | null {
  return clean(person.Overview)
}

/**
 * Roughly five lines at the width a biography renders in.
 *
 * TMDB biographies run to a thousand words for anyone famous, and left whole
 * they push the filmography — the reason most people open the page — clean off
 * the bottom of the screen. Shorter ones are left alone: a "Read more" that
 * reveals half a line is a worse thing than the half line.
 */
const LONG_BIO_CHARS = 420

export function bioIsLong(bio: string | null | undefined): boolean {
  return (bio?.length ?? 0) > LONG_BIO_CHARS
}

/**
 * How much header a person has earned.
 *
 * Minor cast — most of any cast list — have no photo, no biography and no
 * dates, and a page that reserves half the screen for a grey circle beside a
 * name is worse than what they had before. So this degrades in two steps: drop
 * the portrait column when there is no portrait, and drop the header entirely
 * when there is nothing to put in it, leaving the filmography that was always
 * the useful part of `/browse?personIds=`.
 */
export type PersonHeaderMode = 'full' | 'text' | 'compact'

export function personHeaderMode(person: PersonDetails, hasPhoto: boolean): PersonHeaderMode {
  if (hasPhoto) return 'full'
  const hasFacts =
    Boolean(personBio(person)) ||
    Boolean(personLifeline(person)) ||
    Boolean(personBirthplace(person)) ||
    personLinks(person).length > 0
  return hasFacts ? 'text' : 'compact'
}
