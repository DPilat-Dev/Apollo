import { useEffect, useRef, useState } from 'react'
import type { JellyfinApi } from './api'
import type { SubtitleTrack } from './playback'
import type { AssRenderer } from './assRenderer'
import {
  assAspectScale,
  assRenderTimeOffset,
  pickFallbackFonts,
  scaleAssFontSizes,
} from './assSubtitles'

/**
 * Starting libass for one track, and — far more importantly — getting out of
 * the way when it cannot start.
 *
 * The contract this hook exists to keep is that `active` is false until libass
 * is genuinely drawing, and goes back to false the moment it is not. The player
 * leaves the `<track>` element showing whenever `active` is false, so every
 * failure here — an unreachable `.ass`, a worker that will not load, a browser
 * without OffscreenCanvas, an import that 404s after a deploy — ends with the
 * viewer watching the server's WebVTT conversion instead of nothing at all.
 *
 * The order matters and is deliberate: `<track>` shows first and is switched
 * off only once the canvas is up. The cost is a fraction of a second of the
 * plainer subtitles at the start of a track; the alternative is a gap with no
 * subtitles at all every time, in exchange for never seeing the fallback.
 */
export function useAssSubtitles({
  videoRef,
  layerRef,
  api,
  track,
  itemId,
  mediaSourceId,
  startOffsetSeconds,
  subtitleOffsetMs,
  sizePercent,
  aspect,
  reloadKey,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>
  /** An empty, React-owned box the canvas is put inside. */
  layerRef: React.RefObject<HTMLDivElement | null>
  api: JellyfinApi
  /** The ASS track to render, or null to leave this to the `<track>` element. */
  track: SubtitleTrack | null
  itemId: string | undefined
  mediaSourceId: string | undefined
  /** What a transcode cut off the front, which the subtitle file still counts. */
  startOffsetSeconds: number
  subtitleOffsetMs: number
  sizePercent: number
  /** How the video element is showing the picture: fit, fill or stretch. */
  aspect: string
  /** Changes whenever the stream is rebuilt, as it does for `useSubtitleOffset`. */
  reloadKey: unknown
}): { active: boolean } {
  const [active, setActive] = useState(false)
  const rendererRef = useRef<AssRenderer | null>(null)
  /** JASSUB's canvas, kept so the aspect effect below can transform it. */
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** The file as the server sent it, so a size change re-scales from the original. */
  const contentRef = useRef<string | null>(null)

  /*
    Size and delay are read once at startup and then driven by their own
    effects below. Through refs, because putting them in this effect's
    dependencies would tear down the worker and refetch the subtitle file every
    time somebody pressed the + button.
  */
  const sizeRef = useRef(sizePercent)
  sizeRef.current = sizePercent
  /** What the renderer was last handed, so it is not re-parsed for nothing. */
  const appliedSizeRef = useRef<number | null>(null)
  const offsetRef = useRef({
    streamStartOffsetSeconds: startOffsetSeconds,
    subtitleOffsetMs,
  })
  offsetRef.current = { streamStartOffsetSeconds: startOffsetSeconds, subtitleOffsetMs }

  /** The index alone, because the track object is rebuilt on every render. */
  const wanted = track?.index ?? null

  useEffect(() => {
    const video = videoRef.current
    const layer = layerRef.current
    if (!video || !layer || wanted == null || !itemId || !mediaSourceId) return

    let cancelled = false
    let canvas: HTMLCanvasElement | null = null

    const start = async () => {
      /*
        The file and the fonts first, then the renderer. If the server will not
        hand over the raw .ass there is no point fetching two megabytes of
        WebAssembly to find that out — and the fallback is already on screen.
      */
      const content = await api.assSubtitle(itemId, mediaSourceId, wanted)
      const fonts = pickFallbackFonts(await api.fallbackFonts())
      if (cancelled) return

      const { createAssRenderer } = await import('./assRenderer')
      if (cancelled) return

      /*
        Created here rather than rendered by React: `transferControlToOffscreen`
        can be called once per canvas ever, so a canvas React kept and reused
        across a track change would refuse the second renderer outright. A
        fresh element each time is the only version of this that survives
        switching subtitle tracks.
      */
      canvas = document.createElement('canvas')
      canvas.style.position = 'absolute'
      // The player's tap, swipe and long-press gestures all live on the
      // <video> underneath. A canvas that ate pointer events would break
      // every one of them.
      canvas.style.pointerEvents = 'none'
      /*
        The scale applied for Fill and Stretch is about the canvas's own
        centre, which is where JASSUB centres it. Named rather than left to the
        default so it survives anyone reaching for `transform` here later.
      */
      canvas.style.transformOrigin = 'center'
      layer.appendChild(canvas)
      canvasRef.current = canvas

      // Read once, not either side of the await: somebody pressing + while the
      // worker boots would otherwise have the size recorded as applied when it
      // was the previous one that went in.
      const size = sizeRef.current
      const renderer = await createAssRenderer({
        video,
        canvas,
        content: scaleAssFontSizes(content, size),
        fontUrls: fonts.map((name) => api.fallbackFontUrl(name)),
        timeOffsetSeconds: assRenderTimeOffset(offsetRef.current),
      })

      if (cancelled) {
        renderer.destroy()
        return
      }
      contentRef.current = content
      appliedSizeRef.current = size
      rendererRef.current = renderer
      setActive(true)
    }

    start().catch((err) => {
      // Warned about, never surfaced. The viewer has subtitles either way, and
      // an error toast over a film that is playing correctly is worse than the
      // slightly plainer subtitles they are already reading.
      console.warn('[apollo] falling back to the converted subtitle track', err)
      canvas?.remove()
    })

    return () => {
      cancelled = true
      canvasRef.current = null
      rendererRef.current?.destroy()
      rendererRef.current = null
      contentRef.current = null
      appliedSizeRef.current = null
      canvas?.remove()
      setActive(false)
    }
    // `wanted` rather than `track`: the object is rebuilt on every render of
    // the plan, and depending on it would restart libass continuously.
  }, [videoRef, layerRef, api, wanted, itemId, mediaSourceId, reloadKey])

  /*
    Following the picture under Fill and Stretch.
    See `assAspectScale` for why this is a transform rather than a layout.

    Recomputed on three things because all three move the answer: the viewer
    changing the mode, the element changing shape (a window resize, entering
    fullscreen, a phone turning), and the video reporting dimensions — which
    for a transcode arrives well after the element exists, and again whenever
    the stream is rebuilt at a different resolution.
  */
  useEffect(() => {
    const video = videoRef.current
    const layer = layerRef.current
    if (!active || !video || !layer) return

    const apply = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const { x, y } = assAspectScale(aspect, {
        elementWidth: layer.clientWidth,
        elementHeight: layer.clientHeight,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      })
      // Cleared rather than set to scale(1, 1): an identity transform still
      // promotes the canvas to its own layer on some compositors, and this is
      // the case that runs for everyone who never touches the aspect control.
      canvas.style.transform = x === 1 && y === 1 ? '' : `scale(${x}, ${y})`
    }

    apply()
    const observer = new ResizeObserver(apply)
    observer.observe(layer)
    video.addEventListener('resize', apply)
    return () => {
      observer.disconnect()
      video.removeEventListener('resize', apply)
    }
  }, [active, aspect, videoRef, layerRef])

  // Subtitle delay, on the path where there are no cues to shift.
  useEffect(() => {
    rendererRef.current?.setTimeOffset(
      assRenderTimeOffset({ streamStartOffsetSeconds: startOffsetSeconds, subtitleOffsetMs }),
    )
  }, [active, startOffsetSeconds, subtitleOffsetMs])

  /*
    Subtitle size, which for ASS means rewriting the script's own sizes and
    handing libass the whole file again. Skipped when the size has not actually
    moved since the last one — otherwise becoming active would immediately
    re-parse the file it was just built from.
  */
  useEffect(() => {
    const content = contentRef.current
    if (!content || appliedSizeRef.current === sizePercent) return
    appliedSizeRef.current = sizePercent
    rendererRef.current?.setContent(scaleAssFontSizes(content, sizePercent))
  }, [active, sizePercent])

  return { active }
}
