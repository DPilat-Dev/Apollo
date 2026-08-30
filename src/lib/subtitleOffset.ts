/**
 * Subtitle timing offset.
 *
 * Plenty of libraries hold subtitle files that were cut for a different release
 * of the same film, and they run a second or so ahead of the audio. Nothing in
 * the player could fix that, and a track that is out of sync is very nearly as
 * useless as no track at all.
 *
 * Shifting cues is destructive: a `TextTrackCue`'s `startTime` is the only copy
 * of that number the browser keeps, so adding an offset to it throws away what
 * the file said. Doing that twice silently doubles the shift. Everything here
 * is therefore written against a captured baseline of the file's own times, and
 * every offset is computed from that baseline rather than from whatever the cue
 * currently holds.
 */

/** One press. Fine enough to land on the right answer, coarse enough to get there. */
export const SUBTITLE_OFFSET_STEP_MS = 100

/**
 * Past this the two are not out of sync, they are different files — and a
 * runaway value would push every cue off the end of the video.
 */
export const MAX_SUBTITLE_OFFSET_MS = 10_000

/** The two writable numbers of a cue; a real `TextTrackCue` satisfies this. */
export interface CueTiming {
  startTime: number
  endTime: number
}

export function clampOffset(offsetMs: number): number {
  if (Number.isNaN(offsetMs)) return 0
  const clamped = Math.min(MAX_SUBTITLE_OFFSET_MS, Math.max(-MAX_SUBTITLE_OFFSET_MS, offsetMs))
  return Math.round(clamped)
}

/** A step in either direction, which stops at the clamp instead of overshooting. */
export function nudgeOffset(offsetMs: number, deltaMs: number): number {
  return clampOffset(clampOffset(offsetMs) + deltaMs)
}

/**
 * The offset as the menu shows it.
 *
 * Always signed, because "0.4s" alone does not say which way the subtitles
 * moved — which is the only thing the viewer is actually trying to judge.
 */
export function formatOffset(offsetMs: number): string {
  const magnitude = (Math.abs(offsetMs) / 1000).toFixed(1).replace(/\.0$/, '')
  // A value too small to show at this precision reads as none at all; "+0s"
  // would claim a correction that is not visible anywhere.
  if (Number(magnitude) === 0) return '0s'
  return `${offsetMs < 0 ? '-' : '+'}${magnitude}s`
}

/** The file's own times, copied out before anything is written back over them. */
export function captureCueTimes(cues: ArrayLike<CueTiming> | null | undefined): CueTiming[] {
  const captured: CueTiming[] = []
  for (let i = 0; i < (cues?.length ?? 0); i++) {
    const cue = cues![i]
    captured.push({ startTime: cue.startTime, endTime: cue.endTime })
  }
  return captured
}

/*
  Seconds plus a fraction of a second is exactly the arithmetic that produces
  30.400000000000002, and that number then goes back into the cue as its new
  truth. Working in whole milliseconds — which is all the precision a WebVTT
  timestamp carries anyway — keeps a reset to zero landing back on the file's
  own value rather than near it.
*/
const shift = (seconds: number, offsetMs: number) =>
  // Negative cue times are meaningless: the timeline starts at zero, and a cue
  // pushed behind it either never displays or is refused outright. Clamping
  // both ends keeps a cue near the start visible, slightly stretched, instead
  // of losing it.
  Math.max(0, Math.round(seconds * 1000 + offsetMs)) / 1000

export function shiftCueTimes(originals: readonly CueTiming[], offsetMs: number): CueTiming[] {
  return originals.map((cue) => ({
    startTime: shift(cue.startTime, offsetMs),
    endTime: shift(cue.endTime, offsetMs),
  }))
}

/**
 * Bring a live cue list in line with an offset, and report what happened.
 *
 * The caller keeps the returned baseline and hands it back next time. Passing
 * `null` asks for one to be captured, which only succeeds once the browser has
 * actually parsed the track — see `applied`, which is zero while it has not.
 */
export function syncCueOffset(
  cues: ArrayLike<CueTiming> | null | undefined,
  baseline: CueTiming[] | null,
  offsetMs: number,
): { baseline: CueTiming[] | null; applied: number } {
  const count = cues?.length ?? 0
  // Nothing to capture and nothing to write. Any baseline already held is kept:
  // it describes a track whose cues the browser may simply have dropped.
  if (!cues || count === 0) return { baseline, applied: 0 }

  /*
    A mismatched length means the browser re-parsed the file — a stream reload
    builds new <track> elements — so these cues are at their untouched times
    and the old baseline describes a list that no longer exists. Re-capturing
    is the only non-destructive answer.
  */
  const originals = baseline && baseline.length === count ? baseline : captureCueTimes(cues)

  const shifted = shiftCueTimes(originals, offsetMs)
  /*
    The two ends cannot move at once, so one write always lands before the
    other. Moving the trailing edge out of the way first — the end for a shift
    later, the start for a shift earlier — means the cue is never momentarily
    running backwards, which an engine is free to normalise or drop.
  */
  const endFirst = offsetMs >= 0
  for (let i = 0; i < count; i++) {
    if (endFirst) {
      cues[i].endTime = shifted[i].endTime
      cues[i].startTime = shifted[i].startTime
    } else {
      cues[i].startTime = shifted[i].startTime
      cues[i].endTime = shifted[i].endTime
    }
  }

  return { baseline: originals, applied: count }
}

export type SubtitleOffsetStatus =
  /** A client-side text track: its cues are ours to move. */
  | { kind: 'adjustable' }
  | { kind: 'burned-in'; reason: string }
  | { kind: 'off' }

/**
 * Whether the offset control means anything right now.
 *
 * A burned-in track was drawn into the video frames by the server before they
 * were sent, so there are no cues to shift and no honest way to offer the
 * control — the menu says so rather than showing a button that does nothing.
 */
export function subtitleOffsetStatus({
  textTrackIndex,
  burnedSubIndex,
}: {
  textTrackIndex: number | null
  burnedSubIndex: number | undefined
}): SubtitleOffsetStatus {
  if (burnedSubIndex != null) {
    return {
      kind: 'burned-in',
      reason: 'Burned into the picture by the server, so its timing cannot be shifted here.',
    }
  }
  if (textTrackIndex == null) return { kind: 'off' }
  return { kind: 'adjustable' }
}
