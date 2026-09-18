import { PgsRenderer } from 'libpgs'
import workerUrl from 'libpgs/dist/libpgs.worker.js?url'

/**
 * libpgs, decoding bitmap subtitles onto a canvas over the video.
 *
 * The far side of a dynamic import, like `assRenderer.ts` and for the same
 * reason: most sessions never play a PGS track, and nothing should reach this
 * except through `import('./pgsRenderer')`.
 *
 * Also untested, and worth saying so. It is a worker, a canvas and a
 * `timeupdate` loop; the decisions that can be tested — which codecs come
 * here, what URL the stream is at, when to leave it to the server, and every
 * piece of aspect and time arithmetic — are in `pgsSubtitles.ts`.
 */

export interface PgsSubtitleRenderer {
  setTimeOffset(seconds: number): void
  setAspect(mode: 'contain' | 'cover' | 'fill'): void
  destroy(): void
}

import { PGS_RENDER_TIMEOUT_MS } from './pgsLoading'

export async function createPgsRenderer({
  video,
  canvas,
  data,
  timeOffsetSeconds,
  aspect,
}: {
  video: HTMLVideoElement
  /**
   * Ours, not libpgs's. Left to itself it inserts a canvas as the video's
   * sibling, which puts a node React did not create into a list React
   * reconciles — the same reason the ASS renderer is handed one.
   */
  canvas: HTMLCanvasElement
  /**
   * The stream itself, not a URL to it.
   *
   * libpgs will happily fetch its own, and that is how this started — but the
   * fetch is the slow and failure-prone half of starting a PGS track, and
   * burying it in here left no way to wait sensibly, say what was happening,
   * or tell a server still extracting from a server that is never going to
   * answer. `pgsLoading.ts` has the measurements.
   */
  data: ArrayBuffer
  timeOffsetSeconds: number
  aspect: 'contain' | 'cover' | 'fill'
}): Promise<PgsSubtitleRenderer> {
  /*
    No cast here, deliberately. The first version of this passed `aspect` and
    silenced the type error with one — libpgs calls the option `aspectRatio`,
    so every positioned subtitle would have been laid out for the wrong fit
    with nothing to say so.
  */
  const instance = new PgsRenderer({
    video,
    canvas,
    workerUrl,
    timeOffset: timeOffsetSeconds,
    aspectRatio: aspect,
  })

  try {
    /*
      `ready` first, then the bytes. Built with no `subUrl`, so `ready` is just
      the worker coming up; `loadFromBuffer` is the parse. Both inside the one
      timeout, because either can be the thing that never finishes.
    */
    await withTimeout(instance.ready.then(() => instance.loadFromBuffer(data)))
  } catch (err) {
    // Disposed before rethrowing: a half-started renderer still holds a worker
    // and may yet paint over the burn-in fallback we are about to fall back to.
    try {
      instance.dispose()
    } catch {
      /* already gone */
    }
    throw err
  }

  return {
    setTimeOffset(seconds: number) {
      instance.timeOffset = seconds
    },
    setAspect(mode) {
      instance.aspectRatio = mode
    },
    destroy() {
      try {
        instance.dispose()
      } catch {
        /* already gone */
      }
    },
  }
}

function withTimeout(ready: Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('The subtitle renderer did not start in time.')),
      PGS_RENDER_TIMEOUT_MS,
    )
    ready.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
