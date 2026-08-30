import { describe, expect, it } from 'vitest'
import {
  correctDrift,
  expectedPositionSeconds,
  DRIFT_DEADBAND_SECONDS,
  DRIFT_SEEK_SECONDS,
  MAX_RATE_NUDGE,
  RATE_CORRECTION_WINDOW_SECONDS,
} from '../syncplayDrift'
import { HOLD_RATE } from '../pressGesture'

/** The common case: in a group, viewer has not touched the speed menu. */
const at = (localSeconds: number, expectedSeconds: number, currentRate = 1) =>
  correctDrift({ localSeconds, expectedSeconds, currentRate })

describe('correctDrift — the deadband', () => {
  it('does nothing for a drift too small to be worth hearing', () => {
    expect(at(100, 100).action).toBe('hold')
    expect(at(100.04, 100).action).toBe('hold')
    expect(at(99.96, 100).action).toBe('hold')
  })

  it('holds at exactly 1.0, never at a leftover correction rate', () => {
    const decision = at(100, 100)
    expect(decision.rate).toBe(1)
  })

  it('restores the rate when it is still nudged but the drift has gone', () => {
    // The bug this exists to prevent: a client parked at 1.02 forever, slowly
    // running away from the group it was just pulled back into.
    const decision = at(100, 100, 1.02)
    expect(decision.action).toBe('rate')
    expect(decision.rate).toBe(1)
  })

  /*
    Measured from zero so the drift is exactly the threshold: 100.05 - 100 is
    0.04999999999999716, which would make this a test of float noise instead
    of a test of the boundary.
  */
  it('treats the deadband boundary as worth correcting', () => {
    expect(at(DRIFT_DEADBAND_SECONDS, 0).action).toBe('rate')
    expect(at(0, DRIFT_DEADBAND_SECONDS).action).toBe('rate')
    expect(at(DRIFT_DEADBAND_SECONDS * 0.999, 0).action).toBe('hold')
    expect(at(0, DRIFT_DEADBAND_SECONDS * 0.999).action).toBe('hold')
  })
})

describe('correctDrift — the rate tier', () => {
  it('slows a client that has run ahead', () => {
    const decision = at(100.5, 100)
    expect(decision.action).toBe('rate')
    expect(decision.rate).toBeLessThan(1)
    expect(decision.rate).toBe(1 - 0.5 / RATE_CORRECTION_WINDOW_SECONDS)
  })

  it('speeds up a client that has fallen behind', () => {
    const decision = at(99.5, 100)
    expect(decision.action).toBe('rate')
    expect(decision.rate).toBeGreaterThan(1)
    expect(decision.rate).toBe(1 + 0.5 / RATE_CORRECTION_WINDOW_SECONDS)
  })

  it('never nudges further than the clamp, in either direction', () => {
    // A drift of 1.9s over a 10s window asks for 0.81, which would be audible.
    expect(at(101.9, 100).rate).toBe(1 - MAX_RATE_NUDGE)
    expect(at(98.1, 100).rate).toBe(1 + MAX_RATE_NUDGE)
  })

  it('corrects rather than seeks right up to the seek threshold', () => {
    const justUnder = DRIFT_SEEK_SECONDS - 0.001
    expect(at(100 + justUnder, 100).action).toBe('rate')
    expect(at(100 - justUnder, 100).action).toBe('rate')
  })

  it('does not seek while it is only nudging', () => {
    expect(at(101, 100)).not.toHaveProperty('seconds')
  })
})

describe('correctDrift — the seek tier', () => {
  it('seeks once the gap is too big to ease away', () => {
    // At the clamp a 30s gap would take five minutes of playback to absorb.
    const decision = correctDrift({ localSeconds: 130, expectedSeconds: 100, currentRate: 1 })
    expect(decision.action).toBe('seek')
    expect(decision).toMatchObject({ seconds: 100 })
  })

  it('seeks forward for a client that has fallen a long way behind', () => {
    const decision = correctDrift({ localSeconds: 70, expectedSeconds: 100, currentRate: 1 })
    expect(decision.action).toBe('seek')
    expect(decision).toMatchObject({ seconds: 100 })
  })

  it('treats the seek threshold itself as a seek, not a nudge', () => {
    expect(at(100 + DRIFT_SEEK_SECONDS, 100).action).toBe('seek')
    expect(at(100 - DRIFT_SEEK_SECONDS, 100).action).toBe('seek')
  })

  it('drops the rate back to 1.0 as it seeks, since the gap is gone after', () => {
    expect(at(130, 100, 0.9).rate).toBe(1)
  })

  it('never asks the player to seek before the start of the item', () => {
    const decision = correctDrift({ localSeconds: 10, expectedSeconds: -5, currentRate: 1 })
    expect(decision).toMatchObject({ action: 'seek', seconds: 0 })
  })
})

