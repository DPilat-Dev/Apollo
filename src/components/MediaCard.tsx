import { useNavigate } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import {
  displayTitle,
  formatRuntime,
  itemSubtitle,
  playedFraction,
  remainingLabel,
} from '../lib/format'
import { useSettings } from '../lib/settings'
import { useTogglePlayed } from '../lib/queries'
import { MatchBadge } from './MatchBadge'
import { PlayIcon, ChevronDown, WatchedIcon } from './icons'

export type CardShape = 'poster' | 'landscape'

interface Props {
  item: BaseItemDto
  shape?: CardShape
  /** Landscape cards on the Continue Watching row show a progress bar. */
  showProgress?: boolean
}

/**
 * A row tile. On hover it lifts and reveals a detail tray, the way Netflix
 * expands cards in place — implemented with scale + z-index so it doesn't
 * reflow the row.
 */
export function MediaCard({ item, shape = 'poster', showProgress = false }: Props) {
  const api = useApi()
  const navigate = useNavigate()
  const { reduceMotion } = useSettings()
  const played = useTogglePlayed()

  const isLandscape = shape === 'landscape'
  const img = isLandscape
    ? (api.backdropUrl(item, 640) ?? api.posterUrl(item, 400))
    : (api.posterUrl(item, 400) ?? api.backdropUrl(item, 640))

  const progress = playedFraction(item)
  const watched = Boolean(item.UserData?.Played)
  const detailId = item.Type === 'Episode' ? (item.SeriesId ?? item.Id) : item.Id

  const open = () => navigate(`/item/${detailId}`)
  const play = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(`/watch/${item.Id}`)
  }

  return (
    <div
      className={`group/card relative shrink-0 ${
        isLandscape ? 'w-[17rem] sm:w-[21rem]' : 'w-[9.5rem] sm:w-[11.5rem]'
      }`}
    >
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        className={`relative cursor-pointer rounded-lg outline-none transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/card:z-30 group-hover/card:shadow-2xl group-hover/card:shadow-black/70 ${
          reduceMotion ? '' : 'group-hover/card:scale-[1.09] focus-visible:scale-[1.09]'
        }`}
      >
        <div
          className={`relative overflow-hidden rounded-lg bg-ink-card ${
            isLandscape ? 'aspect-video' : 'aspect-2/3'
          }`}
        >
          {img ? (
            <img
              src={img}
              alt=""
              loading="lazy"
              draggable={false}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-3 text-center text-xs font-medium text-white/40">
              {displayTitle(item)}
            </div>
          )}

          {/* Scrim so the title stays readable over bright art on hover. */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover/card:opacity-100" />

          {/* Resume affordance: one click straight back into playback. */}
          {showProgress && progress > 0 && (
            <button
              onClick={play}
              aria-label={`Resume ${displayTitle(item)}`}
              className="absolute inset-0 flex items-center justify-center bg-black/35 opacity-0 transition-opacity duration-200 group-hover/card:opacity-100"
            >
              <span className="flex size-12 items-center justify-center rounded-full border-2 border-white/90 bg-black/45 backdrop-blur-sm">
                <PlayIcon className="ml-0.5 size-6" />
              </span>
            </button>
          )}

          {showProgress && progress > 0 && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 px-2.5 pb-2.5 pt-6 bg-gradient-to-t from-black/85 to-transparent">
              {remainingLabel(item) && (
                <p className="mb-1.5 text-[11px] font-medium text-white/80">
                  {remainingLabel(item)}
                </p>
              )}
              <div className="h-[3px] overflow-hidden rounded-full bg-white/30">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {item.UserData?.UnplayedItemCount ? (
            <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
              {item.UserData.UnplayedItemCount}
            </span>
          ) : watched ? (
            <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-black">
              <WatchedIcon className="size-4" />
            </span>
          ) : null}
        </div>

        {/* Hover tray — absolutely positioned so it never affects row height. */}
        <div className="pointer-events-none absolute inset-x-0 top-full z-30 origin-top rounded-b-lg bg-ink-card/95 px-3 pb-3 pt-2 opacity-0 shadow-2xl shadow-black/70 backdrop-blur-sm transition-opacity duration-200 group-hover/card:pointer-events-auto group-hover/card:opacity-100">
          <div className="flex items-center gap-2">
            <button
              onClick={play}
              aria-label={`Play ${displayTitle(item)}`}
              className="flex size-8 items-center justify-center rounded-full bg-white text-black transition hover:bg-white/85"
            >
              <PlayIcon className="ml-0.5 size-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                open()
              }}
              aria-label="More info"
              className="flex size-8 items-center justify-center rounded-full border border-white/40 text-white/90 transition hover:border-white"
            >
              <ChevronDown className="size-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                if (item.Id) played.mutate({ itemId: item.Id, played: !watched })
              }}
              disabled={played.isPending}
              aria-label={watched ? 'Mark as unwatched' : 'Mark as watched'}
              title={watched ? 'Mark as unwatched' : 'Mark as watched'}
              className={`ml-auto flex size-8 items-center justify-center rounded-full border transition disabled:opacity-50 ${
                watched
                  ? 'border-emerald-400 text-emerald-400'
                  : 'border-white/40 text-white/80 hover:border-white'
              }`}
            >
              <WatchedIcon className="size-4" filled={watched} />
            </button>
          </div>

          <p className="mt-2 line-clamp-1 text-[13px] font-semibold text-white">
            {displayTitle(item)}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-white/55">
            <MatchBadge item={item} />
            {item.OfficialRating && (
              <span className="border border-white/25 px-1 leading-tight">{item.OfficialRating}</span>
            )}
            {formatRuntime(item.RunTimeTicks) && <span>{formatRuntime(item.RunTimeTicks)}</span>}
          </p>
          {item.Genres && item.Genres.length > 0 && (
            <p className="mt-1 line-clamp-1 text-[11px] text-white/45">
              {item.Genres.slice(0, 3).join(' · ')}
            </p>
          )}
        </div>
      </div>

      {/* Static caption, hidden while the tray is open to avoid doubled titles. */}
      <div className="mt-2 px-0.5 transition-opacity duration-200 group-hover/card:opacity-0">
        <p className="line-clamp-1 text-[13px] font-medium text-white/85">{displayTitle(item)}</p>
        {itemSubtitle(item) && (
          <p className="line-clamp-1 text-[11px] text-white/45">{itemSubtitle(item)}</p>
        )}
      </div>
    </div>
  )
}

export function CardSkeleton({ shape = 'poster' }: { shape?: CardShape }) {
  const isLandscape = shape === 'landscape'
  return (
    <div className={`shrink-0 ${isLandscape ? 'w-[17rem] sm:w-[20rem]' : 'w-[9.5rem] sm:w-[11.5rem]'}`}>
      <div className={`skeleton rounded-lg ${isLandscape ? 'aspect-video' : 'aspect-2/3'}`} />
      <div className="skeleton mt-2 h-3 w-3/4 rounded" />
    </div>
  )
}
