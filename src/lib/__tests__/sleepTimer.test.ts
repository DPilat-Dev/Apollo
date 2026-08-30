import { describe, expect, it } from 'vitest'
import {
  extendSleepTimer,
  SLEEP_DURATIONS_MINUTES,
  SLEEP_GRACE_SECONDS,
  sleepRemainingSeconds,
  sleepTimerDescription,
  sleepTimerStatus,
  startDurationTimer,
  startEpisodeTimer,
  type PlaybackSample,
  type SleepTimer,
} from '../sleepTimer'

const T0 = 1_700_000_000_000
const MINUTE = 60_000

const sample = (over: Partial<PlaybackSample> = {}): PlaybackSample => ({
  nowMs: T0,
  itemId: 'ep1',
  positionSeconds: 0,
  durationSeconds: 1500,
  ...over,
})

describe('startDurationTimer', () => {
  it('offers the durations people actually reach for', () => {
    expect(SLEEP_DURATIONS_MINUTES).toEqual([15, 30, 45, 60, 90])
  })

  it('deadlines against the wall clock, not a count of ticks', () => {
    const timer = startDurationTimer(30, T0)
    expect(timer).toEqual({ kind: 'duration', minutes: 30, endsAtMs: T0 + 30 * MINUTE })
  })

  it('refuses a duration that is not a real number of minutes', () => {
    expect(startDurationTimer(0, T0)).toBeNull()
    expect(startDurationTimer(-15, T0)).toBeNull()
    expect(startDurationTimer(Number.NaN, T0)).toBeNull()
    expect(startDurationTimer(Number.POSITIVE_INFINITY, T0)).toBeNull()
  })

  it('refuses to deadline against a clock that is not a real time', () => {
    expect(startDurationTimer(30, Number.NaN)).toBeNull()
  })
})

describe('sleepRemainingSeconds — duration', () => {
  const timer = startDurationTimer(30, T0) as SleepTimer

  it('counts down from the full duration', () => {
    expect(sleepRemainingSeconds(timer, sample())).toBe(1800)
    expect(sleepRemainingSeconds(timer, sample({ nowMs: T0 + 10 * MINUTE }))).toBe(1200)
  })

  it('is exactly zero at the deadline, not a hair either side', () => {
    expect(sleepRemainingSeconds(timer, sample({ nowMs: T0 + 30 * MINUTE }))).toBe(0)
  })

  it('never reports a negative remainder once the deadline has passed', () => {
    expect(sleepRemainingSeconds(timer, sample({ nowMs: T0 + 45 * MINUTE }))).toBe(0)
  })

  it('keeps running while playback is paused, because the promise was about the clock', () => {
    // Nothing in the sample says "playing", and that is the point: a duration
    // timer is answering "stop in half an hour", which is true either way.
    const paused = sample({ nowMs: T0 + 20 * MINUTE, positionSeconds: 12 })
    expect(sleepRemainingSeconds(timer, paused)).toBe(600)
  })

  it('ignores the media clock entirely', () => {
    const seeked = sample({ nowMs: T0 + 5 * MINUTE, positionSeconds: 1400 })
    expect(sleepRemainingSeconds(timer, seeked)).toBe(1500)
  })

  it('reports nothing when there is no timer', () => {
    expect(sleepRemainingSeconds(null, sample())).toBeNull()
  })
})

