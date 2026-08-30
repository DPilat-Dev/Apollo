import { describe, expect, it } from 'vitest'
import {
  MAX_SUBTITLE_OFFSET_MS,
  SUBTITLE_OFFSET_STEP_MS,
  captureCueTimes,
  clampOffset,
  formatOffset,
  nudgeOffset,
  shiftCueTimes,
  subtitleOffsetStatus,
  syncCueOffset,
  type CueTiming,
} from '../subtitleOffset'

/** A stand-in for a live `TextTrackCue`, which is the same two writable numbers. */
const cue = (startTime: number, endTime: number) => ({ startTime, endTime })

describe('clampOffset', () => {
  it('keeps a value inside the usable range', () => {
    expect(clampOffset(400)).toBe(400)
    expect(clampOffset(-1_200)).toBe(-1_200)
    expect(clampOffset(0)).toBe(0)
  })

  it('clamps at both ends', () => {
    expect(clampOffset(MAX_SUBTITLE_OFFSET_MS + 5_000)).toBe(MAX_SUBTITLE_OFFSET_MS)
    expect(clampOffset(-MAX_SUBTITLE_OFFSET_MS - 5_000)).toBe(-MAX_SUBTITLE_OFFSET_MS)
  })

  /** Anything read back from storage or a URL can be junk. */
  it('treats a value that is not a number as no offset at all', () => {
    expect(clampOffset(Number.NaN)).toBe(0)
    expect(clampOffset(Number.POSITIVE_INFINITY)).toBe(MAX_SUBTITLE_OFFSET_MS)
    expect(clampOffset(Number.NEGATIVE_INFINITY)).toBe(-MAX_SUBTITLE_OFFSET_MS)
  })

  it('rounds to whole milliseconds', () => {
    expect(clampOffset(100.4)).toBe(100)
    expect(clampOffset(-99.5)).toBe(-99)
  })
})

describe('nudgeOffset', () => {
  it('moves by a step in either direction', () => {
    expect(nudgeOffset(0, SUBTITLE_OFFSET_STEP_MS)).toBe(100)
    expect(nudgeOffset(300, -SUBTITLE_OFFSET_STEP_MS)).toBe(200)
    expect(nudgeOffset(-100, -SUBTITLE_OFFSET_STEP_MS)).toBe(-200)
  })

  it('stops at the clamp rather than overshooting it', () => {
    expect(nudgeOffset(MAX_SUBTITLE_OFFSET_MS, SUBTITLE_OFFSET_STEP_MS)).toBe(
      MAX_SUBTITLE_OFFSET_MS,
    )
    expect(nudgeOffset(-MAX_SUBTITLE_OFFSET_MS, -SUBTITLE_OFFSET_STEP_MS)).toBe(
      -MAX_SUBTITLE_OFFSET_MS,
    )
    expect(nudgeOffset(MAX_SUBTITLE_OFFSET_MS - 50, SUBTITLE_OFFSET_STEP_MS)).toBe(
      MAX_SUBTITLE_OFFSET_MS,
    )
  })
})

describe('formatOffset', () => {
  it('says nothing is applied without a sign', () => {
    expect(formatOffset(0)).toBe('0s')
    expect(formatOffset(-0)).toBe('0s')
  })

  it('always signs a real offset, so the direction is unambiguous', () => {
    expect(formatOffset(400)).toBe('+0.4s')
    expect(formatOffset(-1_200)).toBe('-1.2s')
    expect(formatOffset(100)).toBe('+0.1s')
  })

  it('drops a trailing zero decimal', () => {
    expect(formatOffset(1_000)).toBe('+1s')
    expect(formatOffset(-10_000)).toBe('-10s')
  })

  it('never renders a signed zero', () => {
    // A value too small to show at this precision reads as no offset, not "+0s".
    expect(formatOffset(20)).toBe('0s')
    expect(formatOffset(-20)).toBe('0s')
  })
})

