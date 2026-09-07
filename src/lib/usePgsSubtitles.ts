import { useEffect, useRef, useState } from 'react'
import type { SubtitleTrack } from './playback'
import type { PgsSubtitleRenderer } from './pgsRenderer'
import { pgsAspectMode, pgsRenderTimeOffset } from './pgsSubtitles'

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
}): { active: boolean } {
  const [active, setActive] = useState(false)
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

    const start = async () => {
      const { createPgsRenderer } = await import('./pgsRenderer')
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
        url,
        timeOffsetSeconds: pgsRenderTimeOffset(offsetRef.current),
        aspect: pgsAspectMode(aspectRef.current),
      })

      if (cancelled) {
        renderer.destroy()
        return
      }
      rendererRef.current = renderer
      setActive(true)
    }

    start().catch((err) => {
      console.warn('[apollo] could not draw PGS subtitles here', err)
      canvas?.remove()
      // Only after failing: the player then asks the server to burn this track
      // in, which is slow but always works.
      if (!cancelled) failedRef.current?.(wanted)
    })

    return () => {
      cancelled = true
      rendererRef.current?.destroy()
      rendererRef.current = null
      canvas?.remove()
      setActive(false)
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

  return { active }
}
