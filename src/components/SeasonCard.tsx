import { useNavigate } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { useTogglePlayed } from '../lib/queries'
import { WatchedIcon } from './icons'

/**
 * A season on a series page. Falls back to the series' own poster, because
 * plenty of libraries have no per-season artwork and a grid of grey boxes
 * makes a show look broken.
 */
export function SeasonCard({ season, series }: { season: BaseItemDto; series: BaseItemDto }) {
  const api = useApi()
  const navigate = useNavigate()
  const played = useTogglePlayed()

  const poster = api.posterUrl(season, 400) ?? api.posterUrl(series, 400)
  const unplayed = season.UserData?.UnplayedItemCount ?? 0
  const watched = Boolean(season.UserData?.Played) || (season.ChildCount != null && unplayed === 0)

  const open = () => season.Id && navigate(`/item/${season.Id}`)

  return (
    <div className="group/season relative">
      <button
        onClick={open}
        className="block w-full text-left"
        aria-label={`${season.Name} — see episodes`}
      >
        <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-ink-card ring-2 ring-transparent transition group-hover/season:ring-white/30">
          {poster ? (
            <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full items-center justify-center px-2 text-center text-xs text-white/40">
              {season.Name}
            </span>
          )}

          {unplayed > 0 && (
            <span className="absolute right-2 top-2 rounded bg-accent px-1.5 py-0.5 text-[11px] font-bold tabular-nums">
              {unplayed}
            </span>
          )}
          {watched && unplayed === 0 && (
            <span className="absolute right-2 top-2 flex size-5 items-center justify-center rounded-full bg-emerald-500 text-black">
              <WatchedIcon className="size-4" />
            </span>
          )}

          <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-2 pt-8 text-[11px] text-white/70 opacity-0 transition group-hover/season:opacity-100">
            See episodes →
          </span>
        </div>

        <p className="mt-2 line-clamp-1 text-sm font-medium text-white/85">{season.Name}</p>
        <p className="text-xs text-white/45">
          {season.ChildCount ? `${season.ChildCount} episodes` : 'Episodes'}
          {unplayed > 0 ? ` · ${unplayed} unwatched` : ''}
        </p>
      </button>

      <button
        onClick={() => season.Id && played.mutate({ itemId: season.Id, played: !watched })}
        disabled={played.isPending}
        aria-label={watched ? `Mark ${season.Name} unwatched` : `Mark ${season.Name} watched`}
        title={watched ? 'Mark season unwatched' : 'Mark season watched'}
        className={`absolute left-2 top-2 rounded-full bg-black/70 p-1 backdrop-blur transition disabled:opacity-50 ${
          watched
            ? 'text-emerald-400'
            : 'text-white/70 opacity-0 hover:text-white group-hover/season:opacity-100'
        }`}
      >
        <WatchedIcon className="size-4" filled={watched} />
      </button>
    </div>
  )
}