describe('captureCueTimes', () => {
  it('copies the times, so later shifts cannot corrupt the baseline', () => {
    const cues = [cue(1, 2)]
    const baseline = captureCueTimes(cues)
    cues[0].startTime = 99
    cues[0].endTime = 100
    expect(baseline).toEqual([{ startTime: 1, endTime: 2 }])
  })

  it('copes with nothing to capture', () => {
    expect(captureCueTimes([])).toEqual([])
    expect(captureCueTimes(null)).toEqual([])
    expect(captureCueTimes(undefined)).toEqual([])
  })
})

describe('shiftCueTimes', () => {
  const originals: CueTiming[] = [
    { startTime: 10, endTime: 12 },
    { startTime: 30, endTime: 33.5 },
  ]

  it('moves every cue later for a positive offset', () => {
    expect(shiftCueTimes(originals, 400)).toEqual([
      { startTime: 10.4, endTime: 12.4 },
      { startTime: 30.4, endTime: 33.9 },
    ])
  })

  it('moves every cue earlier for a negative offset', () => {
    expect(shiftCueTimes(originals, -1_500)).toEqual([
      { startTime: 8.5, endTime: 10.5 },
      { startTime: 28.5, endTime: 32 },
    ])
  })

  it('leaves the times alone at zero', () => {
    expect(shiftCueTimes(originals, 0)).toEqual(originals)
  })

  it('has nothing to do for a track with no cues', () => {
    expect(shiftCueTimes([], -3_000)).toEqual([])
  })

  /** A cue before the start of the video is meaningless, and browsers reject it. */
  it('clamps a cue that would land before zero', () => {
    expect(shiftCueTimes([{ startTime: 0.1, endTime: 1 }], -500)).toEqual([
      { startTime: 0, endTime: 0.5 },
    ])
    expect(shiftCueTimes([{ startTime: 0.1, endTime: 0.2 }], -5_000)).toEqual([
      { startTime: 0, endTime: 0 },
    ])
  })

  it('never lets an end land before its own start', () => {
    const [shifted] = shiftCueTimes([{ startTime: 0.4, endTime: 0.6 }], -500)
    expect(shifted.endTime).toBeGreaterThanOrEqual(shifted.startTime)
  })
})

