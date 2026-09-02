import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { TICKS_PER_SECOND } from './format'
import { historyItemsQuery, localDayKey } from './watchHistory'

/**
 * A year of viewing, totalled up — the end-of-year recap.
 *
 * Two things here are load-bearing and neither is obvious from the screen it
 * produces.
 *
 * The first is that the server cannot answer the question. `/Items` will filter
 * on `minDateLastSaved` (when the *record* was written) and on `years` (the
 * production year of the film), and neither of those is "watched during 2026".
 * Checked against this server's own OpenAPI document rather than assumed. So
 * the year is assembled on the client by walking played items newest-first and
 * stopping the moment the walk crosses into the year before — that early exit
 * is the only reason this is a handful of requests instead of the whole
 * library.
 *
 * The second is that Jellyfin does not record how long anyone watched
 * anything. An item carries a runtime, a play count, and one LastPlayedDate.
 * Everything below that looks like "hours watched" is arithmetic over the
 * runtimes of things marked played, and the page has to say so — see
 * `ESTIMATE_CAVEAT`. Someone who marked a series watched to clear it off the
 * shelf inflates this, and nothing in the data can tell us they did.
 */

/** Where the recap lives. Exported so the button and the route cannot disagree. */
export const RECAP_HREF = '/recap'

/** How many entries a "top" list holds. Every one of them degrades below this. */
export const TOP_N = 5

/**
 * A bigger page than the history list uses, because nothing is rendered per
 * page here — the whole year is one screen of totals, so the cost is requests
 * rather than DOM.
 */
export const RECAP_PAGE_SIZE = 200

/**
 * Where the walk stops regardless of what it has found.
 *
 * The early exit depends on reading a date. A library whose LastPlayedDate is
 * missing or unparseable throughout never crosses the start of the year, and
 * without a ceiling that walks every played item on the server. Ten requests
 * is far past a plausible year of viewing.
 */
export const RECAP_MAX_ITEMS = RECAP_PAGE_SIZE * 10

/**
 * The sentence the page must carry next to the headline number.
 *
 * It lives here rather than in the JSX so that deleting it breaks a test. A
 * derived guess presented as a measured fact is the failure this whole feature
 * is one edit away from.
 */
export const ESTIMATE_CAVEAT =
  'An estimate: Jellyfin records what you finished and how long it runs, never how long you actually watched.'

/** One page of the walk — the history request, plus the genres it doesn't need. */
export function recapItemsQuery(startIndex: number) {
  const base = historyItemsQuery(startIndex)
  return {
    ...base,
    limit: RECAP_PAGE_SIZE,
    // Genres are not on the default projection. Without asking, the top-genres
    // panel is empty on every server rather than only on the ones with no
    // genre metadata, and the two look identical from the outside.
    fields: [...base.fields, 'Genres'],
    // Nothing on the recap is a picture, and this walk is the widest request
    // the app makes — up to ten pages of two hundred. Image tags on all of that
    // is payload for a page that renders none of it.
    enableImages: false,
  }
}

