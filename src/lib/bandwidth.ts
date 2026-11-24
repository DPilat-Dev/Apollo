/**
 * How fast this connection actually is, measured rather than assumed.
 *
 * "Auto" used to mean *no ceiling*: `playbackInfo` defaults MaxStreamingBitrate
 * to 120 Mbps, so Auto asked the server for the file at whatever bitrate it was
 * encoded at. On the LAN that is the right answer and the reason Auto is the
 * default. Off the LAN it is the worst one available — a 25 Mbps remux handed
 * to a 6 Mbps connection direct-plays, fills the buffer, and stalls every
 * thirty seconds, which is what buffering complaints from outside the house
 * have always been.
 *
 * So Auto measures first. Jellyfin serves `/Playback/BitrateTest?size=N` — N
 * bytes of nothing, which is exactly what jellyfin-web's own speed test
 * downloads — and the time it takes is the connection speed.
 *
 * Two things keep the measurement honest:
 *
 * - It starts small and escalates. A 500 KB probe on a gigabit LAN is mostly
 *   latency and reads far too slow, so a fast first probe earns a bigger
 *   second one; a slow first probe stops there rather than making someone on
 *   4 Mbps wait half a minute to be told they are on 4 Mbps.
 * - It keeps `HEADROOM` of what it saw. A connection measured at 10 Mbps and
 *   then asked for a 10 Mbps stream has nothing left for the dips, and the
 *   dips are what empties a buffer.
 *
 * Everything here is pure or takes its download as an argument, because the
 * test suite runs in Node with no network and no DOM.
 */

/**
 * Probe sizes in bytes, smallest first.
 *
 * The top one is 8 MB rather than anything larger because accuracy above
 * `CEILING_BPS` buys nothing — everything past it clamps to the same figure —
 * and the whole test is downloaded on someone's connection, possibly a metered
 * one. 12.5 MB is the most a measurement can ever cost.
 */
export const PROBE_SIZES = [500_000, 4_000_000, 8_000_000] as const

/**
 * How long a probe may take before the next one up is not worth running.
 *
 * This is the whole reason the escalation is safe: the projection is made from
 * the speed just measured, so a connection that would need longer than this to
 * swallow the next size never downloads it.
 */
export const PROBE_BUDGET_MS = 2_500

/**
 * The hard stop for the whole test, escalation and all.
 *
 * Playback waits for this figure, so this number is a black screen somebody is
 * looking at. The budget per probe bounds the *projected* cost of the next
 * download; this bounds the real one, which is the case that actually hurt: a
 * probe through a slow reverse proxy, or one the server never finishes, had
 * nothing to stop it and the player simply never started.
 */
export const MEASUREMENT_BUDGET_MS = 3_000

/** The share of the measured speed Auto actually asks for. */
export const HEADROOM = 0.7

/**
 * What Auto falls back to when the measurement cannot be made at all — an old
 * server with no bitrate-test route, a proxy that blocks it, a probe that
 * throws. Deliberately modest: the failure mode of guessing too low is a
 * transcode, and the failure mode of guessing too high is the stalling this
 * module exists to stop.
 */
export const FALLBACK_BPS = 8_000_000

/** Never ask for less than the lowest the quality menu offers. */
export const FLOOR_BPS = 1_500_000
/** Never ask for more than the server's own default ceiling. */
export const CEILING_BPS = 120_000_000

/**
 * How long a measurement stands. Long enough that a binge does not re-test
 * between episodes, short enough that moving from the sofa to the car is
 * noticed. A step-down from buffering writes itself here too (see
 * `cachePayload`), so the rest of a session that has already proved itself
 * slow starts at the proved figure instead of the optimistic one.
 */
export const MEASUREMENT_TTL_MS = 10 * 60 * 1000

export const CACHE_KEY = 'apollo.bandwidth'

