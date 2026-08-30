/**
 * The sleep timer — when playback should stop itself.
 *
 * Two timers, because they answer different questions. "Stop in half an hour"
 * is a promise about the clock in the room, so it is held against wall time and
 * survives the tab being throttled or the laptop being shut. "Stop at the end
 * of this episode" is a promise about the *media*, so it is derived from what
 * is actually left of the item — never from a wall-clock guess made when it was
 * armed, which a single backwards seek would have made a lie.
 *
 * Everything here is a pure function of a timer plus one sample of the world,
 * so the awkward parts — the boundary at zero, a duration the browser has not
 * reported yet, a viewer rewinding past the deadline — are testable without a
 * video element.
 */

import { formatTimecode } from './format'

/** The choices offered in the menu, in minutes. */
export const SLEEP_DURATIONS_MINUTES = [15, 30, 45, 60, 90] as const

/**
 * How long before the end the "still watching?" prompt appears.
 *
 * Long enough to notice and reach for something, short enough that it is not
 * on screen for a meaningful part of what you are watching.
 */
export const SLEEP_GRACE_SECONDS = 30

export type SleepTimer =
  | { kind: 'duration'; minutes: number; endsAtMs: number }
  | {
      kind: 'episode'
      /**
       * The item an extension already excused. An end-of-episode timer cannot
       * be pushed back within one episode — there is no dial to turn — so
       * "keep watching" means it waits for the *next* item instead. Remembering
       * which one was excused is what stops it firing seconds later on the
       * episode the viewer just asked it to leave alone.
       *
       * Absent means nothing has been excused yet, which is why this is
       * `undefined` rather than `null`: an item that has not identified itself
       * still has to be excusable, or granting the extension would do nothing
       * and the timer would fire anyway.
       */
      excusedItemId?: string | null
    }

/** One reading of the world: the clock, and where playback has got to. */
export interface PlaybackSample {
  /** Wall clock, in milliseconds. */
  nowMs: number
  /** The item playing right now, if one has resolved yet. */
  itemId: string | null
  /** Absolute position within the item, in seconds. */
  positionSeconds: number
  /** The item's full length, in seconds. Zero or NaN until it is known. */
  durationSeconds: number
}

export interface SleepTimerStatus {
  active: boolean
  /** Seconds until playback stops, or null when that is not yet knowable. */
  remainingSeconds: number | null
  /** The countdown as a timecode, for the menu and the status line. */
  label: string | null
  /** In the last {@link SLEEP_GRACE_SECONDS}: show the prompt. */
  grace: boolean
  /** The timer is up. The caller pauses; it does not navigate. */
  expired: boolean
  /**
   * Whether the next episode should be held back. Starting one only to stop it
   * moments later would lose the viewer's place in the episode they fell
   * asleep during, which is the whole thing this feature protects.
   */
  blocksAutoplay: boolean
}

const IDLE: SleepTimerStatus = {
  active: false,
  remainingSeconds: null,
  label: null,
  grace: false,
  expired: false,
  blocksAutoplay: false,
}

export function startDurationTimer(minutes: number, nowMs: number): SleepTimer | null {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(nowMs)) return null
  return { kind: 'duration', minutes, endsAtMs: nowMs + minutes * 60_000 }
}

export function startEpisodeTimer(): SleepTimer {
  return { kind: 'episode' }
}

/** How much of the item is left, or null while that is not a real number. */
function itemRemaining(sample: PlaybackSample): number | null {
  const { durationSeconds, positionSeconds } = sample
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return null
  if (!Number.isFinite(positionSeconds)) return null
  return Math.max(0, durationSeconds - positionSeconds)
}

/**
 * Seconds until the timer fires, or null when nothing is armed or the answer
 * is not yet knowable.
 *
 * Null is deliberately not zero: a stream whose duration has not arrived would
 * otherwise read as "no time left" and pause the viewer's episode the instant
 * it started.
 */
export function sleepRemainingSeconds(
  timer: SleepTimer | null,
  sample: PlaybackSample,
): number | null {
  if (!timer) return null

  if (timer.kind === 'duration') {
    /*
      Pausing does not stop this clock, deliberately. "Stop in thirty minutes"
      was said about the room, not about the film, and someone who pauses and
      drifts off has if anything made the case for it — freezing the countdown
      there would leave a timer that never fires and a screen lit until morning.
      The end-of-episode timer below is the one that honours a pause, because
      it is measured in media time and media time does not advance.
    */
    if (!Number.isFinite(sample.nowMs)) return null
    return Math.max(0, (timer.endsAtMs - sample.nowMs) / 1000)
  }

  // An extension excused this item; the timer waits for whatever plays next.
  // A never-extended timer holds `undefined`, which no sample id can equal.
  if (timer.excusedItemId === sample.itemId) return null
  return itemRemaining(sample)
}

export function sleepTimerStatus(
  timer: SleepTimer | null,
  sample: PlaybackSample,
  graceSeconds: number = SLEEP_GRACE_SECONDS,
): SleepTimerStatus {
  if (!timer) return IDLE

  const remainingSeconds = sleepRemainingSeconds(timer, sample)
  if (remainingSeconds === null) {
    return { ...IDLE, active: true }
  }

  const expired = remainingSeconds <= 0
  const episodeLeft = itemRemaining(sample)

  return {
    active: true,
    remainingSeconds,
    label: formatTimecode(remainingSeconds),
    // Once it has fired there is nothing left to grant, so the prompt goes
    // rather than flashing up for one frame alongside the pause.
    grace: !expired && remainingSeconds <= graceSeconds,
    expired,
    blocksAutoplay:
      timer.kind === 'episode' || (episodeLeft !== null && remainingSeconds <= episodeLeft),
  }
}

/**
 * Grant the extension the "still watching?" prompt offered.
 *
 * A duration timer moves its deadline out by the duration it was set to, added
 * to the deadline rather than measured from now — so the tenth extension of a
 * 15-minute timer is worth the same fifteen minutes as the first, and a viewer
 * who answers the prompt late is not quietly given less.
 */
export function extendSleepTimer(
  timer: SleepTimer | null,
  sample: PlaybackSample,
): SleepTimer | null {
  if (!timer) return null
  if (timer.kind === 'duration') {
    return { ...timer, endsAtMs: timer.endsAtMs + timer.minutes * 60_000 }
  }
  return { kind: 'episode', excusedItemId: sample.itemId }
}

/** How the timer is named once it is running. */
export function sleepTimerDescription(timer: SleepTimer | null): string | null {
  if (!timer) return null
  return timer.kind === 'duration' ? `${timer.minutes} minutes` : 'End of episode'
}
