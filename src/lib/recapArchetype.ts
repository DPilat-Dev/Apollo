import type { RecapStats } from './yearRecap'

/**
 * The joke at the end of the numbers.
 *
 * A year of totals is a spreadsheet until something in it says who you were
 * while you watched it. This picks one label from the shape of the year and a
 * few smaller ones underneath, in the spirit of the thing — a wink, not a
 * diagnosis.
 *
 * Two rules keep it from being annoying. Nothing fires without real evidence:
 * every rule has a share of the year to clear and a floor on the count, so a
 * library with four films in it is not told what kind of person it belongs to.
 * And nothing here is scolding. Anyone can look at their own year; being handed
 * a number and a small joke is the point, and being handed a judgement is not.
 */

export interface Archetype {
  /** Stable across runs, for tests and for a React key. */
  id: string
  title: string
  blurb: string
}

/** Share of the year's items carrying any of these genres. */
function genreShare(stats: RecapStats, pattern: RegExp): { share: number; count: number } {
  if (stats.itemCount <= 0) return { share: 0, count: 0 }
  /*
    Summed, and it can exceed the item count: one film is a Comedy and a Drama
    and gets counted under both. That is fine for a threshold — "a lot of your
    year was horror" is true whether or not those items were also thrillers —
    but it means a share here is not a fraction of the year in the strict sense
    and must never be printed as a percentage.
  */
  const count = stats.topGenres
    .filter((g) => pattern.test(g.label))
    .reduce((sum, g) => sum + g.count, 0)
  return { share: count / stats.itemCount, count }
}

interface Rule {
  id: string
  title: string
  blurb: (stats: RecapStats) => string
  /** Highest wins. Rarer signals sit above commoner ones. */
  test: (stats: RecapStats) => boolean
}

/*
  Ordered, and the order is the design: the first match wins, and the list runs
  from the rarest signal to the most common. A year that is 8% one thing and
  76% another is more interesting for the 8% — that is the part that says
  something. The broad ones at the bottom are there so that almost everybody
  gets something.
*/
const RULES: Rule[] = [
  {
    id: 'gooner',
    title: 'Gooner',
    blurb: () => 'A suspicious amount of this year was filed under Adult. No notes, no questions.',
    // Deliberately the lowest bar on the list. Nobody watches 40% of a year of
    // this; showing up at all is the joke.
    test: (s) => genreShare(s, /^(adult|ecchi|harem|hentai)$/i).count >= 5,
  },
  {
    id: 'weeb',
    title: 'Card-carrying weeb',
    blurb: (s) => `${genreShare(s, /^anime$/i).count} of them were anime. Subs or dubs, no judgement.`,
    test: (s) => genreShare(s, /^anime$/i).share >= 0.35 && s.itemCount >= 20,
  },
  {
    id: 'horror',
    title: 'Sleeps fine, apparently',
    blurb: () => 'You spent the year being chased around a house. On purpose.',
    test: (s) => genreShare(s, /^(horror|thriller|suspense)$/i).share >= 0.3 && s.itemCount >= 15,
  },
  {
    id: 'romantic',
    title: 'Hopeless romantic',
    blurb: () => 'You knew how every one of them ended and you watched anyway.',
    test: (s) => genreShare(s, /^romance$/i).share >= 0.3 && s.itemCount >= 15,
  },
  {
    id: 'detective',
    title: 'Person of interest',
    blurb: () => 'Enough crime to be a suspect in most of it.',
    test: (s) => genreShare(s, /^(crime|mystery)$/i).share >= 0.35 && s.itemCount >= 20,
  },
  {
    id: 'scholar',
    title: 'Well, actually',
    blurb: () => 'A year of documentaries. Someone at a party is about to learn something.',
    test: (s) => genreShare(s, /^(documentary|biography|history)$/i).share >= 0.3 && s.itemCount >= 15,
  },
  {
    id: 'reality',
    title: 'Emotionally invested in strangers',
    blurb: () => 'None of it was real and all of it mattered.',
    test: (s) => genreShare(s, /^(reality|reality-?tv|talk[- ]?show|game[- ]?show)$/i).share >= 0.3 && s.itemCount >= 15,
  },
  {
    id: 'cartoon-adult',
    title: 'Certified cartoon adult',
    blurb: (s) =>
      `${Math.round(genreShare(s, /^(animation|anime)$/i).share * 100)}% animated, and not a single one of them was for children.`,
    test: (s) => genreShare(s, /^(animation|anime)$/i).share >= 0.55 && s.itemCount >= 20,
  },
  {
    id: 'comfort',
    title: 'Comfort watcher',
    blurb: (s) => `${s.topShows[0]?.label ?? 'One show'} was on for most of it. It knows what it did.`,
    test: (s) => (s.topShows[0]?.count ?? 0) / Math.max(1, s.itemCount) >= 0.3 && s.itemCount >= 30,
  },
  {
    id: 'comedian',
    title: 'Here for a laugh',
    blurb: () => 'A year that refused to be serious about anything.',
    test: (s) => genreShare(s, /^comedy$/i).share >= 0.55 && s.itemCount >= 20,
  },
  {
    id: 'marathon',
    title: 'Went the distance',
    blurb: (s) => `${s.habits.longestStreak} days in a row without missing one.`,
    test: (s) => s.habits.longestStreak >= 14,
  },
  {
    id: 'sampler',
    title: 'Commitment issues',
    blurb: (s) => `${s.seriesCount} different shows. How many did you finish?`,
    test: (s) => s.seriesCount >= 25,
  },
  {
    id: 'cinema',
    title: 'Films person',
    blurb: (s) => `${s.movieCount} films. You sit through the credits, don't you.`,
    test: (s) => s.movieCount >= 12 && s.movieCount / Math.max(1, s.itemCount) >= 0.5,
  },
]

