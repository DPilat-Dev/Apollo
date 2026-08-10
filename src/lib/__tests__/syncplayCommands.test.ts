import { describe, expect, it } from 'vitest'
import { planCommand, secondsToTicks } from '../syncplayCommands'

const iso = (ms: number) => new Date(ms).toISOString()
const TICKS = 10_000_000

describe('planCommand', () => {
  it('schedules against the server clock, not the local one', () => {
    // Local clock 5s behind the server. Server says act at server-time 30s.
    // Locally that is 25s; it is locally 24s now, so wait 1s.
    const plan = planCommand(
      { Command: 'Unpause', When: iso(30_000), PositionTicks: 120 * TICKS },
      5000,
      24_000,
    )!
    expect(plan.action).toBe('play')
    expect(plan.delayMs).toBe(1000)
    expect(plan.positionSeconds).toBe(120)
  })

  it('maps every command the server can send', () => {
    const at = (c: string) => planCommand({ Command: c, When: iso(0) }, 0, 0)?.action
    expect(at('Unpause')).toBe('play')
    expect(at('Play')).toBe('play')
    expect(at('Pause')).toBe('pause')
    expect(at('Stop')).toBe('stop')
    expect(at('Seek')).toBe('seek')
  })

  it('ignores a command it does not understand rather than guessing', () => {
    expect(planCommand({ Command: 'Teleport', When: iso(0) }, 0, 0)).toBeNull()
    expect(planCommand({}, 0, 0)).toBeNull()
  })

  /**
   * A device that joins late, or one on a slow link, receives a command whose
   * moment has already passed. It has to act at once to catch up, not wait.
   */
  it('acts immediately when the moment has passed', () => {
    const plan = planCommand({ Command: 'Unpause', When: iso(1000) }, 0, 60_000)!
    expect(plan.delayMs).toBe(0)
  })

  it('treats a missing When as now', () => {
    expect(planCommand({ Command: 'Pause' }, 0, 5000)!.delayMs).toBe(0)
  })

  it('converts ticks to seconds and never returns a negative position', () => {
    expect(planCommand({ Command: 'Seek', PositionTicks: 90 * TICKS }, 0, 0)!.positionSeconds).toBe(90)
    expect(planCommand({ Command: 'Seek', PositionTicks: -5 }, 0, 0)!.positionSeconds).toBe(0)
    expect(planCommand({ Command: 'Seek' }, 0, 0)!.positionSeconds).toBe(0)
  })
})

describe('secondsToTicks', () => {
  it('round-trips with the position conversion', () => {
    expect(secondsToTicks(90)).toBe(90 * TICKS)
    expect(planCommand({ Command: 'Seek', PositionTicks: secondsToTicks(42.5) }, 0, 0)!
      .positionSeconds).toBe(42.5)
  })

  it('clamps below zero', () => {
    expect(secondsToTicks(-3)).toBe(0)
  })
})
