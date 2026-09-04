/**
 * What the spinner should say it is waiting for.
 *
 * Most waits in this player are a second or two. One is not: choosing an
 * image-based subtitle track — PGS or VOBSUB, which is 1,359 of the 2,092
 * subtitle streams in one real library — cannot be sent as text, so the server
 * re-encodes the video with the subtitles painted into the frames. That takes
 * as long as it takes, and on a large file it is tens of seconds.
 *
 * The player already knows which of these it is doing. A bare spinner for
 * twenty seconds reads as broken; the same twenty seconds with a sentence
 * under it reads as work.
 */
export interface LoadingContext {
  /** A subtitle track being painted into the video, by index. */
  burnedSubIndex: number | undefined
  /** True while the stream is being resolved again after a change. */
  reloading: boolean
  /** True on the very first resolve for an item, before anything has played. */
  firstLoad: boolean
  /** The player is stalled on data rather than waiting for a new stream. */
  buffering: boolean
}

export interface LoadingMessage {
  headline: string
  detail?: string
}

export function playerLoadingMessage(ctx: LoadingContext): LoadingMessage | null {
  /*
    The burn-in case is checked before everything, including the first load: an
    item opened with a burned track already chosen goes straight into the long
    wait, and that is exactly when an unexplained spinner is most alarming.
  */
  if (ctx.burnedSubIndex != null && (ctx.reloading || ctx.firstLoad)) {
    return {
      headline: 'Burning in subtitles',
      detail:
        'This track is a picture rather than text, so the server is re-encoding the video with it. It can take a while.',
    }
  }

  if (ctx.reloading) {
    return { headline: 'Switching stream', detail: 'Picking up where you left off.' }
  }

  // The ordinary two seconds before a first frame, and a stall mid-episode.
  // Neither is worth a sentence — a spinner already says "wait" well enough.
  if (ctx.firstLoad || ctx.buffering) return null

  return null
}