/** The one label for the year, or null when there is not enough to go on. */
export function viewerArchetype(stats: RecapStats | null | undefined): Archetype | null {
  // Below this a year is a handful of evenings, and any label is invented.
  if (!stats || stats.itemCount < 10) return null
  const rule = RULES.find((r) => r.test(stats))
  return rule ? { id: rule.id, title: rule.title, blurb: rule.blurb(stats) } : null
}

/**
 * The smaller ones, shown together beneath it.
 *
 * Facts about the shape of the year rather than its taste, so they can sit
 * alongside any archetype without repeating it — and the one that produced the
 * headline is dropped, because being told the same joke twice is worse than
 * being told it once.
 */
export function viewerBadges(stats: RecapStats | null | undefined, limit = 3): Archetype[] {
  if (!stats || stats.itemCount < 10) return []
  const headline = viewerArchetype(stats)

  const candidates: Archetype[] = []
  const busiest = stats.busiestDay
  if (busiest && busiest.count / Math.max(1, stats.itemCount) >= 0.12) {
    candidates.push({
      id: 'one-sitting',
      title: 'One sitting',
      blurb: `${busiest.count} of them landed on a single day.`,
    })
  }
  if (stats.habits.longestStreak >= 7) {
    candidates.push({
      id: 'marathon',
      title: 'Went the distance',
      blurb: `${stats.habits.longestStreak} days in a row.`,
    })
  }
  if (stats.habits.activeDays >= 200) {
    candidates.push({
      id: 'regular',
      title: 'Most days',
      blurb: `Something was on ${stats.habits.activeDays} days of the year.`,
    })
  }
  if (stats.seriesCount >= 25) {
    candidates.push({
      id: 'sampler',
      title: 'Commitment issues',
      blurb: `${stats.seriesCount} different shows.`,
    })
  }
  if ((stats.topShows[0]?.count ?? 0) / Math.max(1, stats.itemCount) >= 0.3) {
    candidates.push({
      id: 'comfort',
      title: 'One show, mostly',
      blurb: `${stats.topShows[0]!.count} episodes of the same thing.`,
    })
  }
  if (stats.episodeCount > 0 && stats.movieCount === 0) {
    candidates.push({
      id: 'no-films',
      title: 'Not a films year',
      blurb: 'Zero films. Not one.',
    })
  }

  return candidates.filter((b) => b.id !== headline?.id).slice(0, limit)
}
