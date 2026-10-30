/**
 * What a request dialog needs to decide, with no document involved.
 *
 * Requesting used to be one press: hover a Jellyseerr card, press Request, and
 * it went. For a film that is the whole interaction and still is. For a series
 * it was a press with a hidden argument — the seasons came from a Settings
 * toggle, "Request whole series", which sent either every season or season one
 * and nothing in between. There was no way to ask for seasons 3 to 5, and no
 * way to see what was about to be asked for.
 *
 * The decisions that fell out of that are here rather than in the dialog,
 * because tests in this project run in Node with no DOM: which seasons are
 * worth offering, which are already spoken for, what is ticked when the dialog
 * opens, and what the button and the live region say.
 *
 * Jellyseerr answers two separate questions about a season and both matter.
 * `seasons` on the TMDB details is what *exists* — number, name, episode count,
 * air date. `mediaInfo.seasons` is what this server has *done about it* — a
 * status per season, absent for every season nobody has touched. Offering a
 * season without reading the second list is how a dialog ends up asking for
 * three seasons that are already sitting in the library.
 */

import { MediaStatus } from './jellyseerr'

/** A season as TMDB describes it, through Jellyseerr. */
export interface SeerrSeason {
  id: number
  seasonNumber: number
  name?: string
  overview?: string
  episodeCount?: number
  airDate?: string | null
  posterPath?: string | null
}

/** A season as this Jellyseerr install has dealt with it. */
export interface SeerrSeasonState {
  seasonNumber: number
  status?: number
}

/**
 * The seasons worth putting in front of somebody, in the order they read.
 *
 * Specials go last. They are season 0, so they sort first by number and are
 * almost never what somebody opened the dialog to ask for — a list that opens
 * on "Specials" buries season one under it.
 *
 * A season with an episode count of exactly zero is dropped. TMDB carries
 * announced seasons that have no episodes yet, Jellyseerr will accept a request
 * for one, and Sonarr then has nothing to fetch — so the row offers a request
 * that cannot finish. A season with no count *at all* is kept, because that is
 * missing data rather than an empty season, and dropping those would hide real
 * seasons on sparsely-catalogued shows.
 */
export function listedSeasons(seasons: SeerrSeason[] | undefined): SeerrSeason[] {
  return (seasons ?? [])
    .filter((s) => s.episodeCount !== 0)
    .sort((a, b) => rank(a.seasonNumber) - rank(b.seasonNumber))
}

/** Specials sort after everything, by number within the rest. */
const rank = (seasonNumber: number) =>
  seasonNumber === 0 ? Number.MAX_SAFE_INTEGER : seasonNumber

/**
 * What this install has done about one season.
 *
 * A season missing from `mediaInfo.seasons` is not an unknown — it is a season
 * nobody has asked for, which is the ordinary requestable state. Jellyseerr's
 * own enum spells that `UNKNOWN`, which reads like an error and is not one.
 */
export function seasonStatusOf(
  states: SeerrSeasonState[] | undefined,
  seasonNumber: number,
): number {
  const found = states?.find((s) => s.seasonNumber === seasonNumber)
  return found?.status ?? MediaStatus.UNKNOWN
}

/**
 * Whether asking for this season would achieve anything.
 *
 * The same call `availability` makes for a whole title, for the same reason:
 * partly available means episodes are missing, and asking again is how they
 * arrive. Already here, already coming and already asked for are all refused.
 */
export function seasonSelectable(status: number): boolean {
  return status === MediaStatus.UNKNOWN || status === MediaStatus.PARTIALLY_AVAILABLE
}

/**
 * A season's row: whether it can be ticked, and the note that says why not.
 *
 * A disabled checkbox with no explanation is the version of this that gets
 * reported as a bug — "it won't let me pick season 2" is true, and the reason
 * is that season 2 is already in the library.
 */
export function seasonState(status: number): { note: string | null; selectable: boolean } {
  switch (status) {
    case MediaStatus.AVAILABLE:
      return { note: 'In library', selectable: false }
    case MediaStatus.PROCESSING:
      return { note: 'Downloading', selectable: false }
    case MediaStatus.PENDING:
      return { note: 'Requested', selectable: false }
    case MediaStatus.PARTIALLY_AVAILABLE:
      return { note: 'Some episodes here', selectable: true }
    default:
      return { note: null, selectable: true }
  }
}

/**
 * What to call a season.
 *
 * TMDB gives most seasons the name "Season 4", which is the number we are
 * already printing — so its name is used only where it is actually a name,
 * like Avatar's "Book One: Water".
 */
