import { useMemo } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useTasteProfile } from '../lib/queries'
import { EMPTY_PROFILE, scoreMatch, type MatchResult } from '../lib/taste'

export function useMatch(item: BaseItemDto): MatchResult {
  const { data: profile } = useTasteProfile()
  return useMemo(
    () => scoreMatch(profile ?? EMPTY_PROFILE, item),
    [profile, item],
  )
}

/**
 * Shows a personalised match when there's enough history to justify one, and
 * falls back to the community rating when there isn't — rather than dressing
 * a rating up as a match, which is what this used to do.
 */
export function MatchBadge({
  item,
  showReasons = false,
  className = '',
}: {
  item: BaseItemDto
  showReasons?: boolean
  className?: string
}) {
  const { percent, reasons } = useMatch(item)

  if (percent != null) {
    return (
      <span className={`inline-flex items-baseline gap-1.5 ${className}`}>
        <span className="font-semibold text-emerald-400">{percent}% match</span>
        {showReasons && reasons.length > 0 && (
          <span className="text-white/40">· {reasons.join(', ')}</span>
        )}
      </span>
    )
  }

  const rating = item.CommunityRating
  if (typeof rating !== 'number') return null
  return (
    <span className={`inline-flex items-baseline gap-1 text-white/70 ${className}`}>
      <span aria-hidden>★</span>
      <span className="tabular-nums">{rating.toFixed(1)}</span>
    </span>
  )
}