function parsePlayedDate(item: BaseItemDto): Date | null {
  const value = item.UserData?.LastPlayedDate
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** The year an item was played in, on the viewer's clock. */
function playedYear(item: BaseItemDto, timeZone: string | undefined): number | null {
  const date = parsePlayedDate(item)
  return date ? Number(localDayKey(date, timeZone).slice(0, 4)) : null
}

export interface RecapSeason {
  year: number
  label: string
}

/**
 * Which year to recap, and whether to offer one at all.
 *
 * December and January only, and in January it is still the year that just
 * ended — a recap of three weeks is not a recap. The consequence worth naming
 * is that the answer does not change at midnight on New Year's Eve: the page
 * someone was reading at 23:59 is the same page at 00:01.
 *
 * The month is read on the viewer's clock, never UTC, for the same reason the
 * history page's day headings are: the first of December in London is the
 * thirtieth of November in Los Angeles, and the button appearing a day early
 * for half the world is the bug this prevents.
 */
export function recapSeason(now: Date, timeZone?: string): RecapSeason | null {
  const key = localDayKey(now, timeZone)
  const year = Number(key.slice(0, 4))
  const month = Number(key.slice(5, 7))

  if (month === 12) return { year, label: `${year} in review` }
  if (month === 1) return { year: year - 1, label: `${year - 1} in review` }
  return null
}

/** Whether the first page of history can prove there is nothing to recap. */
export type RecapProbe = 'none' | 'possible'

/**
 * A cheap "is this worth offering" read on one page of played items.
 *
 * A brand-new account in December must not be handed a ceremony of zeros, but
 * finding out properly means the whole walk, and the home page is not paying
 * for that in every December render. One page settles the two cases that
 * matter: an account that has played nothing at all, and one whose most recent
 * viewing already predates the year.
 *
 * The page is sorted newest-first, so an item older than the year proves every
 * remaining page is older still. Everything else is `possible` — in January the
 * newest page is often nothing but this year's viewing, which says nothing
 * either way, and a probe that guessed there would hide a real recap.
 */
export function recapProbe(
  items: readonly BaseItemDto[],
  year: number,
  timeZone?: string,
): RecapProbe {
  if (items.length === 0) return 'none'

  for (const item of items) {
    const played = playedYear(item, timeZone)
    if (played === null) continue
    if (played === year) return 'possible'
    if (played < year) return 'none'
  }

  return 'possible'
}

export interface RecapLink {
  year: number
  label: string
  href: string
}

/**
 * The seasonal entry point, as a single answer the calling component cannot
 * second-guess.
 *
 * Everything the button decides is here: whether it is the season, which year
 * it names, where it goes, and whether there is anything behind it. A `null`
 * means the markup is absent — not hidden, not dimmed. `undefined` probe items
 * mean the answer has not arrived yet, and nothing is drawn until it has, so
 * the link never appears for a beat and then leaves.
 */
export function recapButton(opts: {
  now: Date
  timeZone?: string
  probeItems: readonly BaseItemDto[] | undefined
}): RecapLink | null {
  const season = recapSeason(opts.now, opts.timeZone)
  if (!season) return null
  if (!opts.probeItems) return null
  if (recapProbe(opts.probeItems, season.year, opts.timeZone) === 'none') return null

  return { year: season.year, label: season.label, href: RECAP_HREF }
}

/**
 * Whether to ask the server for another page.
 *
 * The stopping condition is the early exit: once anything loaded was played
 * before the target year, the descending sort guarantees the rest is older
 * too. The cap and the server's own total are the other two ways out.
 */
export function nextRecapPage(
  loadedItems: readonly BaseItemDto[],
  opts: { year: number; total: number; timeZone?: string },
): number | undefined {
  const loaded = loadedItems.length
  if (loaded >= RECAP_MAX_ITEMS) return undefined
  if (loaded >= opts.total) return undefined

  const crossed = loadedItems.some((item) => {
    const played = playedYear(item, opts.timeZone)
    return played !== null && played < opts.year
  })

  return crossed ? undefined : loaded
}

export interface RecapCount {
  /** Stable identity for a React key — a series id, or the genre itself. */
  key: string
  label: string
  count: number
}

export interface RecapDay {
  /** `YYYY-MM-DD` on the viewer's clock. */
  key: string
  label: string
  count: number
}

export interface RecapStats {
  year: number
  /** Films and episodes played during the year. */
  itemCount: number
  movieCount: number
  episodeCount: number
  /** Distinct shows, not episodes. */
  seriesCount: number
  /** Runtimes added up. Read `ESTIMATE_CAVEAT` before showing this. */
  estimatedMinutes: number
  /** Played items the server has no runtime for, so they contributed nothing. */
  itemsWithoutRuntime: number
  /** Played items with no readable date, so they belong to no year. */
  undatedCount: number
  topShows: RecapCount[]
  topGenres: RecapCount[]
  busiestDay: RecapDay | null
  /** Twelve counts, January first, for the shape of the year. */
  months: number[]
  /** The walk hit its ceiling, so every number above is a floor. */
  truncated: boolean
}

const TICKS_PER_MINUTE = TICKS_PER_SECOND * 60

/** Highest first, ties broken by name so the order is stable between renders. */
function rank(counts: Map<string, { label: string; count: number }>): RecapCount[] {
  return [...counts.entries()]
    .map(([key, value]) => ({ key, ...value }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, TOP_N)
}

function bump(counts: Map<string, { label: string; count: number }>, key: string, label: string) {
  const existing = counts.get(key)
  if (existing) existing.count += 1
  else counts.set(key, { label, count: 1 })
}

/** "Saturday, 14 March" — the day itself, with no second timezone shift. */
function labelForDay(key: string, locale: string | undefined): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day)))
}

