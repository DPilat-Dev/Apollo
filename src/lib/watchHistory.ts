import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { episodeCode } from './format'

/**
 * What this viewer has watched, as days rather than a list.
 *
 * The data has always been there — `useTasteProfile` has been asking for
 * exactly this list to build the home rows — it was just never shown to the
 * person it belongs to. Everything below is the shaping that turns 500 rows of
 * "an episode, at a timestamp" into something a person recognises as their own
 * week.
 *
 * Nothing here removes anything. `DELETE /UserPlayedItems/{id}` is the only
 * route out, and it does not delete history: it marks the item *unplayed*,
 * zeroing PlayCount and Played. That takes a finished series back off the
 * shelves, unfinishes it in Next Up, and changes the recommendations built
 * from played items — all from a button that says "remove from history". The
 * same reasoning already keeps `clearResumePosition` off that endpoint.
 */

/**
 * "When it was played" in the ItemSortBy enum. Confirmed against the server's
 * own OpenAPI document rather than guessed: the neighbouring values are
 * DateCreated and PremiereDate, and either of those produces a page that looks
 * like a plausible history while listing something else entirely.
 */
export const PLAYED_SORT_BY = 'DatePlayed'

export const HISTORY_PAGE_SIZE = 50

/**
 * Where paging stops regardless of what the server holds.
 *
 * Someone who has used their server for years has tens of thousands of played
 * episodes, and there is no reading of "scroll to 2019" that is worth the
 * unbounded DOM. Twenty pages is far past where anyone is still reading.
 */
export const HISTORY_MAX_ITEMS = HISTORY_PAGE_SIZE * 20

/** One page of "what this user watched, newest first". */
export function historyItemsQuery(startIndex: number) {
  return {
    // Episodes and films are the things a person watches. Series carry a
    // DatePlayed of their own, so including them would list a show once
    // alongside every one of its episodes.
    includeItemTypes: ['Movie', 'Episode'],
    recursive: true,
    isPlayed: true,
    sortBy: [PLAYED_SORT_BY],
    sortOrder: ['Descending'],
    startIndex,
    limit: HISTORY_PAGE_SIZE,
    fields: ['ParentId', 'PrimaryImageAspectRatio', 'ProductionYear'],
  }
}

/** The offset of the next page, or nothing when there is no next page. */
export function nextHistoryPage(loaded: number, total: number): number | undefined {
  if (loaded >= HISTORY_MAX_ITEMS) return undefined
  return loaded < total ? loaded : undefined
}

/** One row: a film, an episode, or a run of episodes watched back to back. */
export interface HistoryEntry {
  /** Stable across re-renders and unique within the page. */
  key: string
  /** The most recent item of the run — what the row shows and links to. */
  item: BaseItemDto
  /** When the newest item in the run was played, if the server knows. */
  playedAt: string | null
  /** How many episodes were folded in. 1 for everything else. */
  episodeCount: number
  /** "S2:E5", "S1:E1–E4", "3 episodes" — null for anything that is not an episode. */
  episodeLabel: string | null
  /** Where the row opens: a series for episodes, the item itself otherwise. */
  href: string | null
}

export interface HistoryDay {
  /** The local calendar day as `YYYY-MM-DD`, or `unknown`. */
  key: string
  label: string
  entries: HistoryEntry[]
}

interface GroupOptions {
  now?: Date
  /** Defaults to the runtime's own zone, which in a browser is the viewer's. */
  timeZone?: string
  locale?: string
}

const UNKNOWN_DAY = 'unknown'

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The calendar day an instant fell on *where the viewer was sitting*.
 *
 * Slicing the ISO string would be shorter and wrong: 22:30 in New York is
 * already tomorrow in UTC, so everything watched in the evening would file
 * under the following day. en-CA is used only because it formats as
 * `YYYY-MM-DD`, which sorts as a string.
 */
export function localDayKey(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/**
 * The calendar day before this one.
 *
 * Done as date arithmetic on the key rather than by subtracting 24 hours from
 * the instant, because the days either side of a DST change are 23 and 25
 * hours long and "yesterday" would land on the wrong date twice a year.
 */
function previousDayKey(key: string): string {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

function labelForDay(key: string, todayKey: string, locale: string | undefined): string {
  if (key === UNKNOWN_DAY) return 'Date unknown'
  if (key === todayKey) return 'Today'
  if (key === previousDayKey(todayKey)) return 'Yesterday'

  const [year, month, day] = key.split('-').map(Number)
  // Formatted as a UTC instant so the label is the calendar day itself, with
  // no second timezone conversion to shift it back off by one.
  const date = new Date(Date.UTC(year, month - 1, day))
  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4)
  return new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    // The weekday is what makes a recent date readable — "Monday, 4 May" is a
    // memory, "04/05/2026" is a receipt. It stops being useful once the year
    // is old enough to need saying, so it goes at the same time.
    ...(sameYear ? { weekday: 'long' as const } : { year: 'numeric' as const }),
    day: 'numeric',
    month: 'long',
  }).format(date)
}

