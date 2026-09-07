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

/**
 * How long to wait before deciding the renderer is not coming.
 *
 * A PGS stream is large — 7 MB for a single episode in the library this was
 * built against, and larger for a film — so this is far more generous than the
 * ten seconds libass gets. It is still bounded: a viewer must not sit in front
 * of a subtitle-less video forever because a fetch quietly stalled.
 */
const READY_TIMEOUT_MS = 60_000

export async function createPgsRenderer({
  video,
  canvas,
  url,
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
  url: string
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
    subUrl: url,
    workerUrl,
    timeOffset: timeOffsetSeconds,
    aspectRatio: aspect,
  })

  try {
    await withTimeout(instance.ready)
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
      READY_TIMEOUT_MS,
    )
    ready.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
