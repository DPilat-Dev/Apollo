import { useCallback, useEffect, useRef, useState } from 'react'
import {
  SUBTITLE_OFFSET_STEP_MS,
  nudgeOffset,
  syncCueOffset,
  type CueTiming,
} from './subtitleOffset'

/**
 * The offset control, wired to the live cues of the showing text track.
 *
 * All the arithmetic lives in `subtitleOffset`; what is left here is the two
 * things a browser makes awkward.
 *
 * The first is that a `<track>` fetches and parses its file asynchronously.
 * `track.cues` is an empty list — not null, not a promise — until it has, so an
 * offset applied in that window writes to nothing and reads as a dead button.
 * The apply is therefore retried on the element's `load` event, and also on a
 * short poll, because a track the browser had already cached fires `load`
 * before this effect can subscribe and some engines populate `cues` a tick
 * after it.
 *
 * The second is that cue times are the browser's only copy of what the file
 * said, so `syncCueOffset` is handed a baseline to work from and the baseline
 * is thrown away only when the track itself is replaced.
 */
export function useSubtitleOffset({
  videoRef,
  textTrackIndex,
  itemKey,
  reloadKey,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  textTrackIndex: number | null
  /** The item being watched, so the correction does not follow it to the next one. */
  itemKey: unknown
  /**
   * Anything that changes when the `<track>` elements are rebuilt — a reload
   * hands back a different `TextTrack` for the same index, and without this
   * the offset would be left applied to cues that no longer exist.
   */
  reloadKey: unknown
}) {
  const [offsetMs, setOffsetMs] = useState(0)
  const baselineRef = useRef<CueTiming[] | null>(null)
  const baselineForRef = useRef<TextTrack | null>(null)

  /*
    Reset per track and per item, rather than remembering an offset.

    An offset measures how far one particular subtitle file drifts from one
    particular audio track; another track, or the next episode, is another file
    with its own drift or none at all, so carrying the number over would
    silently apply a correction nobody measured — and a viewer who never opens
    this menu again would have no idea why the subtitles were now wrong.

    It does survive a stream reload, which is the one case where the file has
    not changed: a quality or audio switch rebuilds the <track> elements, and
    losing the correction there would read as the player forgetting.
  */
  useEffect(() => {
    setOffsetMs(0)
  }, [textTrackIndex, itemKey])

  useEffect(() => {
    const video = videoRef.current
    if (!video || textTrackIndex == null) return

    const track = Array.from(video.textTracks).find((t) => Number(t.id) === textTrackIndex)
    if (!track) return

    // A track element that has been swapped out takes its cues with it, so the
    // baseline is only meaningful for the track it was captured from.
    if (baselineForRef.current !== track) {
      baselineForRef.current = track
      baselineRef.current = null
    }

    let stop: (() => void) | null = null

    const apply = () => {
      const result = syncCueOffset(track.cues, baselineRef.current, offsetMs)
      baselineRef.current = result.baseline
      if (result.applied > 0) stop?.()
    }

    const element = Array.from(video.querySelectorAll('track')).find(
      (el) => el.track === track,
    )
    element?.addEventListener('load', apply)
    // Give up after a few seconds: by then the track has either loaded or
    // failed, and a poll that never ends would outlive the episode.
    const poll = window.setInterval(apply, 250)
    const giveUp = window.setTimeout(() => window.clearInterval(poll), 8_000)

    stop = () => window.clearInterval(poll)
    apply()

    return () => {
      element?.removeEventListener('load', apply)
      window.clearInterval(poll)
      window.clearTimeout(giveUp)
    }
  }, [videoRef, textTrackIndex, offsetMs, reloadKey])

  const nudge = useCallback(
    (steps: number) => setOffsetMs((current) => nudgeOffset(current, steps * SUBTITLE_OFFSET_STEP_MS)),
    [],
  )
  const reset = useCallback(() => setOffsetMs(0), [])

  return { offsetMs, nudge, reset }
}
