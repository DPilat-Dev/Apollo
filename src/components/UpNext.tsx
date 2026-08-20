import { useEffect, useRef } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { displayTitle, episodeCode } from '../lib/format'
import { blurhashBackground } from '../lib/blurhash'
import { PlayIcon } from './icons'

/**
 * The card that slides in near the end of an episode.
 *
 * Two ways out, always: play now, or dismiss. Dismissing has to stop the
 * countdown as well as hide the card — a timer that keeps running after you
 * said no is the thing people hate about this pattern.
 */
export function UpNext({
  next,
  secondsLeft,
  windowSeconds,
  autoplay,
  onPlay,
  onDismiss,
}: {
  next: BaseItemDto
  /** Seconds remaining in the current episode. */
  secondsLeft: number
  /**
   * How long the card is on screen for, so the bar fills across exactly the
   * time it is visible. Varies per episode once credits detection has a say.
   */
  windowSeconds: number
  /** When false the card still appears, but nothing happens on its own. */
  autoplay: boolean
  onPlay: () => void
  onDismiss: () => void
}) {
  const api = useApi()
  const still = api.stillUrl(next, 400)
  const countdown = Math.max(0, Math.ceil(secondsLeft))

  // Fire once. Without the guard the parent's re-render on every timeupdate
  // would call onPlay repeatedly as the clock sits at zero.
  const fired = useRef(false)
  useEffect(() => {
    if (!autoplay || fired.current || countdown > 0) return
    fired.current = true
    onPlay()
  }, [autoplay, countdown, onPlay])

  return (
    <div className="pointer-events-auto absolute bottom-28 right-4 z-30 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/15 bg-black/90 shadow-2xl backdrop-blur sm:bottom-32 sm:right-8">
      <div className="flex gap-3 p-3">
        <div className="aspect-video w-28 shrink-0 overflow-hidden rounded bg-ink-card">
          {still && <img
            src={still}
            alt=""
            loading="lazy"
            decoding="async"
            style={blurhashBackground(next, still)}
            className="h-full w-full object-cover"
          />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-white/45">
            {autoplay ? `Next episode in ${countdown}s` : 'Up next'}
          </p>
          <p className="mt-1 line-clamp-1 text-sm font-semibold">{displayTitle(next)}</p>
          <p className="line-clamp-1 text-xs text-white/55">
            {[episodeCode(next), next.Name].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>

      {autoplay && (
        <div className="h-0.5 bg-white/15">
          <div
            className="h-full bg-accent transition-[width] duration-1000 ease-linear"
            style={{ width: `${progressPercent(countdown, windowSeconds)}%` }}
          />
        </div>
      )}

      <div className="flex gap-2 p-3 pt-2.5">
        <button
          onClick={onPlay}
          className="flex flex-1 items-center justify-center gap-1.5 rounded bg-white px-3 py-2 text-sm font-semibold text-black transition hover:bg-white/85"
        >
          <PlayIcon className="size-4" />
          Play now
        </button>
        <button
          onClick={onDismiss}
          className="rounded border border-white/25 px-4 py-2 text-sm text-white/80 transition hover:border-white/50 hover:text-white"
        >
          Hide
        </button>
      </div>
    </div>
  )
}

/** How full the countdown bar is, given the seconds left of a window. */
export function progressPercent(secondsLeft: number, windowSeconds: number): number {
  if (!(windowSeconds > 0)) return 0
  return Math.min(100, Math.max(0, (1 - secondsLeft / windowSeconds) * 100))
}

/**
 * How long before the end the card appears when nothing better is known.
 *
 * Twenty seconds was not enough time to reach for a phone and press Hide
 * before the next episode started itself.
 */
export const UP_NEXT_AT = 45

/**
 * The earliest the card may appear, however long the credits run.
 *
 * A misdetected outro covering half the episode would otherwise park the card
 * on screen for minutes, and a feature-length credit roll is not a cue that
 * this episode is nearly over.
 */
export const UP_NEXT_MAX = 120

/**
 * How long before the end the card should appear for this episode.
 *
 * Where the server has detected credits, that is the honest answer: the moment
 * the episode is over in every sense but the clock. Elsewhere it falls back to
 * a fixed lead, and either way it is never *later* than that fallback.
 */
export function upNextLeadSeconds(
  durationSeconds: number,
  creditsStartSeconds: number | null,
): number {
  if (!(durationSeconds > 0) || creditsStartSeconds == null) return UP_NEXT_AT
  const lead = durationSeconds - creditsStartSeconds
  const ceiling = Math.max(Math.min(UP_NEXT_MAX, durationSeconds * 0.25), UP_NEXT_AT)
  return Math.min(Math.max(lead, UP_NEXT_AT), ceiling)
}