describe('syncCueOffset', () => {
  it('writes the shifted times onto the live cues', () => {
    const cues = [cue(10, 12), cue(30, 31)]
    const result = syncCueOffset(cues, null, 500)
    expect(result.applied).toBe(2)
    expect(cues[0]).toEqual({ startTime: 10.5, endTime: 12.5 })
    expect(cues[1]).toEqual({ startTime: 30.5, endTime: 31.5 })
  })

  /*
    The bug this whole module is shaped around: a naive implementation adds the
    offset to whatever the cue currently says, so re-running it doubles the
    shift. The delivered cue times are what is asserted here, not the argument.
  */
  it('does not compound when applied repeatedly', () => {
    const cues = [cue(10, 12)]
    let baseline = syncCueOffset(cues, null, 200).baseline
    baseline = syncCueOffset(cues, baseline, 200).baseline
    syncCueOffset(cues, baseline, 200)
    expect(cues[0]).toEqual({ startTime: 10.2, endTime: 12.2 })
  })

  it('recomputes from the original when the offset changes', () => {
    const cues = [cue(10, 12)]
    const first = syncCueOffset(cues, null, 2_000)
    expect(cues[0].startTime).toBe(12)
    syncCueOffset(cues, first.baseline, -1_000)
    expect(cues[0]).toEqual({ startTime: 9, endTime: 11 })
  })

  it('restores the file times exactly on a reset to zero', () => {
    const cues = [cue(10, 12), cue(0.2, 0.9)]
    const shifted = syncCueOffset(cues, null, -3_000)
    expect(cues[1].startTime).toBe(0)
    syncCueOffset(cues, shifted.baseline, 0)
    expect(cues[0]).toEqual({ startTime: 10, endTime: 12 })
    expect(cues[1]).toEqual({ startTime: 0.2, endTime: 0.9 })
  })

  /*
    A <track> fetches its cues asynchronously, so the first attempt usually has
    nothing to write to. It must report that rather than capturing an empty
    baseline, which would then be treated as the file's real timings forever.
  */
  it('reports that it did nothing while the cues are still loading', () => {
    expect(syncCueOffset([], null, 400)).toEqual({ baseline: null, applied: 0 })
    expect(syncCueOffset(null, null, 400)).toEqual({ baseline: null, applied: 0 })
    expect(syncCueOffset(undefined, null, 400)).toEqual({ baseline: null, applied: 0 })
  })

  it('applies the pending offset once the cues arrive', () => {
    const cues: { startTime: number; endTime: number }[] = []
    const early = syncCueOffset(cues, null, 400)
    expect(early.applied).toBe(0)
    cues.push(cue(5, 6))
    const late = syncCueOffset(cues, early.baseline, 400)
    expect(late.applied).toBe(1)
    expect(cues[0]).toEqual({ startTime: 5.4, endTime: 6.4 })
  })

  it('keeps a baseline it already has when the cues go away', () => {
    const cues = [cue(10, 12)]
    const first = syncCueOffset(cues, null, 400)
    expect(syncCueOffset([], first.baseline, 400).baseline).toEqual(first.baseline)
  })

  /*
    Two numbers cannot be written at once, so there is always an instant where
    one has moved and the other has not. If that instant leaves the cue running
    backwards, an engine is entitled to normalise or drop it — so the order of
    the two writes has to follow the direction of the shift.
  */
  it('never leaves a cue inverted between the two writes', () => {
    const watched = (start: number, end: number) => {
      let startTime = start
      let endTime = end
      const seen: [number, number][] = []
      return {
        get startTime() {
          return startTime
        },
        set startTime(value: number) {
          startTime = value
          seen.push([startTime, endTime])
        },
        get endTime() {
          return endTime
        },
        set endTime(value: number) {
          endTime = value
          seen.push([startTime, endTime])
        },
        seen,
      }
    }

    const forwards = watched(10, 12)
    syncCueOffset([forwards], [{ startTime: 10, endTime: 12 }], 5_000)
    expect(forwards.seen.every(([s, e]) => s <= e)).toBe(true)
    expect([forwards.startTime, forwards.endTime]).toEqual([15, 17])

    const backwards = watched(10, 12)
    syncCueOffset([backwards], [{ startTime: 10, endTime: 12 }], -5_000)
    expect(backwards.seen.every(([s, e]) => s <= e)).toBe(true)
    expect([backwards.startTime, backwards.endTime]).toEqual([5, 7])
  })

  /*
    A reload re-parses the file, so the cue list can come back a different
    length — and at its untouched times. The old baseline no longer describes
    it, and re-capturing is the only way to stay non-destructive.
  */
  it('re-captures when the cue list no longer matches the baseline', () => {
    const stale: CueTiming[] = [{ startTime: 1, endTime: 2 }]
    const cues = [cue(10, 12), cue(20, 22)]
    const result = syncCueOffset(cues, stale, 1_000)
    expect(result.baseline).toEqual([
      { startTime: 10, endTime: 12 },
      { startTime: 20, endTime: 22 },
    ])
    expect(cues[0]).toEqual({ startTime: 11, endTime: 13 })
    expect(cues[1]).toEqual({ startTime: 21, endTime: 23 })
  })
})

describe('subtitleOffsetStatus', () => {
  it('offers the control for a client-side text track', () => {
    expect(subtitleOffsetStatus({ textTrackIndex: 3, burnedSubIndex: undefined }).kind).toBe(
      'adjustable',
    )
  })

  /** The server drew these into the picture; nothing here can move them. */
  it('refuses, with a reason, for a burned-in track', () => {
    const status = subtitleOffsetStatus({ textTrackIndex: null, burnedSubIndex: 3 })
    expect(status.kind).toBe('burned-in')
    expect(status.kind === 'burned-in' && status.reason.length).toBeGreaterThan(0)
  })

  it('treats a burned-in track as burned-in even if a text track is also set', () => {
    expect(subtitleOffsetStatus({ textTrackIndex: 1, burnedSubIndex: 3 }).kind).toBe('burned-in')
  })

  it('has nothing to offer when subtitles are off', () => {
    expect(subtitleOffsetStatus({ textTrackIndex: null, burnedSubIndex: undefined }).kind).toBe(
      'off',
    )
  })
})