/** "9:34 pm" in the viewer's own zone, for the right-hand column of a row. */
export function formatPlayedTime(
  playedAt: string | null | undefined,
  opts: { timeZone?: string; locale?: string } = {},
): string | null {
  const date = parseDate(playedAt)
  if (!date) return null
  return new Intl.DateTimeFormat(opts.locale, {
    timeZone: opts.timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

const seriesKeyOf = (item: BaseItemDto): string | null =>
  item.Type === 'Episode' ? (item.SeriesId ?? item.SeriesName ?? null) : null

/**
 * How a folded run of episodes describes itself.
 *
 * A contiguous run within one season is named as the range it is, because
 * "S1:E1–E4" is what the viewer did. Anything else — a gap, a season boundary
 * — is only a count, since a range spanning what was skipped would claim they
 * watched episodes they did not.
 */
function describeRun(run: BaseItemDto[]): string | null {
  if (run.length === 1) return episodeCode(run[0])
  if (run.length === 0) return null

  const seasons = new Set(run.map((i) => i.ParentIndexNumber))
  const numbers = run.map((i) => i.IndexNumber).filter((n): n is number => typeof n === 'number')
  const season = run[0].ParentIndexNumber

  if (seasons.size === 1 && season != null && numbers.length === run.length) {
    const low = Math.min(...numbers)
    const high = Math.max(...numbers)
    if (high - low + 1 === run.length) return `S${season}:E${low}–E${high}`
  }
  return `${run.length} episodes`
}

/** Where a row opens. An episode is a place inside a show, so it opens the show. */
function hrefFor(item: BaseItemDto): string | null {
  const id = item.Type === 'Episode' ? (item.SeriesId ?? item.Id) : item.Id
  return id ? `/item/${id}` : null
}

function toEntry(run: BaseItemDto[], dayKey: string): HistoryEntry {
  const [newest] = run
  return {
    key: `${dayKey}:${newest.Id ?? newest.Name ?? 'item'}`,
    item: newest,
    playedAt: parseDate(newest.UserData?.LastPlayedDate) ? newest.UserData!.LastPlayedDate! : null,
    episodeCount: run.length,
    episodeLabel: newest.Type === 'Episode' ? describeRun(run) : null,
    href: hrefFor(newest),
  }
}

/**
 * Watched items as days, newest first, with runs of one series' episodes
 * folded into a row each.
 *
 * The folding is deliberate and it is only ever *consecutive* episodes within
 * one day. A season watched over a weekend is twelve rows of the same poster
 * otherwise, and a history that is nine parts one show is not a history of
 * what you watched — but folding every episode of a series into one row would
 * be a summary rather than a record, and would move the film someone watched
 * in between out of the order they watched it in. Consecutive-only keeps the
 * page a true sequence while collapsing the one pattern that drowns it.
 */
export function groupWatchHistory(
  items: readonly BaseItemDto[],
  opts: GroupOptions = {},
): HistoryDay[] {
  const { timeZone, locale } = opts
  const todayKey = localDayKey(opts.now ?? new Date(), timeZone)

  const dated = items.map((item, index) => ({
    item,
    index,
    at: parseDate(item.UserData?.LastPlayedDate),
  }))

  // Newest first, with the undated held back rather than dropped — they were
  // watched, we just cannot say when. Ties and undated items keep the order
  // the server sent, so a stable sort is doing real work here.
  dated.sort((a, b) => {
    if (a.at && b.at) return b.at.getTime() - a.at.getTime() || a.index - b.index
    if (a.at) return -1
    if (b.at) return 1
    return a.index - b.index
  })

  const days: HistoryDay[] = []
  let current: { key: string; runs: BaseItemDto[][] } | null = null

  for (const { item, at } of dated) {
    const key = at ? localDayKey(at, timeZone) : UNKNOWN_DAY
    if (!current || current.key !== key) {
      current = { key, runs: [] }
      days.push({ key, label: labelForDay(key, todayKey, locale), entries: [] })
    }

    const series = seriesKeyOf(item)
    const lastRun = current.runs[current.runs.length - 1]
    const lastSeries = lastRun ? seriesKeyOf(lastRun[0]) : null
    if (series && lastRun && lastSeries === series) lastRun.push(item)
    else current.runs.push([item])

    days[days.length - 1].entries = current.runs.map((run) => toEntry(run, key))
  }

  return days
}

/**
 * A year of viewing as one grid of squares, the way a contribution graph does.
 *
 * The list below it answers "what did I watch on the 7th"; nothing on the page
 * answered "what does a year of this look like". The data is already loaded —
 * these are the same day keys the grouping made — so the picture costs a pass
 * over a map rather than a request.
 */
export interface HeatCell {
  /** `YYYY-MM-DD`, or null for a leading pad square before the first week. */
  key: string | null
  count: number
  /** 0–4, where 0 is a day with nothing on it. */
  level: number
}

export interface Heatmap {
  /** Columns of seven, Sunday at the top, oldest week first. */
  weeks: HeatCell[][]
  /** Month labels aligned to the column each month starts in. */
  months: { label: string; column: number }[]
  busiest: number
  totalDays: number
}

const DAY_MS = 86_400_000

/** Columns a month label needs to itself before the next one is drawn. */
const MONTH_LABEL_GAP = 3
const shiftDay = (key: string, days: number) =>
  new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)

/*
  Buckets rather than a gradient. Four steps is enough to read a shape at a
  glance, and scaling smoothly to the busiest day makes every ordinary day look
  identical whenever one binge sits at the top of the range.
*/
function levelFor(count: number, busiest: number): number {
  if (count <= 0) return 0
  if (busiest <= 1) return 1
  const share = count / busiest
  if (share > 0.66) return 4
  if (share > 0.33) return 3
  if (share > 0.1) return 2
  return 1
}

export function buildHeatmap(
  days: ReadonlyMap<string, number>,
  opts: { today: string; weeks?: number; locale?: string } = { today: '' },
): Heatmap {
  const weekCount = opts.weeks ?? 53
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.today)) {
    return { weeks: [], months: [], busiest: 0, totalDays: 0 }
  }

  // End on the Saturday of this week, so the final column is a whole one and
  // today never sits in a half-drawn week at the edge.
  const todayDow = new Date(`${opts.today}T12:00:00Z`).getUTCDay()
  const end = shiftDay(opts.today, 6 - todayDow)
  const start = shiftDay(end, -(weekCount * 7 - 1))

  let busiest = 0
  for (const [key, count] of days) {
    if (key >= start && key <= end && count > busiest) busiest = count
  }

  const weeks: HeatCell[][] = []
  const months: { label: string; column: number }[] = []
  const monthName = (key: string) =>
    new Intl.DateTimeFormat(opts.locale, { month: 'short', timeZone: 'UTC' }).format(
      new Date(`${key}T12:00:00Z`),
    )

  let seenMonth = ''
  let totalDays = 0
  for (let w = 0; w < weekCount; w++) {
    const column: HeatCell[] = []
    for (let d = 0; d < 7; d++) {
      const key = shiftDay(start, w * 7 + d)
      const count = days.get(key) ?? 0
      if (count > 0) totalDays += 1
      column.push({ key, count, level: levelFor(count, busiest) })
      /*
        Labelled from the first row only, so a month is named once — and only
        when there is room for the name. A window of this length can start one
        column before the next month begins, and the two labels then print on
        top of each other ("AuSep").
      */
      if (d === 0) {
        const month = key.slice(0, 7)
        if (month !== seenMonth) {
          seenMonth = month
          const previous = months[months.length - 1]
          if (!previous || w - previous.column >= MONTH_LABEL_GAP) {
            months.push({ label: monthName(key), column: w })
          }
        }
      }
    }
    weeks.push(column)
  }

  return { weeks, months, busiest, totalDays }
}