export interface ProbeResult {
  /** How many bytes actually arrived. */
  bytes: number
  /** How long they took, in milliseconds. */
  elapsedMs: number
}

export interface Measurement {
  /** The ceiling to hand the server, in bits per second. */
  bps: number
  /**
   * What the connection actually measured, before `HEADROOM` came off, or
   * null when there is no measurement behind this figure — a fallback, or a
   * cached ceiling whose raw reading was not kept.
   *
   * Nothing in playback reads this. The Settings page does: a line somebody
   * knows is 42 Mbps being asked for at 29 reads as a broken measurement
   * until both numbers are on screen together.
   */
  rawBps: number | null
  /** False when every probe failed and `FALLBACK_BPS` is standing in. */
  measured: boolean
}

/**
 * Bits per second from one probe.
 *
 * The clamp on `elapsedMs` is not defensive dressing: a cached or
 * loopback-served probe can report 0 ms, and a division by it would put
 * Infinity into the stream request.
 */
export function bitsPerSecond(bytes: number, elapsedMs: number): number {
  return (bytes * 8 * 1000) / Math.max(1, elapsedMs)
}

/**
 * The measured speed turned into a ceiling: headroom taken off, held inside
 * the range the quality menu covers, and rounded to 100 kbps so two runs of
 * the same test on the same connection produce the same number rather than two
 * cache keys and two transcodes.
 */
export function withHeadroom(rawBps: number): number {
  const kept = rawBps * HEADROOM
  const bounded = Math.min(CEILING_BPS, Math.max(FLOOR_BPS, kept))
  return Math.round(bounded / 100_000) * 100_000
}

/**
 * The next probe up, or null when there is none left, the connection is too
 * slow to spend the time on it, or the test has already used its budget.
 */
export function nextProbeSize(
  rawBps: number,
  lastSize: number,
  msLeft: number = PROBE_BUDGET_MS,
): number | null {
  const next = PROBE_SIZES.find((size) => size > lastSize)
  if (next == null) return null
  const projectedMs = (next * 8 * 1000) / Math.max(1, rawBps)
  return projectedMs <= Math.min(PROBE_BUDGET_MS, msLeft) ? next : null
}

/**
 * Run the escalating test.
 *
 * A probe that throws ends the test rather than failing it: whatever earlier
 * probes measured is still a measurement, and only losing the first one falls
 * back to a guess.
 */
export async function measureBitrate(
  probe: (size: number) => Promise<ProbeResult>,
  opts: { now?: () => number; budgetMs?: number } = {},
): Promise<Measurement> {
  const now = opts.now ?? (() => Date.now())
  const budgetMs = opts.budgetMs ?? MEASUREMENT_BUDGET_MS
  const started = now()
  let size: number | null = PROBE_SIZES[0]
  let raw: number | null = null

  while (size != null) {
    let result: ProbeResult
    try {
      result = await probe(size)
    } catch {
      break
    }
    // A zero-byte body is a route answering 200 with nothing, which measures as
    // a connection of zero rather than as the failure it is.
    if (result.bytes <= 0) break
    raw = bitsPerSecond(result.bytes, result.elapsedMs)
    size = nextProbeSize(raw, size, budgetMs - (now() - started))
  }

  if (raw == null) return { bps: FALLBACK_BPS, rawBps: null, measured: false }
  return { bps: withHeadroom(raw), rawBps: raw, measured: true }
}

export interface CacheEntry {
  bps: number
  /** When the measurement was taken, as epoch milliseconds. */
  at: number
}

/**
 * A stored measurement with its timestamp, still good, or null.
 *
 * The timestamp is for the Settings page, which opens showing the figure Auto
 * is already using: a measurement with no age on it cannot be told apart from
 * one just taken, and "7 Mbps" alone invites a second press of a button that
 * has nothing to do.
 */
