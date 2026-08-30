import { describe, expect, it } from 'vitest'
import {
  advancePress,
  firesTap,
  HOLD_RATE,
  LONG_PRESS_MS,
  PRESS_START,
  swipeRegion,
  TAP_SLOP_PX,
  volumeAfterDrag,
  VOLUME_SWIPE_FRACTION,
  type PressProgress,
} from '../pressGesture'

/** A pointer that has neither moved nor been held: the state at `pointerdown`. */
const still = { dx: 0, dy: 0, elapsedMs: 0 }

describe('advancePress', () => {
  it('leaves a still, brief press as a tap', () => {
    expect(advancePress(PRESS_START, still)).toEqual({ kind: 'tap', axis: null })
    expect(advancePress(PRESS_START, { dx: 0, dy: 0, elapsedMs: 80 })).toEqual({
      kind: 'tap',
      axis: null,
    })
  })

  it('holds a tap inside the slop, in every direction', () => {
    const inside = TAP_SLOP_PX - 1
    for (const [dx, dy] of [
      [inside, 0],
      [-inside, 0],
      [0, inside],
      [0, -inside],
    ]) {
      expect(advancePress(PRESS_START, { dx, dy, elapsedMs: 40 }).kind).toBe('tap')
    }
  })

  it('becomes a swipe once movement passes the slop, up or down', () => {
    const past = TAP_SLOP_PX + 1
    expect(advancePress(PRESS_START, { dx: 0, dy: -past, elapsedMs: 40 })).toEqual({
      kind: 'swipe',
      axis: 'vertical',
    })
    expect(advancePress(PRESS_START, { dx: 0, dy: past, elapsedMs: 40 })).toEqual({
      kind: 'swipe',
      axis: 'vertical',
    })
  })

  it('reads a sideways drag as a swipe that is not the volume gesture', () => {
    const sideways = advancePress(PRESS_START, { dx: 60, dy: 4, elapsedMs: 40 })
    expect(sideways.kind).toBe('swipe')
    expect(sideways.axis).toBe('horizontal')
  })

  it('will not call a diagonal vertical while the axes are tied', () => {
    // A thumb arcs; committing to volume on the first ambiguous sample would
    // make a sideways drag yank the sound.
    const tied = advancePress(PRESS_START, { dx: 40, dy: 40, elapsedMs: 40 })
    expect(tied.kind).toBe('swipe')
    expect(tied.axis).toBe(null)
  })

  it('picks up the axis on a later sample once one direction wins', () => {
    const tied = advancePress(PRESS_START, { dx: 40, dy: 40, elapsedMs: 40 })
    expect(advancePress(tied, { dx: 42, dy: 90, elapsedMs: 90 }).axis).toBe('vertical')
  })

  it('keeps the axis it first committed to, even if the drag turns', () => {
    const vertical = advancePress(PRESS_START, { dx: 0, dy: 80, elapsedMs: 40 })
    expect(advancePress(vertical, { dx: 300, dy: 82, elapsedMs: 300 })).toEqual({
      kind: 'swipe',
      axis: 'vertical',
    })

    const horizontal = advancePress(PRESS_START, { dx: 80, dy: 0, elapsedMs: 40 })
    expect(advancePress(horizontal, { dx: 82, dy: 300, elapsedMs: 300 }).axis).toBe('horizontal')
  })

  it('becomes a hold on the deadline, and not a millisecond before', () => {
    expect(advancePress(PRESS_START, { dx: 0, dy: 0, elapsedMs: LONG_PRESS_MS - 1 }).kind).toBe(
      'tap',
    )
    expect(advancePress(PRESS_START, { dx: 0, dy: 0, elapsedMs: LONG_PRESS_MS }).kind).toBe('hold')
  })

  it('lets a hold survive the jitter of a thumb resting on the glass', () => {
    const jitter = { dx: 3, dy: -2, elapsedMs: LONG_PRESS_MS + 200 }
    expect(advancePress(PRESS_START, jitter).kind).toBe('hold')
  })

  it('prefers the swipe when a slow drag crosses the slop and the deadline at once', () => {
    // A finger that is still moving is dragging, not holding — speeding the
    // video up under a volume swipe would be two gestures at once.
    const both = { dx: 0, dy: 90, elapsedMs: LONG_PRESS_MS + 50 }
    expect(advancePress(PRESS_START, both).kind).toBe('swipe')
  })

  it('does not let a hold be undone by moving afterwards', () => {
    const held = advancePress(PRESS_START, { dx: 0, dy: 0, elapsedMs: LONG_PRESS_MS })
    expect(advancePress(held, { dx: 0, dy: 200, elapsedMs: LONG_PRESS_MS + 400 }).kind).toBe('hold')
  })

  it('never turns a swipe back into a tap when the finger returns home', () => {
    const swiped = advancePress(PRESS_START, { dx: 0, dy: 200, elapsedMs: 100 })
    expect(advancePress(swiped, { dx: 0, dy: 0, elapsedMs: 200 }).kind).toBe('swipe')
  })

  it('leaves the double tap alone: neither half of one is long enough to hold', () => {
    // Two taps of a double tap are ~80ms of contact each inside a 300ms
    // window. If either could reach the hold deadline the second tap would
    // never arrive as a tap, and seeking by double tap would break.
    const firstHalf = advancePress(PRESS_START, { dx: 1, dy: 1, elapsedMs: 80 })
    const secondHalf = advancePress(PRESS_START, { dx: 2, dy: 0, elapsedMs: 80 })
    expect(firesTap(firstHalf)).toBe(true)
    expect(firesTap(secondHalf)).toBe(true)
    expect(LONG_PRESS_MS).toBeGreaterThan(300)
  })

  it('honours overridden thresholds', () => {
    expect(advancePress(PRESS_START, { dx: 0, dy: 6, elapsedMs: 10 }, { slop: 4 }).kind).toBe(
      'swipe',
    )
    expect(advancePress(PRESS_START, { dx: 0, dy: 0, elapsedMs: 30 }, { holdMs: 20 }).kind).toBe(
      'hold',
    )
  })

  it('treats the slop itself as still a tap, and one pixel past it as a swipe', () => {
    expect(advancePress(PRESS_START, { dx: 0, dy: TAP_SLOP_PX, elapsedMs: 40 }).kind).toBe('tap')
    expect(advancePress(PRESS_START, { dx: 0, dy: TAP_SLOP_PX + 0.5, elapsedMs: 40 }).kind).toBe(
      'swipe',
    )
  })

  it('does not mutate the state it was handed', () => {
    // `PRESS_START` is shared by every press; writing through it would leave
    // the next tap starting life as whatever the last gesture ended as.
    const before = { ...PRESS_START }
    advancePress(PRESS_START, { dx: 0, dy: 400, elapsedMs: 900 })
    expect(PRESS_START).toEqual(before)
  })

  it('ignores garbage coordinates rather than committing to a gesture', () => {
    expect(advancePress(PRESS_START, { dx: NaN, dy: NaN, elapsedMs: 40 }).kind).toBe('tap')
    expect(advancePress(PRESS_START, { dx: 0, dy: Infinity, elapsedMs: 40 }).kind).toBe('tap')
    expect(advancePress(PRESS_START, { dx: 0, dy: 0, elapsedMs: NaN }).kind).toBe('tap')
  })
})