/** What a day amounted to: "4 episodes across 2 shows", and roughly how long. */
export function summariseDay(day: HistoryDay): string {
  const episodes = day.entries.reduce((n, e) => n + (e.episodeLabel ? e.episodeCount : 0), 0)
  const films = day.entries.filter((e) => !e.episodeLabel).length
  const shows = new Set(day.entries.filter((e) => e.episodeLabel).map((e) => e.key.split(':')[0]))

  const parts: string[] = []
  if (episodes > 0) {
    parts.push(`${episodes} episode${episodes === 1 ? '' : 's'}`)
    // Only worth saying when it was more than one; "across 1 show" is noise.
    if (shows.size > 1) parts.push(`across ${shows.size} shows`)
  }
  if (films > 0) parts.push(`${films} film${films === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

export type HistoryFilter = 'all' | 'shows' | 'films'

/**
 * Narrow the days to one kind of thing.
 *
 * Days that empty out are dropped rather than left as a heading with nothing
 * under it — an empty date reads as a bug, not as "no films that day".
 */
export function filterHistory(days: readonly HistoryDay[], filter: HistoryFilter): HistoryDay[] {
  if (filter === 'all') return [...days]
  const wantEpisodes = filter === 'shows'
  return days
    .map((day) => ({
      ...day,
      entries: day.entries.filter((e) => Boolean(e.episodeLabel) === wantEpisodes),
    }))
    .filter((day) => day.entries.length > 0)
}