/**
 * Everything the recap page shows, from the items the walk collected.
 *
 * The year filter lives here rather than in the fetch because the fetch
 * deliberately overshoots: in January it walks back through the current year to
 * reach the previous one, so the list arriving here is always wider than the
 * year being described.
 *
 * Runtimes are counted once per item however many times PlayCount says it was
 * played. PlayCount is a lifetime total pinned to a single LastPlayedDate — a
 * comfort film rewatched every Christmas since 2019 carries a count of seven
 * and one date, and multiplying by it would file six evenings from other years
 * under this one. One play each is the floor, and a floor is the only claim the
 * data supports.
 */
export function summariseYear(
  items: readonly BaseItemDto[],
  year: number,
  opts: { timeZone?: string; locale?: string } = {},
): RecapStats {
  const { timeZone, locale } = opts

  const shows = new Map<string, { label: string; count: number }>()
  const genres = new Map<string, { label: string; count: number }>()
  const days = new Map<string, number>()
  const series = new Set<string>()
  const months = Array.from({ length: 12 }, () => 0)

  let itemCount = 0
  let movieCount = 0
  let episodeCount = 0
  let runtimeTicks = 0
  let itemsWithoutRuntime = 0
  let undatedCount = 0

  for (const item of items) {
    const played = parsePlayedDate(item)
    if (!played) {
      undatedCount += 1
      continue
    }

    const dayKey = localDayKey(played, timeZone)
    if (Number(dayKey.slice(0, 4)) !== year) continue

    itemCount += 1
    months[Number(dayKey.slice(5, 7)) - 1] += 1
    days.set(dayKey, (days.get(dayKey) ?? 0) + 1)

    if (item.RunTimeTicks) runtimeTicks += item.RunTimeTicks
    else itemsWithoutRuntime += 1

    if (item.Type === 'Episode') {
      episodeCount += 1
      const key = item.SeriesId ?? item.SeriesName
      if (key) {
        series.add(key)
        bump(shows, key, item.SeriesName ?? 'Unknown show')
      }
    } else {
      movieCount += 1
    }

    // Nothing invented for an item with no genres. Plenty of libraries carry
    // none at all, and a panel reading "Unknown ×40" describes the metadata
    // rather than the viewer.
    for (const genre of item.Genres ?? []) bump(genres, genre, genre)
  }

  const busiest = [...days.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]

  return {
    year,
    itemCount,
    movieCount,
    episodeCount,
    seriesCount: series.size,
    estimatedMinutes: Math.round(runtimeTicks / TICKS_PER_MINUTE),
    itemsWithoutRuntime,
    undatedCount,
    topShows: rank(shows),
    topGenres: rank(genres),
    busiestDay: busiest
      ? { key: busiest[0], label: labelForDay(busiest[0], locale), count: busiest[1] }
      : null,
    months,
    truncated: items.length >= RECAP_MAX_ITEMS,
  }
}

/**
 * Whether this year is worth a ceremony.
 *
 * The counterpart to `recapProbe`, which only ever had one page to go on. By
 * the time the whole walk is in we know for certain, and a year with nothing in
 * it gets a sentence rather than a wall of zeros — a first December on a new
 * server is exactly when someone is most likely to press the link.
 */
export function hasRecap(stats: RecapStats): boolean {
  return stats.itemCount > 0
}

/** "18 hours" / "1 hr 40 min" — the headline, and it is always an estimate. */
export function formatEstimatedTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours >= 24) return `${hours.toLocaleString()} hours`
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`
}