export function parseCacheEntry(raw: string | null, now: number): CacheEntry | null {
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as { bps?: unknown; at?: unknown }
    const { bps, at } = stored
    if (typeof bps !== 'number' || typeof at !== 'number') return null
    if (!Number.isFinite(bps) || bps <= 0) return null
    if (now - at > MEASUREMENT_TTL_MS || now < at) return null
    return { bps, at }
  } catch {
    return null
  }
}

/** A stored measurement, still good, or null. */
export function parseCache(raw: string | null, now: number): number | null {
  return parseCacheEntry(raw, now)?.bps ?? null
}

export function cachePayload(bps: number, now: number): string {
  return JSON.stringify({ bps, at: now })
}

/**
 * What the Auto row in the quality menu says.
 *
 * It used to say "Auto (no limit)", which was true and is no longer. Showing
 * the figure is the point: "Auto" alone cannot be told apart from a player
 * that has simply ignored the setting, and the number is the one piece of
 * evidence anyone debugging their own buffering wants.
 */
export function autoQualityLabel(bps: number | null, measuring = false): string {
  if (measuring) return 'Auto (testing…)'
  if (bps == null) return 'Auto'
  return `Auto (≈${formatMbps(bps)})`
}

/** 7_000_000 -> "7 Mbps", 3_500_000 -> "3.5 Mbps". */
export function formatMbps(bps: number): string {
  const mbps = bps / 1_000_000
  const rounded = mbps >= 10 ? Math.round(mbps) : Math.round(mbps * 10) / 10
  return `${rounded} Mbps`
}

export interface BandwidthSeed {
  /** The item being played. A new one re-seeds everything below. */
  key: string | null
  /** The ceiling in force, or null while there is nothing to go on. */
  bps: number | null
  measured: boolean
  /**
   * A step-down has been recorded *for this key*.
   *
   * It makes a probe that lands after a stall lose to the stall, which is
   * right: evidence from the stream beats a projection made before it
   * started. The words "for this key" are the whole fix — as a ref that
   * outlived its episode, this flag made the next episode throw away the
   * measurement it was waiting on and sit on "Auto (testing…)" forever.
   */
  noted: boolean
}

export type BandwidthEvent =
  /** A new item: start again from whatever the cache holds. */
  | { type: 'reseed'; key: string | null; cached: number | null }
  /** A probe came back. `key` is the item it was started for. */
  | { type: 'measured'; key: string | null; bps: number; measured: boolean }
  /** A stall stepped the quality down. */
  | { type: 'note'; bps: number }

/**
 * Is this a ceiling Auto could actually ask for?
 *
 * The range the quality menu covers. Shared by the step-down rule and the
 * cache write so they cannot disagree about what counts as a figure.
 */
export function isUsableCeiling(bps: number): boolean {
  return Number.isFinite(bps) && bps >= FLOOR_BPS && bps <= CEILING_BPS
}

export function seedState(key: string | null, cached: number | null): BandwidthSeed {
  return { key, bps: cached, measured: cached != null, noted: false }
}

/**
 * Auto's belief about this connection, advanced by one event.
 *
 * A reducer rather than a set of refs because every one of these rules is
 * about the state *as it is when the event arrives*, and a promise started
 * three state changes ago closes over the state as it was. That is not a
 * tidiness argument: it is the bug this replaced.
 */
export function reduceBandwidth(state: BandwidthSeed, event: BandwidthEvent): BandwidthSeed {
  switch (event.type) {
    case 'reseed':
      return seedState(event.key, event.cached)

    case 'measured':
      // Two reasons to drop a result, both about it answering a question that
      // is no longer the one being asked: the episode moved on while it was in
      // flight, or this episode has since stalled and knows better.
      if (event.key !== state.key || state.noted) return state
      return { ...state, bps: event.bps, measured: event.measured }

    case 'note': {
      const { bps } = event
      if (!isUsableCeiling(bps)) return state
      return { ...state, bps, measured: true, noted: true }
    }
  }
}