describe('correctDrift — the viewer owns the speed menu', () => {
  it('leaves a deliberate speed alone instead of dragging it back to 1.0', () => {
    const decision = correctDrift({
      localSeconds: 101,
      expectedSeconds: 100,
      currentRate: 1.5,
      baseRate: 1.5,
    })
    expect(decision.action).toBe('hold')
    expect(decision.rate).toBe(1.5)
  })

  it('does not even hard seek someone who chose to watch faster', () => {
    const decision = correctDrift({
      localSeconds: 160,
      expectedSeconds: 100,
      currentRate: 1.5,
      baseRate: 1.5,
    })
    expect(decision.action).toBe('hold')
    expect(decision.rate).toBe(1.5)
  })

  it('still clears a correction left over from before the viewer chose a speed', () => {
    const decision = correctDrift({
      localSeconds: 100,
      expectedSeconds: 100,
      currentRate: 0.9,
      baseRate: 1.5,
    })
    expect(decision.action).toBe('rate')
    expect(decision.rate).toBe(1.5)
  })

  it('resumes correcting the moment the viewer returns to 1x', () => {
    const decision = correctDrift({
      localSeconds: 160,
      expectedSeconds: 100,
      currentRate: 1,
      baseRate: 1,
    })
    expect(decision.action).toBe('seek')
  })
})

describe('correctDrift — garbage in', () => {
  it('does nothing when either position is not a number', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(correctDrift({ localSeconds: bad, expectedSeconds: 100, currentRate: 1 }).action).toBe(
        'hold',
      )
      expect(correctDrift({ localSeconds: 100, expectedSeconds: bad, currentRate: 1 }).action).toBe(
        'hold',
      )
    }
  })

  it('holds at a usable rate even when the positions are garbage', () => {
    expect(correctDrift({ localSeconds: NaN, expectedSeconds: NaN, currentRate: NaN }).rate).toBe(1)
  })

  it('treats an impossible current rate as 1x rather than trusting it', () => {
    // A stopped or reversed element reports 0 or worse; correcting relative to
    // that would hand the video a rate it refuses to accept.
    for (const bad of [0, -1, NaN, Infinity]) {
      const decision = correctDrift({ localSeconds: 100, expectedSeconds: 100, currentRate: bad })
      expect(decision.rate).toBe(1)
    }
  })

  it('treats an impossible chosen speed as 1x', () => {
    for (const bad of [0, -2, NaN, Infinity]) {
      const decision = correctDrift({
        localSeconds: 100.5,
        expectedSeconds: 100,
        currentRate: 1,
        baseRate: bad,
      })
      expect(decision.action).toBe('rate')
      expect(decision.rate).toBe(1 - 0.5 / RATE_CORRECTION_WINDOW_SECONDS)
    }
  })

  it('never returns a rate a video element would reject', () => {
    const drifts = [-1e9, -100, -3, -0.4, 0, 0.4, 3, 100, 1e9]
    for (const drift of drifts) {
      for (const base of [1, 0.25, 2]) {
        const rate = correctDrift({
          localSeconds: 100 + drift,
          expectedSeconds: 100,
          currentRate: 1,
          baseRate: base,
        }).rate
        expect(Number.isFinite(rate)).toBe(true)
        expect(rate).toBeGreaterThan(0)
      }
    }
  })
})