describe('sleepRemainingSeconds — end of episode', () => {
  const timer = startEpisodeTimer()

  it('keys off what is actually left of the item', () => {
    expect(sleepRemainingSeconds(timer, sample({ positionSeconds: 900 }))).toBe(600)
  })

  it('does not move with the wall clock', () => {
    const later = sample({ nowMs: T0 + 10 * MINUTE, positionSeconds: 900 })
    expect(sleepRemainingSeconds(timer, later)).toBe(600)
  })

  it('grows again when the viewer seeks backwards', () => {
    expect(sleepRemainingSeconds(timer, sample({ positionSeconds: 1400 }))).toBe(100)
    expect(sleepRemainingSeconds(timer, sample({ positionSeconds: 300 }))).toBe(1200)
  })

  it('is exactly zero when the item ends', () => {
    expect(sleepRemainingSeconds(timer, sample({ positionSeconds: 1500 }))).toBe(0)
  })

  it('clamps rather than going negative when the position overshoots', () => {
    expect(sleepRemainingSeconds(timer, sample({ positionSeconds: 1600 }))).toBe(0)
  })

  it('knows nothing until the duration does', () => {
    expect(sleepRemainingSeconds(timer, sample({ durationSeconds: 0 }))).toBeNull()
    expect(sleepRemainingSeconds(timer, sample({ durationSeconds: Number.NaN }))).toBeNull()
    expect(sleepRemainingSeconds(timer, sample({ durationSeconds: Infinity }))).toBeNull()
    expect(sleepRemainingSeconds(timer, sample({ durationSeconds: -30 }))).toBeNull()
    expect(sleepRemainingSeconds(timer, sample({ positionSeconds: Number.NaN }))).toBeNull()
    expect(sleepRemainingSeconds(timer, sample({ positionSeconds: Infinity }))).toBeNull()
  })
})

describe('sleepTimerStatus', () => {
  it('is idle with no timer at all', () => {
    const status = sleepTimerStatus(null, sample())
    expect(status).toEqual({
      active: false,
      remainingSeconds: null,
      label: null,
      grace: false,
      expired: false,
      blocksAutoplay: false,
    })
  })

  it('stays quiet well before the deadline', () => {
    const timer = startDurationTimer(30, T0) as SleepTimer
    const status = sleepTimerStatus(timer, sample({ nowMs: T0 + 5 * MINUTE }))
    expect(status.grace).toBe(false)
    expect(status.expired).toBe(false)
    expect(status.label).toBe('25:00')
  })

  it('opens the grace window in the last half minute', () => {
    expect(SLEEP_GRACE_SECONDS).toBe(30)
    const timer = startDurationTimer(30, T0) as SleepTimer
    const at = (seconds: number) => sleepTimerStatus(timer, sample({ nowMs: T0 + 30 * MINUTE - seconds * 1000 }))
    expect(at(31).grace).toBe(false)
    expect(at(30).grace).toBe(true)
    expect(at(1).grace).toBe(true)
  })

  it('fires rather than pleading once the remainder hits zero', () => {
    const timer = startDurationTimer(30, T0) as SleepTimer
    const status = sleepTimerStatus(timer, sample({ nowMs: T0 + 30 * MINUTE }))
    expect(status.expired).toBe(true)
    // The prompt is gone by then: there is nothing left to grant.
    expect(status.grace).toBe(false)
  })

  it('gives an end-of-episode timer the same grace window, measured in media time', () => {
    const timer = startEpisodeTimer()
    expect(sleepTimerStatus(timer, sample({ positionSeconds: 1465 })).grace).toBe(false)
    expect(sleepTimerStatus(timer, sample({ positionSeconds: 1470 })).grace).toBe(true)
    expect(sleepTimerStatus(timer, sample({ positionSeconds: 1500 })).expired).toBe(true)
  })

  it('never fires an end-of-episode timer on a duration it cannot read', () => {
    const timer = startEpisodeTimer()
    const status = sleepTimerStatus(timer, sample({ durationSeconds: Number.NaN }))
    expect(status.active).toBe(true)
    expect(status.expired).toBe(false)
    expect(status.grace).toBe(false)
    expect(status.label).toBeNull()
  })

  it('labels long remainders with hours so 90 minutes reads honestly', () => {
    const timer = startDurationTimer(90, T0) as SleepTimer
    expect(sleepTimerStatus(timer, sample()).label).toBe('1:30:00')
  })
})

