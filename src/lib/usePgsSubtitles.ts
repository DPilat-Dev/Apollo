import { useEffect, useRef, useState } from 'react'
import type { SubtitleTrack } from './playback'
import type { PgsSubtitleRenderer } from './pgsRenderer'
import { pgsAspectMode, pgsRenderTimeOffset } from './pgsSubtitles'
import { PGS_PREPARING_AFTER_MS } from './pgsLoading'

/**
 * Starting libpgs for one track, and getting out of the way when it cannot.
 *
 * The same contract `useAssSubtitles` keeps: `active` is false until libpgs is
 * genuinely drawing. The difference is what happens when it is false. For ASS
 * there is a WebVTT conversion to fall back to; for PGS there is nothing —
 * a picture cannot become a `<track>` — so the caller falls back to asking the
 * server to burn it in, which is exactly what Apollo did for every PGS track
 * before this existed.
 */
export function usePgsSubtitles({
  videoRef,
  layerRef,
  track,
  startOffsetSeconds,
  subtitleOffsetMs,
  aspect,
  reloadKey,
  onFailed,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  layerRef: React.RefObject<HTMLDivElement | null>
  track: SubtitleTrack | null
  startOffsetSeconds: number
  subtitleOffsetMs: number
  /** The player's own fit, which the canvas has to match. */
  aspect: string
  reloadKey: unknown
  /**
   * Called when this track cannot be drawn here after all — a stream the
   * server will not hand over, a worker that will not start. The player uses
   * it to fall back to burn-in rather than leaving the viewer with nothing.
   */
  onFailed?: (index: number) => void
}): { active: boolean; preparing: boolean } {
  const [active, setActive] = useState(false)
  /*
    Whether the wait has gone on long enough to be worth explaining. The first
    request for a track inside a Matroska file is the server extracting it, and
    it sends nothing until that is done — three minutes, measured. "Loading
    subtitles…" is true for a second and misleading for the rest of it.
  */
  const [preparing, setPreparing] = useState(false)
  const rendererRef = useRef<PgsSubtitleRenderer | null>(null)

  const offsetRef = useRef({ streamStartOffsetSeconds: startOffsetSeconds, subtitleOffsetMs })
  offsetRef.current = { streamStartOffsetSeconds: startOffsetSeconds, subtitleOffsetMs }
  const aspectRef = useRef(aspect)
  aspectRef.current = aspect
  /* Through a ref: the player passes an inline arrow, and as a dependency it
     would tear down and refetch several megabytes on every render. */
  const failedRef = useRef(onFailed)
  failedRef.current = onFailed

  const wanted = track?.index ?? null
  const url = track?.pgsUrl ?? null

  useEffect(() => {
    const video = videoRef.current
    const layer = layerRef.current
    if (!video || !layer || wanted == null || !url) return

    let cancelled = false
    let canvas: HTMLCanvasElement | null = null

    /*
      The fetch is Apollo's now, not libpgs's.

      Buried inside the renderer there was no way to wait sensibly for it: one
      timeout covered a worker starting and a several-megabyte download and a
      server extracting a track from a Matroska file, and the shortest of those
      set the limit. A minute expired a third of the way into an extraction
      that would have succeeded, and the film reloaded into a burn-in transcode
      for nothing.
    */
    const controller = new AbortController()
    const explain = setTimeout(() => {
      if (!cancelled) setPreparing(true)
    }, PGS_PREPARING_AFTER_MS)

    const start = async () => {
      const [{ createPgsRenderer }, response] = await Promise.all([
        import('./pgsRenderer'),
        fetch(url, { signal: controller.signal }),
      ])
      if (cancelled) return
      if (!response.ok) throw new Error(`The server would not send this subtitle track (${response.status}).`)
      const data = await response.arrayBuffer()
      if (cancelled) return

      /*
        Styled exactly as libpgs styles a canvas it makes for itself. It only
        does that for its own: hand it one and it sets nothing but `object-fit`,
        so ours kept the default 300×150 intrinsic size and drew the subtitles
        into the top-left corner of the frame, at a twentieth of their size.
        Nothing errored — the picture was simply somewhere nobody looks.
      */
      canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      canvas.style.inset = '0'
      canvas.style.width = '100%'
      canvas.style.height = '100%'
      canvas.style.objectFit = pgsAspectMode(aspectRef.current)
      // Every gesture in this player lives on the <video> underneath.
      canvas.style.pointerEvents = 'none'
      layer.appendChild(canvas)

      const renderer = await createPgsRenderer({
        video,
        canvas,
        data,
        timeOffsetSeconds: pgsRenderTimeOffset(offsetRef.current),
        aspect: pgsAspectMode(aspectRef.current),
      })

      if (cancelled) {
        renderer.destroy()
        return
      }
      rendererRef.current = renderer
      setPreparing(false)
      setActive(true)
    }

    start()
      .catch((err) => {
        console.warn('[apollo] could not draw PGS subtitles here', err)
        canvas?.remove()
        // Only after failing: the player then asks the server to burn this
        // track in, which is slow but always works.
        if (!cancelled) failedRef.current?.(wanted)
      })
      .finally(() => {
        // However it ended, nothing is waiting on this any more.
        clearTimeout(explain)
        if (!cancelled) setPreparing(false)
      })

    return () => {
      cancelled = true
      clearTimeout(explain)
      /*
        Only here, where somebody has closed the player or chosen a different
        track. Aborting seems to take the server's extraction with it, so it is
        not something to do on a timer — see `pgsLoading.ts`.
      */
      controller.abort()
      rendererRef.current?.destroy()
      rendererRef.current = null
      canvas?.remove()
      setActive(false)
      setPreparing(false)
    }
  }, [videoRef, layerRef, wanted, url, reloadKey])

  // Delay, on a path with no cues to shift.
  useEffect(() => {
    rendererRef.current?.setTimeOffset(
      pgsRenderTimeOffset({ streamStartOffsetSeconds: startOffsetSeconds, subtitleOffsetMs }),
    )
  }, [active, startOffsetSeconds, subtitleOffsetMs])

  /*
    The canvas has to be told how the video is fitted, or a subtitle positioned
    against the frame lands somewhere else the moment someone switches to Fill.
    This is the thing libass cannot be told, and why ASS carries a known
    limitation under Fill and Stretch while PGS does not.
  */
  useEffect(() => {
    rendererRef.current?.setAspect(pgsAspectMode(aspect))
  }, [active, aspect])

  return { active, preparing }
}
