import { describe, expect, it } from 'vitest'
import { classifyTap, DOUBLE_TAP_MS, tapZone, TAP_SEEK_SECONDS, type TapState } from '../tapGesture'

describe('tapZone', () => {
  it('splits the surface into a seek edge, a safe middle, and a seek edge', () => {
    expect(tapZone(10, 1000)).toBe('left')
    expect(tapZone(340, 1000)).toBe('left')
    expect(tapZone(360, 1000)).toBe('center')
    expect(tapZone(500, 1000)).toBe('center')
    expect(tapZone(640, 1000)).toBe('center')
    expect(tapZone(660, 1000)).toBe('right')
    expect(tapZone(1000, 1000)).toBe('right')
  })

  it('treats a zero-width element as the safe middle', () => {
    // Better to do nothing than to seek because a layout had not settled.
    expect(tapZone(0, 0)).toBe('center')
  })
})

describe('classifyTap', () => {
  const first = (zone: 'left' | 'center' | 'right', at = 0) => classifyTap(null, zone, at)

  it('waits on a lone tap, because it may yet become a double', () => {
    expect(first('right').action).toEqual({ type: 'wait' })
    expect(first('center').action).toEqual({ type: 'wait' })
  })

  it('seeks on a second tap at an edge', () => {
    const one = first('right')
    expect(classifyTap(one.state, 'right', 200).action).toEqual({
      type: 'seek',
      seconds: TAP_SEEK_SECONDS,
    })

    const left = first('left')
    expect(classifyTap(left.state, 'left', 200).action).toEqual({
      type: 'seek',
      seconds: -TAP_SEEK_SECONDS,
    })
  })

  it('toggles playback on a second tap in the middle', () => {
    const one = first('center')
    expect(classifyTap(one.state, 'center', 100).action).toEqual({ type: 'toggle' })
  })

  it('keeps seeking through a burst rather than resetting after two', () => {
    let state: TapState = first('right').state
    const jumps: number[] = []
    for (const at of [200, 400, 600]) {
      const next = classifyTap(state, 'right', at)
      if (next.action.type === 'seek') jumps.push(next.action.seconds)
      state = next.state
    }
    expect(jumps).toEqual([10, 10, 10])
    expect(state.count).toBe(4)
  })

  it('starts over when the second tap lands too late', () => {
    const one = first('right', 0)
    const late = classifyTap(one.state, 'right', DOUBLE_TAP_MS + 1)
    expect(late.action).toEqual({ type: 'wait' })
    expect(late.state.count).toBe(1)
  })

  it('accepts a second tap exactly on the deadline', () => {
    const one = first('right', 0)
    expect(classifyTap(one.state, 'right', DOUBLE_TAP_MS).action.type).toBe('seek')
  })

  it('does not pair taps on opposite sides', () => {
    // Left then right would seek back then forward and land nowhere, which
    // reads as the player ignoring both taps.
    const one = first('left', 0)
    const other = classifyTap(one.state, 'right', 100)
    expect(other.action).toEqual({ type: 'wait' })
    expect(other.state.count).toBe(1)
  })

  it('does not pair an edge tap with a middle tap', () => {
    const one = first('center', 0)
    expect(classifyTap(one.state, 'right', 100).action).toEqual({ type: 'wait' })
  })
})
