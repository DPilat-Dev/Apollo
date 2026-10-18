import type { ReactNode } from 'react'
import { errorText } from '../lib/api'

/**
 * A request that failed, said in one sentence, with the way out beside it.
 *
 * There were eighteen copies of this markup across eleven files, which is
 * eighteen places for the next one to drift: a different border, a button that
 * reads the raw `e.message` and puts `GET /Items failed (500)` on screen, or an
 * error state with no retry in it at all. The distinction it exists to keep —
 * "this could not be loaded" is not "there is none of this" — is only worth
 * anything if every screen draws it the same way.
 *
 * `fallback` is what the sentence says when the error is one the viewer can do
 * nothing with; `errorText` decides which of the two to use.
 */
export function LoadFailure({
  error,
  fallback,
  onRetry,
  label = 'Retry',
  busy = false,
  className = '',
  children,
}: {
  error: unknown
  /** Plain words for a technical error — see `errorText`. */
  fallback: string
  /** Left out where the screen has no way to ask again — see `Row`. */
  onRetry?: () => void
  /** "Try again", where part of the list is already on screen. */
  label?: string
  /**
   * A retry already in flight.
   *
   * The button stays where it is while one runs, so this is the only sign the
   * press did anything: an infinite query that is already in error keeps
   * `status: 'error'` through the refetch, so nothing else on the panel moves
   * between the press and the answer.
   */
  busy?: boolean
  className?: string
  /** A second way out, where the screen has one — ItemDetail's link home. */
  children?: ReactNode
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-ink-soft/50 px-4 py-3 ${className}`}
    >
      <p className="text-sm text-white/55">{errorText(error, fallback)}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          disabled={busy}
          className="rounded border border-white/20 px-3 py-1 text-xs transition hover:border-white/50 disabled:opacity-60"
        >
          {busy ? 'Retrying…' : label}
        </button>
      )}
      {children}
    </div>
  )
}