describe('sleepTimerStatus — autoplay', () => {
  it('holds back the next episode when the timer lands before this one ends', () => {
    const timer = startDurationTimer(15, T0) as SleepTimer
    // 20 minutes of episode left, 15 minutes of timer: sleep wins.
    const status = sleepTimerStatus(timer, sample({ durationSeconds: 1500, positionSeconds: 300 }))
    expect(status.blocksAutoplay).toBe(true)
  })

  it('lets the next episode start when the timer outlives this one', () => {
    const timer = startDurationTimer(60, T0) as SleepTimer
    const status = sleepTimerStatus(timer, sample({ durationSeconds: 1500, positionSeconds: 300 }))
    expect(status.blocksAutoplay).toBe(false)
  })

  it('always holds back the next episode for an end-of-episode timer', () => {
    const status = sleepTimerStatus(startEpisodeTimer(), sample({ positionSeconds: 10 }))
    expect(status.blocksAutoplay).toBe(true)
  })

  it('leaves autoplay alone when the item duration is unknown', () => {
    const timer = startDurationTimer(15, T0) as SleepTimer
    const status = sleepTimerStatus(timer, sample({ durationSeconds: 0 }))
    expect(status.blocksAutoplay).toBe(false)
  })
})

describe('extendSleepTimer', () => {
  it('pushes a duration timer out by the duration it was set to', () => {
    const timer = startDurationTimer(30, T0) as SleepTimer
    const graceMoment = sample({ nowMs: T0 + 30 * MINUTE - 20_000 })
    const extended = extendSleepTimer(timer, graceMoment)
    expect(sleepRemainingSeconds(extended, graceMoment)).toBe(1820)
    expect(sleepTimerStatus(extended, graceMoment).grace).toBe(false)
  })

  it('keeps the original duration, so a second extension is worth the same', () => {
    const timer = startDurationTimer(15, T0) as SleepTimer
    const twice = extendSleepTimer(extendSleepTimer(timer, sample()), sample())
    expect(sleepRemainingSeconds(twice, sample())).toBe(45 * 60)
  })

  it('carries an end-of-episode timer over to the next item instead of this one', () => {
    const timer = startEpisodeTimer()
    const nearlyOver = sample({ positionSeconds: 1490 })
    const extended = extendSleepTimer(timer, nearlyOver)

    // Nothing left to count on the episode that was nearly over.
    expect(sleepRemainingSeconds(extended, nearlyOver)).toBeNull()
    expect(sleepTimerStatus(extended, nearlyOver).expired).toBe(false)
    expect(sleepTimerStatus(extended, nearlyOver).blocksAutoplay).toBe(false)

    // The next episode is fair game again.
    const next = sample({ itemId: 'ep2', positionSeconds: 0 })
    expect(sleepRemainingSeconds(extended, next)).toBe(1500)
    expect(sleepTimerStatus(extended, next).blocksAutoplay).toBe(true)
  })

  it('does not lose an end-of-episode timer that was extended without an item id', () => {
    const extended = extendSleepTimer(startEpisodeTimer(), sample({ itemId: null }))
    expect(sleepRemainingSeconds(extended, sample({ itemId: null }))).toBeNull()
    expect(sleepRemainingSeconds(extended, sample({ itemId: 'ep2' }))).toBe(1500)
  })

  it('is a no-op on no timer, so an ignored prompt cannot conjure one', () => {
    expect(extendSleepTimer(null, sample())).toBeNull()
  })
})

describe('an ignored prompt', () => {
  it('still fires, having only ever asked', () => {
    const timer = startDurationTimer(15, T0) as SleepTimer
    const at = (seconds: number) =>
      sleepTimerStatus(timer, sample({ nowMs: T0 + 15 * MINUTE - seconds * 1000 }))

    expect(at(25).grace).toBe(true)
    expect(at(25).expired).toBe(false)
    // Nothing was granted, so the deadline arrives exactly as first set.
    expect(at(0).expired).toBe(true)
    expect(at(-90).expired).toBe(true)
  })
})

describe('sleepTimerDescription', () => {
  it('names the timer the way it was chosen', () => {
    expect(sleepTimerDescription(startDurationTimer(45, T0))).toBe('45 minutes')
    expect(sleepTimerDescription(startEpisodeTimer())).toBe('End of episode')
    expect(sleepTimerDescription(null)).toBeNull()
  })
})
