import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'

/** Jellyfin measures time in 100-nanosecond ticks. */
export const TICKS_PER_MS = 10_000
export const TICKS_PER_SECOND = 10_000_000

export const ticksToSeconds = (ticks: number) => ticks / TICKS_PER_SECOND
export const secondsToTicks = (seconds: number) => Math.round(seconds * TICKS_PER_SECOND)

/** "1h 47m" — for runtimes shown next to a title. */
export function formatRuntime(ticks?: number | null): string | null {
  if (!ticks) return null
  const totalMinutes = Math.round(ticks / TICKS_PER_SECOND / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

/** "1:47:23" / "4:05" — for player timecodes. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const s = Math.floor(seconds % 60)
  const m = Math.floor((seconds / 60) % 60)
  const h = Math.floor(seconds / 3600)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Fraction 0–1 of how far through an item the user is. */
export function playedFraction(item: BaseItemDto): number {
  const pct = item.UserData?.PlayedPercentage
  if (typeof pct === 'number' && pct > 0) return Math.min(pct / 100, 1)
  const ticks = item.UserData?.PlaybackPositionTicks
  if (ticks && item.RunTimeTicks) return Math.min(ticks / item.RunTimeTicks, 1)
  return 0
}

/** "42m left" / "1h 12m left" — the nudge shown on Continue Watching tiles. */
export function remainingLabel(item: BaseItemDto): string | null {
  const total = item.RunTimeTicks
  if (!total) return null
  const position = item.UserData?.PlaybackPositionTicks ?? 0
  const left = formatRuntime(total - position)
  return left ? `${left} left` : null
}

export function isResumable(item: BaseItemDto): boolean {
  const f = playedFraction(item)
  return f > 0.01 && f < 0.95
}

/** "S2:E5" for episodes, null otherwise. */
export function episodeCode(item: BaseItemDto): string | null {
  if (item.Type !== 'Episode') return null
  const s = item.ParentIndexNumber
  const e = item.IndexNumber
  if (s == null && e == null) return null
  if (s == null) return `E${e}`
  return e == null ? `S${s}` : `S${s}:E${e}`
}

/** The line shown under a card: episode code + name, or year + runtime. */
export function itemSubtitle(item: BaseItemDto): string | null {
  if (item.Type === 'Episode') {
    const code = episodeCode(item)
    return [code, item.Name].filter(Boolean).join(' · ')
  }
  return [item.ProductionYear, formatRuntime(item.RunTimeTicks)].filter(Boolean).join(' · ') || null
}

/** What we show as the big title — episodes surface the series name. */
export function displayTitle(item: BaseItemDto): string {
  if (item.Type === 'Episode' && item.SeriesName) return item.SeriesName
  return item.Name ?? 'Untitled'
}

export function ratingStars(item: BaseItemDto): string | null {
  const r = item.CommunityRating
  return typeof r === 'number' ? r.toFixed(1) : null
}

