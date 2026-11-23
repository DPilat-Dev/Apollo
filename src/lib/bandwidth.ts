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

/** Probe sizes in bytes, smallest first. */
export const PROBE_SIZES = [500_000, 4_000_000, 16_000_000] as const

/**
 * How long a probe may take before the next one up is not worth running.
 *
 * This is the whole reason the escalation is safe: the projection is made from
 * the speed just measured, so a connection that would need longer than this to
 * swallow the next size never downloads it.
 */
export const PROBE_BUDGET_MS = 2_500

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
 * The next probe up, or null when there is none left or the connection is too
 * slow to spend the time on it.
 */
export function nextProbeSize(rawBps: number, lastSize: number): number | null {
  const next = PROBE_SIZES.find((size) => size > lastSize)
  if (next == null) return null
  const projectedMs = (next * 8 * 1000) / Math.max(1, rawBps)
  return projectedMs <= PROBE_BUDGET_MS ? next : null
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
): Promise<Measurement> {
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
    size = nextProbeSize(raw, size)
  }

  if (raw == null) return { bps: FALLBACK_BPS, measured: false }
  return { bps: withHeadroom(raw), measured: true }
}

/** A stored measurement, still good, or null. */
export function parseCache(raw: string | null, now: number): number | null {
  if (!raw) return null
  try {
    const stored = JSON.parse(raw) as { bps?: unknown; at?: unknown }
    const { bps, at } = stored
    if (typeof bps !== 'number' || typeof at !== 'number') return null
    if (!Number.isFinite(bps) || bps <= 0) return null
    if (now - at > MEASUREMENT_TTL_MS || now < at) return null
    return bps
  } catch {
    return null
  }
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
