import JASSUB from 'jassub'
import workerUrl from 'jassub/dist/worker/worker.js?worker&url'
import wasmUrl from 'jassub/dist/wasm/jassub-worker.wasm?url'
import modernWasmUrl from 'jassub/dist/wasm/jassub-worker-modern.wasm?url'
import defaultFontUrl from 'jassub/dist/default.woff2?url'

/**
 * libass, in a worker, drawing onto a canvas over the video.
 *
 * This file exists to be the far side of a dynamic import and nothing else.
 * Every static import here is a megabyte or two of WebAssembly and font, so
 * nothing may reach it except through `import('./assRenderer')` — the same
 * shape hls.js is loaded with, and for the same reason: the overwhelming
 * majority of sessions never need it.
 *
 * None of this is unit-tested, and saying so is more useful than pretending
 * otherwise. It is a Worker, an OffscreenCanvas, a WebAssembly instance and a
 * `requestVideoFrameCallback` loop; there is no part of it that means anything
 * without a browser, and this repo's tests run in node with no DOM by design.
 * The decisions that *can* be tested — which codecs come here, what URL the
 * file is at, when to give up and use `<track>` instead, and every piece of
 * time and size arithmetic — were deliberately pushed out into
 * `assSubtitles.ts`, which is tested thoroughly.
 */

export interface AssRenderer {
  /** Replace the script being drawn — used when subtitle size changes. */
  setContent(content: string): void
  /** Where in the subtitle file to draw from. See `assRenderTimeOffset`. */
  setTimeOffset(seconds: number): void
  destroy(): void
}

/**
 * How long to wait for the worker before deciding it is not coming.
 *
 * A worker that fails to start does not always reject: an unreachable chunk or
 * a WASM instantiation that never resolves leaves the ready promise pending
 * forever, and a viewer would sit in front of a subtitle-less video with
 * nothing having gone visibly wrong. Ten seconds is far longer than a local
 * server needs and short enough that giving up still feels like part of
 * starting playback.
 */
const READY_TIMEOUT_MS = 10_000

export async function createAssRenderer({
  video,
  canvas,
  content,
  fontUrls,
  timeOffsetSeconds,
}: {
  video: HTMLVideoElement
  /**
   * Ours, not JASSUB's. Left to itself it inserts a canvas as the video's
   * next sibling, which puts a node React did not create in the middle of a
   * list React reconciles. Handing one over keeps the DOM ownership honest —
   * JASSUB still positions and sizes it on every resize.
   */
  canvas: HTMLCanvasElement
  content: string
  fontUrls: string[]
  timeOffsetSeconds: number
}): Promise<AssRenderer> {
  const instance = new JASSUB({
    video,
    canvas,
    subContent: content,
    workerUrl,
    wasmUrl,
    modernWasmUrl,
    /*
      Fonts named by an ASS file have to come from somewhere: the eight files
      measured in the library this was built against carry no [Fonts] section
      at all. These are the server's fallback fonts, which is where CJK
      coverage lives on a server that has any.
    */
    fonts: fontUrls,
    /*
      Liberation Sans is metrically an Arial, which is what most ASS files ask
      for, and it ships with JASSUB. Naming it here rather than letting JASSUB
      reach for its own copy keeps the URL something Vite has emitted and
      fingerprinted, instead of an `import.meta.url` resolved inside a
      pre-bundled dependency.
    */
    availableFonts: { 'liberation sans': defaultFontUrl },
    defaultFont: 'liberation sans',
    /*
      Off. `local` reads the Local Font Access API, which is inert without a
      permission nobody watching a film has granted, and `localandremote`
      would send the font names in someone's subtitles to Google. Neither is
      worth it when the server already offers a fallback set.
    */
    queryFonts: false,
    timeOffset: timeOffsetSeconds,
  })

  try {
    await withTimeout(instance.ready, instance)
  } catch (err) {
    // Destroy before rethrowing: a half-started instance still holds a worker
    // and, worse, may start drawing over the <track> we are about to fall back
    // to. Two sets of subtitles is a worse failure than the one we are handling.
    void instance.destroy().catch(() => {})
    throw err
  }

  return {
    setContent(next: string) {
      void Promise.resolve(instance.renderer.setTrack(next)).catch(() => {})
    },
    setTimeOffset(seconds: number) {
      instance.timeOffset = seconds
    },
    destroy() {
      void instance.destroy().catch(() => {})
    },
  }
}

function withTimeout(ready: Promise<void>, instance: { _worker?: Worker }): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The subtitle renderer did not start in time.')),
      READY_TIMEOUT_MS,
    )
    // A worker that throws while loading reports it here and nowhere else; the
    // ready promise simply never settles.
    const onError = () => reject(new Error('The subtitle renderer failed to load.'))
    instance._worker?.addEventListener('error', onError)
    ready
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer)
        instance._worker?.removeEventListener('error', onError)
      })
  })
}