export function seasonTitle(season: SeerrSeason): string {
  const numbered = season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`
  if (!season.name || season.name === numbered) return numbered
  return season.name
}

/** Episode count and year, for the line under the season's name. */
export function seasonSublabel(season: SeerrSeason): string {
  const parts: string[] = []
  if (season.episodeCount) {
    parts.push(`${season.episodeCount} episode${season.episodeCount === 1 ? '' : 's'}`)
  }
  if (season.airDate) parts.push(season.airDate.slice(0, 4))
  return parts.join(' · ')
}

/**
 * What is ticked when the dialog opens.
 *
 * The Settings toggle keeps its meaning and stops being the only answer: on,
 * every season worth asking for is ticked; off, just the first one.
 *
 * "The first" is the first *askable* season, not literally season one. On a
 * show whose season one is already in the library, ticking season one would
 * pre-select a box the dialog has to disable in the same breath.
 *
 * Specials are never ticked for you either way. They are listed so somebody
 * who wants them can say so, but "request the whole series" is not a request
 * for the Christmas episode.
 */
export function defaultSeasonSelection(
  listed: SeerrSeason[],
  states: SeerrSeasonState[] | undefined,
  wholeSeries: boolean,
): number[] {
  const askable = listed
    .filter((s) => s.seasonNumber !== 0)
    .filter((s) => seasonSelectable(seasonStatusOf(states, s.seasonNumber)))
    .map((s) => s.seasonNumber)

  return wholeSeries ? askable : askable.slice(0, 1)
}

/** Tick or untick one season, kept in order. */
export function toggleSeason(selected: number[], seasonNumber: number): number[] {
  const without = selected.filter((n) => n !== seasonNumber)
  if (without.length !== selected.length) return without
  return [...selected, seasonNumber].sort((a, b) => a - b)
}

/**
 * Whether there is anything left to ask for.
 *
 * Deliberately false for a show with no seasons listed: that is a show we know
 * nothing about, and the dialog must not tell somebody it is already in their
 * library on the strength of an empty list.
 */
export function nothingRequestable(
  listed: SeerrSeason[],
  states: SeerrSeasonState[] | undefined,
): boolean {
  if (listed.length === 0) return false
  return listed.every((s) => !seasonSelectable(seasonStatusOf(states, s.seasonNumber)))
}

/** The request button, which says what it is about to do. */
export function requestLabel(count: number): string {
  if (count === 0) return 'Select a season'
  return `Request ${count} season${count === 1 ? '' : 's'}`
}

/**
 * What the live region says once the request is away.
 *
 * The seasons are named rather than counted. "Requested 2 seasons" and
 * "Requested seasons 2 and 3" are different facts, and after picking boxes by
 * hand the one worth hearing back is which boxes went.
 */
export function requestedAnnouncement(seasons: number[]): string {
  if (seasons.length === 0) return 'Requested.'

  const numbered = seasons.filter((n) => n !== 0)
  const parts: string[] = []

  // Specials are not season 0 in a sentence, and they do not take the plural
  // from the numbered seasons sitting next to them: "specials and season 1".
  if (seasons.includes(0)) parts.push('specials')
  if (numbered.length === 1) parts.push(`season ${numbered[0]}`)
  else if (numbered.length > 1) parts.push(`seasons ${joinAnd(numbered.map(String))}`)

  return `Requested ${joinAnd(parts)}.`
}

/** "a", "a and b", "a, b and c" — the last separator is a word, not a comma. */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** A film's length. Null rather than "0m" for a runtime nobody recorded. */
export function runtimeText(minutes: number | undefined): string | null {
  if (!minutes) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (!hours) return `${rest}m`
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

export function seasonCountLabel(count: number | undefined): string | null {
  if (!count) return null
  return `${count} season${count === 1 ? '' : 's'}`
}

/**
 * The line under the title: year, length or season count, score.
 *
 * TMDB answers 0 for a title nobody has scored, which is a missing score
 * rather than a score of zero — printed, it calls every unrated film the worst
 * film on the server.
 */
export function metaLine(details: {
  year?: string | null
  runtime?: number
  seasons?: number
  voteAverage?: number
}): string {
  const parts = [
    details.year ?? null,
    runtimeText(details.runtime),
    seasonCountLabel(details.seasons),
    details.voteAverage ? details.voteAverage.toFixed(1) : null,
  ]
  return parts.filter(Boolean).join(' · ')
}
