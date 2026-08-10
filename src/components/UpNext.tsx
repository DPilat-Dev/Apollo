import { useEffect, useRef } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { displayTitle, episodeCode } from '../lib/format'
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
  autoplay,
  onPlay,
  onDismiss,
}: {
  next: BaseItemDto
  /** Seconds remaining in the current episode. */
  secondsLeft: number
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
          {still && <img src={still} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />}
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
            style={{ width: `${Math.min(100, Math.max(0, (1 - countdown / AUTOPLAY_AT) * 100))}%` }}
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

/**
 * How long before the end the card appears. Also the countdown's full length,
 * so the progress bar and the number agree.
 */
export const AUTOPLAY_AT = 20