describe('correctDrift — convergence', () => {
  /**
   * The property that actually matters: applying the returned rate for a while
   * has to shrink the gap rather than grow it or overshoot into oscillation.
   */
  it('walks a drifted client back into the deadband and stops there', () => {
    const step = 0.25
    let local = 101.4
    let expected = 100
    let rate = 1
    for (let i = 0; i < 2000; i++) {
      const decision = correctDrift({
        localSeconds: local,
        expectedSeconds: expected,
        currentRate: rate,
      })
      if (decision.action === 'seek') local = decision.seconds
      rate = decision.rate
      local += step * rate
      expected += step
    }
    expect(Math.abs(local - expected)).toBeLessThan(DRIFT_DEADBAND_SECONDS)
    expect(rate).toBe(1)
  })

  it('recovers from a gap far too large to nudge', () => {
    let local = 100
    let expected = 400
    let rate = 1
    for (let i = 0; i < 100; i++) {
      const decision = correctDrift({
        localSeconds: local,
        expectedSeconds: expected,
        currentRate: rate,
      })
      if (decision.action === 'seek') local = decision.seconds
      rate = decision.rate
      local += 0.25 * rate
      expected += 0.25
    }
    expect(Math.abs(local - expected)).toBeLessThan(DRIFT_DEADBAND_SECONDS)
    expect(rate).toBe(1)
  })
})

describe('expectedPositionSeconds', () => {
  const timeline = { positionSeconds: 100, atServerMs: 1_000_000, playing: true }

  it('advances at 1x from the instant the group agreed on', () => {
    expect(expectedPositionSeconds(timeline, 1_000_000)).toBe(100)
    expect(expectedPositionSeconds(timeline, 1_012_500)).toBe(112.5)
  })

  it('ignores this client, so a nudged rate cannot move the target', () => {
    // The group's timeline is the server's. If it drifted with the local rate
    // the correction would be chasing its own tail.
    expect(expectedPositionSeconds(timeline, 1_010_000)).toBe(110)
  })

  it('has no expectation while the group is paused', () => {
    expect(expectedPositionSeconds({ ...timeline, playing: false }, 1_010_000)).toBeNull()
  })

  it('holds at the start position for a command scheduled slightly ahead', () => {
    // Commands arrive before their moment. Until it passes the group has not
    // started moving, and a negative elapsed would rewind the target.
    expect(expectedPositionSeconds(timeline, 999_000)).toBe(100)
  })

  it('refuses to guess from an unusable anchor', () => {
    expect(expectedPositionSeconds({ ...timeline, atServerMs: NaN }, 1_010_000)).toBeNull()
    expect(expectedPositionSeconds({ ...timeline, positionSeconds: NaN }, 1_010_000)).toBeNull()
    expect(expectedPositionSeconds(timeline, NaN)).toBeNull()
    expect(expectedPositionSeconds(null, 1_010_000)).toBeNull()
  })

  it('never reports a negative position', () => {
    expect(expectedPositionSeconds({ ...timeline, positionSeconds: -50 }, 1_000_000)).toBe(0)
  })
})

/*
  The seam between drift correction and the press-and-hold gesture, which are
  the only two things that write `playbackRate`. Both were correct alone: the
  hold set 2x, and the correction dragged it back within 250ms because from
  its side a client running at 2x looks like one racing away from the group.

  The hold reports itself as the chosen rate for as long as it lasts, so the
  existing "viewer picked a speed" rule stands the correction down. These pin
  that, so a change to either constant cannot quietly re-break it.
*/
describe('correctDrift — a press-and-hold is a deliberate speed', () => {
  it('stands down entirely while a 2x hold is running', () => {
    const decision = correctDrift({
      localSeconds: 130,
      expectedSeconds: 100,
      currentRate: HOLD_RATE,
      baseRate: HOLD_RATE,
    })
    // 30 seconds adrift is deep into the seek tier, and it still must not act.
    expect(decision.action).toBe('hold')
    expect(decision.rate).toBe(HOLD_RATE)
  })

  it('re-arms the moment the hold is released', () => {
    const decision = correctDrift({
      localSeconds: 130,
      expectedSeconds: 100,
      currentRate: HOLD_RATE,
      baseRate: 1,
    })
    expect(decision.action).toBe('seek')
    expect(decision.rate).toBe(1)
  })
})
