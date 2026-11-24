/**
 * The words that go around a speed test.
 *
 * Auto already measures the connection before it plays anything — that is
 * `bandwidth.ts`. This is the other half of the same fact: what the number
 * means to the person reading it. Settings shows the test to everyone, not
 * just to admins, because the people who need to know why video stalls at
 * their house are exactly the ones who cannot open the server's dashboard and
 * run its own.
 *
 * Three things are reported, and all three are arithmetic over a measurement,
 * which is why they live here with unit tests rather than inside a component:
 *
 * - the speed, in a word, because "29.4 Mbps" answers nothing on its own;
 * - the rung of the quality menu it buys, because that is the setting next to
 *   it on the page;
 * - how old the figure is, because the panel opens on whatever Auto is
 *   already using and a stale number with no date on it invites a second
 *   press of a button that has nothing to do.
 */

export interface VerdictTier {
  /** The tier covers everything below this raw measured speed. */
  belowBps: number
  label: string
  detail: string
}

/**
 * What a measured speed means, in order, slowest first.
 *
 * Thresholds are on the *raw* measurement, not on the ceiling Auto derives
 * from it, because this is the connection being described rather than the
 * request that will be made of it. `HEADROOM` is what separates the two, so
 * every figure quoted in a `detail` is about 70% of the threshold above it.
 */
export const VERDICT_TIERS = [
  {
    belowBps: 2_200_000,
    label: 'Slow',
    detail: 'Enough for 480p. The server will transcode almost everything.',
  },
  {
    belowBps: 6_000_000,
    label: 'Workable',
    detail: '720p holds up. 1080p gets transcoded down to fit.',
  },
  {
    belowBps: 15_000_000,
    label: 'Good',
    detail: '1080p plays comfortably at the bitrates most files use.',
  },
  {
    belowBps: 35_000_000,
    label: 'Fast',
    detail: 'High-bitrate 1080p plays without the server re-encoding it.',
  },
  {
    belowBps: Number.POSITIVE_INFINITY,
    label: 'Very fast',
    detail: 'Anything in the library, 4K remuxes included.',
  },
] as const satisfies readonly VerdictTier[]

/**
 * The tier a measurement falls in.
 *
 * A figure that is not a positive number reads as the slowest case rather
 * than throwing: `measureBitrate` cannot produce one, but a cache written by
 * an older build can, and a settings page that crashes is worse than a
 * settings page with the wrong adjective on it.
 */
export function verdict(rawBps: number): VerdictTier {
  if (!Number.isFinite(rawBps) || rawBps <= 0) return VERDICT_TIERS[0]
  return VERDICT_TIERS.find((tier) => rawBps < tier.belowBps) ?? VERDICT_TIERS[0]
}

/**
 * The highest rung of the quality menu a ceiling actually covers.
 *
 * Auto is skipped rather than filtered out as a special case afterwards: its
 * value is 0, so "the highest option at or below the ceiling" picks it for
 * every connection on earth, and the page would answer "how fast is this?"
 * with "Auto".
 *
 * Below the bottom of the ladder the lowest rung is still the answer — that
 * is what `withHeadroom`'s floor clamps to, so it is what will really be
 * asked for.
 */
export function supportedQualityLabel(
  ceilingBps: number,
  options: readonly { label: string; value: number }[],
): string {
  const rungs = options.filter((o) => o.value > 0).sort((a, b) => b.value - a.value)
  const lowest = rungs[rungs.length - 1]
  const fits = rungs.find((o) => o.value <= ceilingBps)
  return (fits ?? lowest)?.label ?? ''
}

/**
 * How long ago a measurement was taken, in words.
 *
 * Only ever used on figures from the cache, which expires after
 * `MEASUREMENT_TTL_MS`, so there is deliberately no branch for hours: a
 * stored measurement is always minutes old at most. A clock that has jumped
 * forward reads as "just now" rather than as a negative count.
 */
export function describeAge(at: number, now: number): string {
  const seconds = Math.max(0, (now - at) / 1000)
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes <= 1) return 'a minute ago'
  return `${minutes} minutes ago`
}
