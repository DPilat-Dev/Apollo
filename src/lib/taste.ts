import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'

/**
 * A per-user taste profile built from what they have actually watched and
 * favourited, and a scorer that rates a candidate against it.
 *
 * Deliberately interpretable rather than clever: every number here can be
 * traced back to "you watched N things with this genre/person/studio", which
 * is what makes the "why" line under a score honest.
 */

/** Below this many signals the profile is noise, and we show a rating instead. */
export const MIN_PROFILE_SIZE = 5

/** Favourites say more than a play, and a rewatch says more than one play. */
const FAVOURITE_WEIGHT = 3
const PLAY_WEIGHT = 1
const REWATCH_BONUS = 0.5

/**
 * How much each facet contributes to the affinity half of the score.
 *
 * People (director/cast) is a strong signal but deliberately excluded: the
 * People field is huge, so rows don't request it, and scoring on a facet that
 * only the detail page carries would show two different numbers for the same
 * title. Genres, studios and tags are cheap enough to fetch everywhere.
 */
const FACET_WEIGHTS = { genres: 0.6, studios: 0.2, tags: 0.2 }

/** Affinity vs. the community-rating prior. */
const AFFINITY_SHARE = 0.75

/**
 * How much a facet's single strongest term counts against its average.
 *
 * Kept low deliberately. At 0.4, one incidental shared genre carried a whole
 * title: a romance/drama scored 82% for a sci-fi viewer purely because they
 * had watched one drama.
 */
const PEAK_SHARE = 0.25

/**
 * Affinity is divided by this before curving, so this is roughly the overlap
 * that earns a top score. Raising it means a title has to match more of what
 * you actually watch, rather than one term out of several.
 */
const AFFINITY_FOR_FULL_MARKS = 0.7
const SPREAD_CURVE = 0.8

export interface TasteProfile {
  genres: Map<string, number>
  studios: Map<string, number>
  tags: Map<string, number>
  /** Number of items that informed the profile. */
  size: number
}

export interface MatchResult {
  /** 1–99, or null when the profile is too thin to claim anything. */
  percent: number | null
  /** Human-readable drivers, strongest first — e.g. ["Sci-Fi", "Denis Villeneuve"]. */
  reasons: string[]
}

const EMPTY_PROFILE: TasteProfile = {
  genres: new Map(),
  studios: new Map(),
  tags: new Map(),
  size: 0,
}

function bump(map: Map<string, number>, key: string, amount: number) {
  map.set(key, (map.get(key) ?? 0) + amount)
}

/**
 * Normalises raw counts to 0–1 against the strongest term, with a square-root
 * damper so one heavily-watched genre doesn't flatten everything else to zero.
 */
function normalise(raw: Map<string, number>): Map<string, number> {
  const out = new Map<string, number>()
  let max = 0
  for (const value of raw.values()) max = Math.max(max, Math.sqrt(value))
  if (max === 0) return out
  for (const [key, value] of raw) out.set(key, Math.sqrt(value) / max)
  return out
}

/**
 * @param played  Watched items, most recently played first — order matters,
 *                because recent viewing counts for more than old viewing.
 */
export function buildTasteProfile(
  played: BaseItemDto[],
  favourites: BaseItemDto[],
): TasteProfile {
  const genres = new Map<string, number>()
  const studios = new Map<string, number>()
  const tags = new Map<string, number>()

  const absorb = (item: BaseItemDto, weight: number) => {
    for (const g of item.Genres ?? []) bump(genres, g, weight * FACET_WEIGHTS.genres)
    for (const s of item.Studios ?? []) {
      if (s.Name) bump(studios, s.Name, weight * FACET_WEIGHTS.studios)
    }
    for (const t of item.Tags ?? []) bump(tags, t, weight * FACET_WEIGHTS.tags)
  }

  played.forEach((item, index) => {
    // Linear decay across the window: newest counts double the oldest.
    const recency = 1 - (0.5 * index) / Math.max(played.length - 1, 1)
    const rewatch = (item.UserData?.PlayCount ?? 1) > 1 ? REWATCH_BONUS : 0
    absorb(item, (PLAY_WEIGHT + rewatch) * recency)
  })

  favourites.forEach((item) => absorb(item, FAVOURITE_WEIGHT))

  const seen = new Set([...played, ...favourites].map((i) => i.Id).filter(Boolean))

  return {
    genres: normalise(genres),
    studios: normalise(studios),
    tags: normalise(tags),
    size: seen.size,
  }
}

/** Mean affinity across an item's terms, plus the single strongest term. */
function facetScore(
  profile: Map<string, number>,
  terms: string[],
): { score: number; best: { term: string; value: number } | null } {
  if (terms.length === 0) return { score: 0, best: null }
  let total = 0
  let best: { term: string; value: number } | null = null
  for (const term of terms) {
    const value = profile.get(term) ?? 0
    total += value
    if (value > 0 && (!best || value > best.value)) best = { term, value }
  }
  // Blend the average with the peak, so a single very strong signal still
  // lands even when the rest of the item's terms are unfamiliar.
  const mean = total / terms.length
  const peak = best?.value ?? 0
  return { score: (1 - PEAK_SHARE) * mean + PEAK_SHARE * peak, best }
}

/** Community rating as a 0–1 prior: 5.0 and below is 0, 10 is 1. */
function ratingPrior(item: BaseItemDto): number {
  const rating = item.CommunityRating
  if (typeof rating !== 'number') return 0.4 // unknown — assume middling
  return Math.min(1, Math.max(0, (rating - 5) / 5))
}

export function scoreMatch(profile: TasteProfile, item: BaseItemDto): MatchResult {
  if (profile.size < MIN_PROFILE_SIZE) return { percent: null, reasons: [] }

  const facets = [
    { weight: FACET_WEIGHTS.genres, profile: profile.genres, terms: item.Genres ?? [] },
    {
      weight: FACET_WEIGHTS.studios,
      profile: profile.studios,
      terms: (item.Studios ?? []).map((x) => x.Name ?? '').filter(Boolean),
    },
    { weight: FACET_WEIGHTS.tags, profile: profile.tags, terms: item.Tags ?? [] },
  ]

  // Only score facets the item actually carries, and renormalise by their
  // weights — otherwise an item with no tags is penalised for the omission
  // rather than judged on what it does have.
  const present = facets.filter((f) => f.terms.length > 0)
  const totalWeight = present.reduce((sum, f) => sum + f.weight, 0)

  const scored = present.map((f) => ({ ...f, ...facetScore(f.profile, f.terms) }))
  const affinity =
    totalWeight > 0
      ? scored.reduce((sum, f) => sum + f.score * f.weight, 0) / totalWeight
      : 0

  // Real overlaps rarely approach 1, so a curve spreads the useful range across
  // the scale instead of bunching every title between 5% and 25%.
  const spread = Math.pow(Math.min(affinity / AFFINITY_FOR_FULL_MARKS, 1), SPREAD_CURVE)

  // With nothing to match on, the score is the rating prior alone.
  const share = present.length > 0 ? AFFINITY_SHARE : 0
  const raw = share * spread + (1 - share) * ratingPrior(item)
  const percent = Math.round(Math.min(99, Math.max(1, raw * 100)))

  const reasons = scored
    .map((f) => f.best)
    .filter((b): b is { term: string; value: number } => Boolean(b))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((b) => b.term)

  return { percent, reasons }
}

export { EMPTY_PROFILE }