describe('firesTap', () => {
  it('fires only for a press that stayed a tap', () => {
    const kinds: PressProgress[] = [
      { kind: 'tap', axis: null },
      { kind: 'swipe', axis: 'vertical' },
      { kind: 'swipe', axis: null },
      { kind: 'hold', axis: null },
    ]
    expect(kinds.map(firesTap)).toEqual([true, false, false, false])
  })
})

describe('swipeRegion', () => {
  it('puts volume on the right half, the side every phone player uses', () => {
    expect(swipeRegion(900, 1000)).toBe('volume')
    expect(swipeRegion(501, 1000)).toBe('volume')
  })

  it('leaves the left half inert, because the web cannot dim a screen', () => {
    expect(swipeRegion(100, 1000)).toBe('inert')
    expect(swipeRegion(499, 1000)).toBe('inert')
  })

  it('gives the exact midline to the inert side, so neither half overlaps', () => {
    expect(swipeRegion(500, 1000)).toBe('inert')
  })

  it('is inert when the element has no width to divide', () => {
    expect(swipeRegion(0, 0)).toBe('inert')
    expect(swipeRegion(10, NaN)).toBe('inert')
    expect(swipeRegion(NaN, 1000)).toBe('inert')
    expect(swipeRegion(10, -1000)).toBe('inert')
  })
})

describe('volumeAfterDrag', () => {
  const height = 1000
  /** How far a finger travels for the whole 0→1 range. */
  const fullTravel = height * VOLUME_SWIPE_FRACTION

  it('raises the volume when the finger goes up', () => {
    expect(volumeAfterDrag(0.5, -fullTravel / 2, height)).toBeCloseTo(1)
  })

  it('lowers it when the finger goes down', () => {
    expect(volumeAfterDrag(0.5, fullTravel / 2, height)).toBeCloseTo(0)
  })

  it('moves in proportion to the distance dragged', () => {
    expect(volumeAfterDrag(0.5, -fullTravel / 10, height)).toBeCloseTo(0.6)
    expect(volumeAfterDrag(0.2, -fullTravel / 4, height)).toBeCloseTo(0.45)
  })

  it('scales to the element, so a short screen is not harder to turn up', () => {
    const short = 400
    expect(volumeAfterDrag(0, -short * VOLUME_SWIPE_FRACTION, short)).toBeCloseTo(1)
  })

  it('clamps at both ends instead of running away past them', () => {
    expect(volumeAfterDrag(0.9, -fullTravel * 10, height)).toBe(1)
    expect(volumeAfterDrag(0.1, fullTravel * 10, height)).toBe(0)
  })

  it('does not move at all without a drag', () => {
    expect(volumeAfterDrag(0.37, 0, height)).toBeCloseTo(0.37)
  })

  it('returns a usable level for garbage input, never NaN', () => {
    // Assigning a non-finite number to `video.volume` throws in every browser,
    // which would take the whole gesture handler down with it.
    for (const value of [
      volumeAfterDrag(0.5, NaN, height),
      volumeAfterDrag(NaN, -50, height),
      volumeAfterDrag(0.5, -50, 0),
      volumeAfterDrag(0.5, -50, NaN),
      volumeAfterDrag(2, 0, height),
      volumeAfterDrag(-3, 0, height),
    ]) {
      expect(Number.isFinite(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('keeps the current level when the element cannot be measured', () => {
    expect(volumeAfterDrag(0.4, -300, 0)).toBeCloseTo(0.4)
    expect(volumeAfterDrag(0.4, -300, -800)).toBeCloseTo(0.4)
  })

  it('starts from silence, which is where a muted press begins', () => {
    expect(volumeAfterDrag(0, -fullTravel / 2, height)).toBeCloseTo(0.5)
  })
})

describe('HOLD_RATE', () => {
  it('is the 2× everyone else uses for press-and-hold', () => {
    expect(HOLD_RATE).toBe(2)
  })
})
