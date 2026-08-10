/**
 * Clock synchronisation against the server.
 *
 * SyncPlay commands carry the instant they should take effect, expressed in
 * the *server's* UTC clock. A browser's clock can be seconds out, so acting on
 * that timestamp directly would start playback early or late by however wrong
 * the local clock happens to be. Every device has to agree, so each measures
 * its own offset and converts.
 *
 * `/GetUtcTime` returns the two server-side timestamps needed for the standard
 * four-timestamp exchange NTP uses.
 */

export interface TimeSample {
  /** Add to a local timestamp to get the server's. */
  offsetMs: number
  /** Round trip excluding the time the server spent, so lower means better. */
  roundTripMs: number
}

/**
 *   t0  request leaves the client
 *   t1  server receives it        (RequestReceptionTime)
 *   t2  server replies            (ResponseTransmissionTime)
 *   t3  client receives the reply
 *
 * offset = ((t1 - t0) + (t2 - t3)) / 2, which cancels a symmetric delay.
 */
export function sampleFromExchange(
  t0: number,
  receptionTime: string,
  transmissionTime: string,
  t3: number,
): TimeSample | null {
  const t1 = Date.parse(receptionTime)
  const t2 = Date.parse(transmissionTime)
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null
  return {
    offsetMs: (t1 - t0 + (t2 - t3)) / 2,
    roundTripMs: t3 - t0 - (t2 - t1),
  }
}

/**
 * The sample from the fastest exchange.
 *
 * Offset error is bounded by half the round trip, so the quickest exchange is
 * the most trustworthy. Averaging instead would let one slow response drag
 * every device's idea of "now" apart from the others'.
 */
export function bestOffsetMs(samples: TimeSample[]): number {
  const usable = samples.filter((s) => Number.isFinite(s.offsetMs))
  if (usable.length === 0) return 0
  return usable.reduce((best, s) => (s.roundTripMs < best.roundTripMs ? s : best)).offsetMs
}

/** Local wall clock expressed on the server's. */
export const serverNow = (offsetMs: number, now = Date.now()) => now + offsetMs

/**
 * How long to wait before executing a command scheduled for `when`.
 *
 * Never negative: a command whose moment has already passed — a device that
 * joined late, or a slow network — has to run immediately rather than be
 * scheduled into the past.
 */
export function delayUntil(when: string, offsetMs: number, now = Date.now()): number {
  const target = Date.parse(when)
  if (!Number.isFinite(target)) return 0
  return Math.max(0, target - serverNow(offsetMs, now))
}
