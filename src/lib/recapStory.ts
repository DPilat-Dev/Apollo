import type { PosterRef, RecapStats } from './yearRecap'

/**
 * The recap as a sequence of full-screen cards, before it is a page.
 *
 * A page of panels is a report. The same numbers dealt out one at a time, each
 * given a whole screen and a moment, is the thing people actually share — and
 * it costs nothing extra to fetch, because it is the same `RecapStats` the
 * page already builds.
 *
 * Which cards a year earns is decided here rather than by conditions scattered
 * through the view. A sparse year must not be walked through five screens that
 * say nothing; the run gets shorter instead.
 */

export type StoryKind =
  | 'opening'
  | 'time'
  | 'count'
  | 'topShow'
  | 'shows'
  | 'biggestDay'
  | 'habits'
  | 'genre'
  | 'closing'

export interface StorySlide {
  kind: StoryKind
  /** Small line above the headline. */
  eyebrow?: string
  /** The one thing this card is about. */
  headline: string
  /*
    A number to count up to. Only ever set where the headline *is* that number
    — a card whose headline is a date or "5 days" must not have its words
    replaced by the bare figure, which is what happened the first time.
  */
  countTo?: number
  /** Read under the headline. */
  detail?: string
  /** Art for the card, where the fact has a face. */
  poster?: PosterRef
  posters?: PosterRef[]
}

/** How long a card holds before the next one, when it advances on its own. */
export const SLIDE_MS = 4200

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const WEEKDAY_NAMES = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
]

/**
 * The cards this year has earned, in order.
 *
 * Every card past the opening is conditional on the fact it exists to show.
 * The alternative — a fixed run with "0 episodes" and "no favourite day" in it
 * — reads as the software failing rather than as a quiet year.
 */
export function storySlides(
  stats: RecapStats,
  opts: { monthName?: (monthIndex: number) => string } = {},
): StorySlide[] {
  const slides: StorySlide[] = []
  const { habits } = stats

  slides.push({
    kind: 'opening',
    eyebrow: 'Your year in review',
    headline: String(stats.year),
    detail: 'Here is what you watched.',
    posters: stats.topShows.map((s) => s.poster).filter(Boolean) as PosterRef[],
  })

  if (stats.estimatedMinutes > 0) {
    slides.push({
      kind: 'time',
      eyebrow: 'You spent roughly',
      headline: formatStoryTime(stats.estimatedMinutes),
      detail: 'An estimate, from the runtimes of everything you finished.',
    })
  }

  if (stats.itemCount > 0) {
    slides.push({
      kind: 'count',
      eyebrow: 'You finished',
      headline: String(stats.itemCount),
      countTo: stats.itemCount,
      detail:
        stats.episodeCount > 0 && stats.movieCount > 0
          ? `${plural(stats.episodeCount, 'episode', 'episodes')} and ${plural(stats.movieCount, 'film', 'films')}.`
          : stats.episodeCount > 0
            ? `${plural(stats.episodeCount, 'episode', 'episodes')}, across ${plural(stats.seriesCount, 'show', 'shows')}.`
            : `${plural(stats.movieCount, 'film', 'films')}.`,
    })
  }

  const [top] = stats.topShows
  if (top) {
    slides.push({
      kind: 'topShow',
      eyebrow: 'You kept coming back to',
      headline: top.label,
      detail: `${plural(top.count, 'episode', 'episodes')} this year.`,
      poster: top.poster,
    })
  }

  // Only worth its own card when there is a list rather than a winner and a
  // straggler; the winner already had a screen to itself.
  if (stats.topShows.length > 2) {
    slides.push({ kind: 'shows', eyebrow: 'Your top shows', headline: `${stats.year} in five` })
  }

  if (stats.busiestDay && stats.busiestDay.count > 1) {
    slides.push({
      kind: 'biggestDay',
      eyebrow: 'Your biggest day',
      headline: stats.busiestDay.label,
      detail: `${stats.busiestDay.count} things, in one day.`,
    })
  }

  if (habits.longestStreak > 2) {
    slides.push({
      kind: 'habits',
      eyebrow: 'Your longest run',
      headline: plural(habits.longestStreak, 'day', 'days'),
      detail: 'Watching something every single one of them.',
    })
  } else if (habits.favouriteWeekday !== null) {
    slides.push({
      kind: 'habits',
      eyebrow: 'Your day for it',
      headline: WEEKDAY_NAMES[habits.favouriteWeekday],
      detail: 'More finished then than on any other day.',
    })
  }

  const [genre] = stats.topGenres
  if (genre) {
    slides.push({
      kind: 'genre',
      eyebrow: 'Mostly, you were in the mood for',
      headline: genre.label,
      detail: `${plural(genre.count, 'title', 'titles')} of it.`,
    })
  }

  if (habits.busiestMonth !== null && opts.monthName) {
    const name = opts.monthName(habits.busiestMonth)
    const last = slides[slides.length - 1]
    // Folded into whatever card is already on screen rather than given its own.
    // A month name alone does not carry a full screen.
    if (last && !last.detail?.includes(name)) last.detail = `${last.detail ?? ''} ${name} was your busiest month.`.trim()
  }

  slides.push({
    kind: 'closing',
    eyebrow: `That was ${stats.year}`,
    headline: 'See it all',
    detail: 'The whole year, on one page.',
  })

  return slides
}

/** "11 hours" rather than "11 hr 43 min" — a headline, not a readout. */
export function formatStoryTime(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0 minutes'
  // Tested against the hour before rounding to it: 45 minutes rounds to one
  // hour and would have been announced as one, which is a fifth of an hour off
  // on the card whose whole job is that number.
  if (minutes < 60) return plural(Math.round(minutes), 'minute', 'minutes')
  const hours = Math.round(minutes / 60)
  if (hours < 48) return plural(hours, 'hour', 'hours')
  return `${plural(Math.round(hours / 24), 'day', 'days')} of it`
}

/** Where a tap lands: back a card, or on to the next. */
export function tapDirection(x: number, width: number): -1 | 1 {
  if (!(width > 0)) return 1
  // A third for back, the rest forward. Forward is what almost every tap means,
  // so it gets the room; going back is deliberate.
  return x < width / 3 ? -1 : 1
}

/** The next index, or null when the run is over and the page should take over. */
export function advance(index: number, total: number, direction: -1 | 1): number | null {
  const next = index + direction
  if (next < 0) return 0
  if (next >= total) return null
  return next
}
