/**
 * When things air, and on which day a person would say they air.
 *
 * `/Shows/Upcoming` answers the first question and leaves the second one
 * dangerous. Jellyfin keeps an episode's `PremiereDate` as an instant, but
 * almost every one of them is really a *date*: TVDB knows an episode goes out
 * on the 26th, not that it goes out at midnight UTC, and Jellyfin writes that
 * down as `2026-11-26T00:00:00Z`. Read back in local time west of Greenwich,
 * midnight UTC is the evening before — so the obvious implementation files
 * every episode on this server one day early for everyone in the Americas.
 *
 * A few premieres do carry a real time (`08:00:00Z`), and those must be
 * converted properly or a late-night broadcast lands on the wrong day the
 * other way. So the rule is: a premiere at exactly midnight UTC is a date and
 * is taken at face value; anything else is an instant and is converted.
 *
 * The viewer's offset is a parameter rather than something read here. Tests
 * would otherwise pass in CI, which runs in UTC, and fail for every user who
 * actually has the bug.
 */

/** Only the fields this module reads. `BaseItemDto` satisfies it. */
export interface ScheduleItem {
  Id?: string | null
  SeriesName?: string | null
  IndexNumber?: number | null
  ParentIndexNumber?: number | null
  PremiereDate?: string | null
  /** Jellyfin's marker for an item it knows about but does not hold. */
  LocationType?: string | null
  RunTimeTicks?: number | null
}

export interface DayGroup<T extends ScheduleItem = ScheduleItem> {
  /** `YYYY-MM-DD` in the viewer's timezone. Sorts correctly as a string. */
  key: string
  /** "Today", "Tomorrow", or "Sat 28 Nov". */
  label: string
  items: T[]
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const

const DAY_MS = 24 * 60 * 60 * 1000
const KEY = /^\d{4}-\d{2}-\d{2}$/

/**
 * A premiere recorded as a date rather than as a moment.
 *
 * Midnight exactly, in UTC. A show that genuinely goes out at midnight UTC is
 * indistinguishable and will be treated as a date — which is both the far
 * commoner case and the safer guess, since the date is what it would be
 * listed under anyway.
 */
export function isDateOnly(premiere: string): boolean {
  return /T00:00:00(\.0+)?Z$/i.test(premiere)
}

/** `YYYY-MM-DD` for an instant, as the clock reads at `tzOffsetMinutes`. */
export function dayKeyOf(epochMs: number, tzOffsetMinutes: number): string {
  const shifted = new Date(epochMs + tzOffsetMinutes * 60_000)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${month}-${day}`
}

/** The day an episode airs on, or null if there is no usable date. */
export function airDayKey(premiere: string | null | undefined, tzOffsetMinutes: number): string | null {
  if (!premiere) return null
  // Taken at face value: this is a date, and converting it would move it.
  if (isDateOnly(premiere)) {
    const date = premiere.slice(0, 10)
    return KEY.test(date) ? date : null
  }
  const ms = Date.parse(premiere)
  return Number.isNaN(ms) ? null : dayKeyOf(ms, tzOffsetMinutes)
}

/** Noon UTC on a day key — far enough from either edge to survive arithmetic. */
function noon(key: string): number {
  return Date.parse(`${key}T12:00:00Z`)
}

export function addDays(key: string, days: number): string {
  return dayKeyOf(noon(key) + days * DAY_MS, 0)
}

/**
 * What to call a day.
 *
 * Spelled out from fixed names rather than `toLocaleDateString`, because the
 * heading is a fixed part of a layout — a locale that renders "Saturday,
 * November 28, 2026" wraps the row — and because a test of a locale-dependent
 * string only tests the machine it ran on.
 */
export function dayLabel(key: string, todayKey: string): string {
  if (key === todayKey) return 'Today'
  if (key === addDays(todayKey, 1)) return 'Tomorrow'
  const date = new Date(noon(key))
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`
}

/** Is this episode on the server, or only known about? */
export function airStatus(item: ScheduleItem): 'have' | 'missing' {
  if (item.LocationType === 'Virtual') return 'missing'
  if (item.LocationType) return 'have'
  // Older servers leave the field off. A runtime is the next best evidence
  // that there is a file behind the entry.
  return item.RunTimeTicks ? 'have' : 'missing'
}

/**
 * Episodes gathered into the days they air on, soonest first.
 *
 * Days already gone are dropped: `/Shows/Upcoming` is generous around the
 * boundary, and a schedule whose first heading is last Tuesday reads as
 * broken rather than as thorough.
 */
export function groupByDay<T extends ScheduleItem>(
  items: readonly T[],
  tzOffsetMinutes: number,
  todayKey: string,
): DayGroup<T>[] {
  const days = new Map<string, T[]>()
  for (const item of items) {
    const key = airDayKey(item.PremiereDate, tzOffsetMinutes)
    if (key == null || key < todayKey) continue
    const bucket = days.get(key)
    if (bucket) bucket.push(item)
    else days.set(key, [item])
  }

  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, group]) => ({
      key,
      label: dayLabel(key, todayKey),
      // By series, then in episode order: two parts of the same show on one
      // night belong next to each other and the right way round.
      items: group.sort(
        (a, b) =>
          (a.SeriesName ?? '').localeCompare(b.SeriesName ?? '') ||
          (a.ParentIndexNumber ?? 0) - (b.ParentIndexNumber ?? 0) ||
          (a.IndexNumber ?? 0) - (b.IndexNumber ?? 0),
      ),
    }))
}

/** The groups falling inside the next `days` days, for the home row. */
export function withinDays<T extends ScheduleItem>(
  groups: readonly DayGroup<T>[],
  days: number,
  todayKey: string,
): DayGroup<T>[] {
  const last = addDays(todayKey, days)
  return groups.filter((group) => group.key <= last)
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

/** `2026-11-26` -> `2026-11`. */
export function monthKeyOf(dayKey: string): string {
  return dayKey.slice(0, 7)
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${year}`
}

export function addMonths(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  // Months counted from zero so the year rolls over by arithmetic rather than
  // by a branch per direction.
  const total = (year ?? 1970) * 12 + ((month ?? 1) - 1) + delta
  const nextMonth = String((total % 12) + 1).padStart(2, '0')
  return `${Math.floor(total / 12)}-${nextMonth}`
}

/**
 * A month as rows of seven days, Sunday first.
 *
 * The rows are whole weeks and run from the Sunday on or before the 1st to
 * the Saturday on or after the last — so the grid never has a ragged edge and
 * the 1st sits under the right weekday, which is the only thing a calendar
 * has to get right. Days spilling in from either side are real day keys, so a
 * cell can still show what airs on them and be drawn as outside the month.
 */
export function monthGrid(monthKey: string): string[][] {
  const first = `${monthKey}-01`
  const firstDow = new Date(noon(first)).getUTCDay()
  const start = addDays(first, -firstDow)

  const weeks: string[][] = []
  let cursor = start
  // Stops as soon as a week begins after the month ends: a trailing row with
  // nothing of this month in it is a row of noise.
  while (monthKeyOf(cursor) <= monthKey) {
    const week: string[] = []
    for (let i = 0; i < 7; i += 1) week.push(addDays(cursor, i))
    weeks.push(week)
    cursor = addDays(cursor, 7)
  }
  return weeks
}
