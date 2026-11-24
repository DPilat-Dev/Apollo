import { describe, expect, it } from 'vitest'
import {
  CEILING_BPS,
  FLOOR_BPS,
  reduceBandwidth,
  seedState,
  type BandwidthSeed,
} from '../bandwidth'

/**
 * What Auto believes about this connection, as a reducer.
 *
 * It was a `useState` and a ref, and the ref was a bug: it recorded "a
 * step-down has happened, so ignore any probe that lands after it", which is
 * right within an episode and wrong for the rest of the session. It never
 * reset. Episode two re-seeds from a cache that has expired — ten minutes is
 * shorter than an episode — finds nothing, starts a measurement, and then
 * throws the result away because of a stall that happened during episode one.
 * `measuring` stays true, the stream query stays disabled, and the player sits
 * on "Auto (testing…)" with no picture until you leave and come back.
 *
 * As a reducer the rule can say what it means — *this* episode's step-down
 * outranks *this* episode's probe — and the stale closure that caused it
 * cannot be written: every event is applied to the state as it is now.
 */
const episode = (key: string, over: Partial<BandwidthSeed> = {}): BandwidthSeed => ({
  ...seedState(key, null),
  ...over,
})

describe('reduceBandwidth', () => {
  it('takes a measurement for the episode it was asked about', () => {
    const next = reduceBandwidth(episode('ep1'), {
      type: 'measured',
      key: 'ep1',
      bps: 7_000_000,
      measured: true,
    })
    expect(next).toMatchObject({ bps: 7_000_000, measured: true })
  })

  it('lets a step-down outrank a probe that lands after it', () => {
    // Evidence from this stream beats a projection made before it started.
    const dropped = reduceBandwidth(episode('ep1'), { type: 'note', bps: 6_000_000 })
    const late = reduceBandwidth(dropped, {
      type: 'measured',
      key: 'ep1',
      bps: 20_000_000,
      measured: true,
    })
    expect(late.bps).toBe(6_000_000)
  })

  it('forgets that step-down when the episode changes', () => {
    /*
      The regression. A flag that outlives its episode means the next one's
      measurement is discarded, and nothing else ever sets a figure: the
      player waits on a measurement it has already thrown away.
    */
    const dropped = reduceBandwidth(episode('ep1'), { type: 'note', bps: 6_000_000 })
    const ep2 = reduceBandwidth(dropped, { type: 'reseed', key: 'ep2', cached: null })
    expect(ep2.noted).toBe(false)

    const measured = reduceBandwidth(ep2, {
      type: 'measured',
      key: 'ep2',
      bps: 20_000_000,
      measured: true,
    })
    expect(measured.bps).toBe(20_000_000)
  })

  it('ignores a measurement that answers the previous episode', () => {
    // The request was in flight when the episode changed. Applying it would
    // put episode one's figure on episode two.
    const ep2 = reduceBandwidth(episode('ep1'), { type: 'reseed', key: 'ep2', cached: null })
    const stale = reduceBandwidth(ep2, {
      type: 'measured',
      key: 'ep1',
      bps: 20_000_000,
      measured: true,
    })
    expect(stale.bps).toBeNull()
  })

  it('opens an episode on the cached figure when there is one', () => {
    const ep2 = reduceBandwidth(episode('ep1'), { type: 'reseed', key: 'ep2', cached: 6_000_000 })
    // A step-down is written to the cache, so this is how the next episode
    // starts where the last one ended up rather than climbing back.
    expect(ep2).toEqual({ key: 'ep2', bps: 6_000_000, measured: true, noted: false })
  })

  it('refuses a step-down outside the range the menu covers', () => {
    const base = episode('ep1', { bps: 7_000_000, measured: true })
    for (const bps of [0, -1, Number.NaN, FLOOR_BPS - 1, CEILING_BPS + 1]) {
      expect(reduceBandwidth(base, { type: 'note', bps })).toBe(base)
    }
  })

  it('leaves no way for a measurement to be dropped silently forever', () => {
    /*
      The invariant the player depends on: whatever has happened, a result for
      the current episode either lands or is superseded by a figure that is
      already there. A state with no figure and nothing coming is a black
      screen.
    */
    const states: BandwidthSeed[] = [
      episode('ep1'),
      reduceBandwidth(episode('ep1'), { type: 'note', bps: 6_000_000 }),
      reduceBandwidth(episode('ep1'), { type: 'reseed', key: 'ep2', cached: null }),
    ]
    for (const state of states) {
      const after = reduceBandwidth(state, {
        type: 'measured',
        key: state.key,
        bps: 9_000_000,
        measured: true,
      })
      expect(after.bps).not.toBeNull()
    }
  })
})
