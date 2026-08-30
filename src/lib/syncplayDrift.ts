/**
 * Staying in step once playback has started.
 *
 * `syncplayCommands` gets every device to press play at the same instant, but
 * that agreement decays. Decoders run at slightly different speeds, one device
 * buffers for a second and never gets that second back, a backgrounded tab is
 * throttled and then catches up in a rush. Ten minutes in, "together" has
 * quietly become half a second apart, which is exactly far enough to ruin a
 * jump scare for one person in the room.
 *
 * The fix is a slow one. Correcting a drift by seeking is correct and awful:
 * the picture jumps and the audio clicks, and doing that every few seconds is
 * worse than the drift was. So there are three tiers, and the middle one does
 * the real work — a playback rate a fraction off 1.0 pulls a device back over
 * several seconds without anyone noticing it happened.
 */

/**
 * Under this, leave it alone. Lip sync tolerance is far wider than 50ms and a
 * correction that fires constantly is itself the artefact.
 */
export const DRIFT_DEADBAND_SECONDS = 0.05

/**
 * Over this, ease-in is hopeless. At the rate clamp a 30 second gap would take
 * five minutes of playback to absorb, so the jump is the lesser evil.
 */
export const DRIFT_SEEK_SECONDS = 2

/**
 * How far off 1.0 the rate may go. Beyond roughly this, pitch-corrected audio
 * starts to sound processed and un-corrected audio starts to sound wrong.
 */
export const MAX_RATE_NUDGE = 0.1

/**
 * Roughly how long a correction is given to close the gap. Longer is gentler;
 * this is short enough that a device is back in step before the next scene and
 * long enough that the rate change is inaudible.
 */
export const RATE_CORRECTION_WINDOW_SECONDS = 10

/**
 * A floor no browser rejects. Only reachable through absurd inputs, but a
 * `playbackRate` of zero silently freezes the video instead of throwing, which
 * would look exactly like the stall this code is supposed to prevent.
 */
const MIN_RATE = 0.0625

/** Where the group's timeline was, and when, on the server's clock. */
export interface GroupTimeline {
  positionSeconds: number
  /** The server-clock instant `positionSeconds` was true. */
  atServerMs: number
  playing: boolean
}

export interface DriftInput {
  /** Where this device actually is, in seconds on the item's timeline. */
  localSeconds: number
  /** Where the group says it should be, from `expectedPositionSeconds`. */
  expectedSeconds: number
  /** The rate the video element is running at right now, correction included. */
  currentRate: number
  /**
   * The speed the viewer picked from the speed menu. Defaults to 1x.
   *
   * Correction returns to this, never to a hard 1.0. Someone who deliberately
   * chose 1.5x has chosen to leave the group's timeline, and a client that
   * kept yanking them back would be unusable — so at any speed but 1x the
   * correction stands down entirely and only tidies up its own leftovers.
   * Setting the speed back to 1x re-arms it, and the one seek that follows is
   * the price of the excursion.
   */
  baseRate?: number
}

export type DriftDecision =
  /** In step. Nothing to apply. */
  | { action: 'hold'; rate: number }
  /** Apply `rate` and wait; the gap closes on its own. */
  | { action: 'rate'; rate: number }
  /** Too far gone to ease. Seek to `seconds`, then run at `rate`. */
  | { action: 'seek'; seconds: number; rate: number }

const usable = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback

/**
 * Where the group expects playback to be at a given server instant.
 *
 * Advances at 1x on purpose: the group's timeline belongs to the server, not
 * to whatever rate this device happens to be running at. Deriving it from the
 * local rate would make the correction chase its own output.
 *
 * Returns null rather than a guess whenever the anchor is unusable — no
 * expectation is a safe answer, a wrong one causes a seek.
 */
export function expectedPositionSeconds(
  timeline: GroupTimeline | null | undefined,
  serverNowMs: number,
): number | null {
  if (!timeline || !timeline.playing) return null
  if (!Number.isFinite(timeline.positionSeconds)) return null
  if (!Number.isFinite(timeline.atServerMs) || !Number.isFinite(serverNowMs)) return null
  // Commands arrive before the instant they take effect. Until it passes the
  // group has not moved, and a negative elapsed would rewind the target.
  const elapsed = Math.max(0, serverNowMs - timeline.atServerMs) / 1000
  return Math.max(0, timeline.positionSeconds + elapsed)
}

/** What to do about the gap between where we are and where the group is. */
export function correctDrift(input: DriftInput): DriftDecision {
  const base = usable(input.baseRate, 1)
  const current = usable(input.currentRate, base)

  // Positive means ahead of the group and needing to slow down.
  const drift = input.localSeconds - input.expectedSeconds
  const measurable = Number.isFinite(drift)

  // Either the drift is unknown or the viewer is deliberately off-timeline.
  // Both mean hands off the timeline, but a rate this module set earlier is
  // still ours to undo — otherwise a device that was mid-correction when the
  // viewer opened the speed menu stays stuck a few percent off forever.
  if (!measurable || base !== 1) return settle(base, current)

  if (Math.abs(drift) < DRIFT_DEADBAND_SECONDS) return settle(base, current)

  if (Math.abs(drift) >= DRIFT_SEEK_SECONDS) {
    return { action: 'seek', seconds: Math.max(0, input.expectedSeconds), rate: base }
  }

  const target = base - drift / RATE_CORRECTION_WINDOW_SECONDS
  return { action: 'rate', rate: clampRate(target, base) }
}

/** Back to the viewer's speed, saying so only if we are not already there. */
function settle(base: number, current: number): DriftDecision {
  return current === base ? { action: 'hold', rate: base } : { action: 'rate', rate: base }
}

function clampRate(target: number, base: number): number {
  const bounded = Math.min(base + MAX_RATE_NUDGE, Math.max(base - MAX_RATE_NUDGE, target))
  return Math.max(MIN_RATE, bounded)
}
