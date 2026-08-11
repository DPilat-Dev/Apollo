import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { Row } from '../components/Row'
import { CheckIcon, PlayIcon, PlusIcon, PlaylistIcon, ShuffleIcon, TrailerIcon, WatchedIcon } from '../components/icons'
import { TrailerModal } from '../components/TrailerModal'
import { AddToPlaylist } from '../components/AddToPlaylist'
import { RemoteControl } from '../components/RemoteControl'
import { hasTrailer } from '../lib/trailers'
import { useApi } from '../lib/auth'
import { blurhashBackground } from '../lib/blurhash'
import {
  displayTitle,
  episodeCode,
  formatRuntime,
  isResumable,
  playedFraction,
} from '../lib/format'
import {
  useEpisodes,
  useIsAdmin,
  useItem,
  useSeasons,
  useSimilar,
  useToggleFavorite,
  useTogglePlayed,
} from '../lib/queries'
import { MetadataEditor } from '../components/admin/MetadataEditor'
import { MatchBadge } from '../components/MatchBadge'
import { CastAndCrew, FilterChips, Ratings } from '../components/ItemMeta'
import { MediaTracks, trackParams, useTrackSelection } from '../components/MediaTracks'
import { SeasonCard } from '../components/SeasonCard'
import { pickPlayableEpisode } from '../lib/playback'
import { startShuffle } from '../lib/queue'

export function ItemDetail() {
  const { itemId } = useParams<{ itemId: string }>()
  const api = useApi()
  const navigate = useNavigate()
  const { data: item, isLoading } = useItem(itemId)
  const similar = useSimilar(itemId)
  const favorite = useToggleFavorite()
  const played = useTogglePlayed()
  const isAdmin = useIsAdmin()
  // Holds whichever item the metadata editor is open for — the series itself,
  // a season, or a single episode.
  const [editingItem, setEditingItem] = useState<BaseItemDto | null>(null)
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const [tracks, setTracks] = useTrackSelection()

  const isSeries = item?.Type === 'Series'
  const isSeason = item?.Type === 'Season'

  // A series lists its seasons; a season lists its episodes.
  const seasons = useSeasons(isSeries ? itemId : undefined)
  const seriesId = isSeason ? item?.SeriesId : undefined
  const episodes = useEpisodes(seriesId ?? undefined, isSeason ? itemId : undefined)

  // Play on a series should start the next unwatched episode, which needs the
  // episode list — fetched only for that purpose.
  const seriesEpisodes = useEpisodes(isSeries ? itemId : undefined, undefined)

  if (isLoading || !item) {
    return (
      <div className="px-4 pt-24 sm:px-14">
        <div className="skeleton h-[45vh] w-full rounded-xl" />
      </div>
    )
  }

  const backdrop = api.heroBackdropUrl(item, 1920)
  const logo = api.logoUrl(item, 640)
  const isFav = Boolean(item.UserData?.IsFavorite)
  const isWatched = Boolean(item.UserData?.Played)
  const showTrailer = hasTrailer(item, item.LocalTrailerCount ?? 0)

  // For a series, "Play" should continue from the next unwatched episode.
  const playTarget = isSeries
    ? pickPlayableEpisode(seriesEpisodes.data)
    : isSeason
      ? pickPlayableEpisode(episodes.data)
      : item

  const resumable = Boolean(playTarget && isResumable(playTarget))
  const loadingTarget = (isSeries && seriesEpisodes.isLoading) || (isSeason && episodes.isLoading)

  return (
    <div className="pb-24">
      <div className="relative h-[52vh] min-h-[22rem] w-full sm:h-[68vh]">
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            fetchPriority="high"
            decoding="async"
            style={blurhashBackground(item, backdrop)}
            className="absolute inset-0 h-full w-full object-cover object-top" />
        ) : (
          <div className="absolute inset-0 bg-ink-soft" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/35 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/90 via-ink/30 to-transparent" />

        <div className="absolute inset-x-0 bottom-0 px-4 pb-8 sm:px-14 sm:pb-14">
          <div className="max-w-2xl">
            {item.Type === 'Season' ? (
              <>
                {item.SeriesId && (
                  <Link
                    to={`/item/${item.SeriesId}`}
                    className="text-sm text-white/60 underline-offset-4 transition hover:text-white hover:underline"
                  >
                    ← {item.SeriesName}
                  </Link>
                )}
                <h1 className="mb-3 mt-2 text-3xl font-black tracking-tight drop-shadow-2xl sm:text-5xl">
                  {item.Name}
                </h1>
              </>
            ) : item.Type === 'Episode' ? (
              <>
                {item.SeriesId && (
                  <Link
                    to={`/item/${item.SeriesId}`}
                    className="text-sm text-white/60 underline-offset-4 transition hover:text-white hover:underline"
                  >
                    ← {item.SeriesName}
                  </Link>
                )}
                <h1 className="mb-1 mt-2 text-3xl font-black tracking-tight drop-shadow-2xl sm:text-5xl">
                  {item.Name}
                </h1>
                {episodeCode(item) && (
                  <p className="mb-3 text-sm font-medium text-white/55">{episodeCode(item)}</p>
                )}
              </>
            ) : logo ? (
              <img
                src={logo}
                alt={displayTitle(item)}
                decoding="async"
                className="mb-4 max-h-24 w-auto max-w-[80%] object-contain object-left drop-shadow-2xl sm:max-h-32"
              />
            ) : (
              <h1 className="mb-3 text-3xl font-black tracking-tight drop-shadow-2xl sm:text-5xl">
                {item.Name}
              </h1>
            )}

            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/75">
              <MatchBadge item={item} showReasons />
              {item.ProductionYear && <span>{item.ProductionYear}</span>}
              {item.OfficialRating && (
                <span className="border border-white/30 px-1.5 text-xs leading-relaxed">
                  {item.OfficialRating}
                </span>
              )}
              {formatRuntime(item.RunTimeTicks) && <span>{formatRuntime(item.RunTimeTicks)}</span>}
              {isSeries && item.ChildCount ? (
                <span>
                  {item.ChildCount} season{item.ChildCount > 1 ? 's' : ''}
                </span>
              ) : null}
            </div>

            <div className="mb-4">
              <Ratings item={item} />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() =>
                  playTarget?.Id && navigate(`/watch/${playTarget.Id}${trackParams(tracks)}`)
                }
                disabled={!playTarget?.Id || loadingTarget}
                className="flex items-center gap-2 rounded bg-white px-7 py-2.5 font-bold text-black transition hover:bg-white/80 disabled:opacity-40"
              >
                <PlayIcon className="size-5" />
                {resumable ? 'Resume' : 'Play'}
                {(isSeries || isSeason) && playTarget && episodeCode(playTarget) && (
                  <span className="font-normal text-black/55">{episodeCode(playTarget)}</span>
                )}
              </button>

              {/* Shuffle plays the whole show in a random order, not one pick. */}
              {(isSeries || isSeason) && (
                <button
                  onClick={() => {
                    const pool = isSeries ? seriesEpisodes.data : episodes.data
                    const ids = (pool ?? [])
                      .map((e) => e.Id)
                      .filter((id): id is string => Boolean(id))
                    const seriesId = isSeries ? item.Id : item.SeriesId
                    if (!seriesId || ids.length === 0) return
                    const queue = startShuffle(seriesId, ids)
                    if (queue) navigate(`/watch/${queue.ids[0]}`)
                  }}
                  disabled={!(isSeries ? seriesEpisodes.data : episodes.data)?.length}
                  title={
                    isSeries
                      ? 'Play every episode of this show in a random order'
                      : 'Play this season in a random order'
                  }
                  className="flex items-center gap-2 rounded bg-white/20 px-5 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/30 disabled:opacity-40"
                >
                  <ShuffleIcon className="size-5" />
                  Shuffle
                </button>
              )}

              <div className="flex size-11 items-center justify-center rounded-full border-2 border-white/40 bg-black/40">
                <RemoteControl item={item} />
              </div>

              <button
                onClick={() => setPlaylistOpen(true)}
                aria-label="Add to playlist"
                title="Add to playlist"
                className="flex size-11 items-center justify-center rounded-full border-2 border-white/40 bg-black/40 transition hover:border-white"
              >
                <PlaylistIcon className="size-5" />
              </button>

              {showTrailer && (
                <button
                  onClick={() => setTrailerOpen(true)}
                  title="Watch the trailer"
                  className="flex items-center gap-2 rounded bg-white/20 px-5 py-2.5 text-sm font-bold text-white backdrop-blur transition hover:bg-white/30"
                >
                  <TrailerIcon className="size-5" />
                  Trailer
                </button>
              )}

              <button
                onClick={() => item.Id && favorite.mutate({ itemId: item.Id, favorite: !isFav })}
                aria-label={isFav ? 'Remove from My List' : 'Add to My List'}
                className="flex size-11 items-center justify-center rounded-full border-2 border-white/40 bg-black/40 transition hover:border-white"
              >
                {isFav ? <CheckIcon className="size-5" /> : <PlusIcon className="size-5" />}
              </button>

              <button
                onClick={() =>
                  item.Id && played.mutate({ itemId: item.Id, played: !isWatched })
                }
                disabled={played.isPending}
                aria-label={isWatched ? 'Mark as unwatched' : 'Mark as watched'}
                title={
                  isSeries
                    ? isWatched
                      ? 'Mark whole series unwatched'
                      : 'Mark whole series watched'
                    : isWatched
                      ? 'Mark as unwatched'
                      : 'Mark as watched'
                }
                className={`flex size-11 items-center justify-center rounded-full border-2 bg-black/40 transition disabled:opacity-50 ${
                  isWatched
                    ? 'border-emerald-400 text-emerald-400'
                    : 'border-white/40 text-white hover:border-white'
                }`}
              >
                <WatchedIcon className="size-5" filled={isWatched} />
              </button>

              {isAdmin && (
                <button
                  onClick={() => setEditingItem(item)}
                  className="rounded-full border-2 border-white/40 bg-black/40 px-5 py-2.5 text-sm font-semibold transition hover:border-white"
                >
                  Edit
                </button>
              )}
            </div>

            {resumable && playTarget && (
              <div className="mt-4 max-w-md">
                <div className="h-1 overflow-hidden rounded-full bg-white/20">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${Math.round(playedFraction(playTarget) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 -mt-8 px-4 sm:px-14">
        <div className="grid max-w-6xl gap-8 lg:grid-cols-[2fr_1fr]">
          <div>
            {item.Taglines?.[0] && (
              <p className="mb-3 text-lg font-medium italic text-white/60">{item.Taglines[0]}</p>
            )}
            <p className="text-sm leading-relaxed text-white/80 sm:text-base">{item.Overview}</p>
          </div>

          <div className="space-y-3">
            <FilterChips item={item} />
          </div>
        </div>
      </div>

      {/* Only leaf items have streams; series and seasons are containers. */}
      {!isSeries && !isSeason && (
        <MediaTracks item={item} selection={tracks} onChange={setTracks} />
      )}

      <CastAndCrew item={item} />

      {isSeries && (
        <section className="mt-12 px-4 sm:px-14">
          <div className="mb-4 flex items-baseline gap-3">
            <h2 className="text-xl font-semibold">Seasons</h2>
            <span className="text-sm text-white/40">{seasons.data?.length ?? 0}</span>
          </div>

          {seasons.isLoading && (
            <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="skeleton aspect-2/3 rounded-lg" />
              ))}
            </div>
          )}

          {!seasons.isLoading && (seasons.data ?? []).length === 0 && (
            <p className="py-8 text-white/40">No seasons found for this series.</p>
          )}

          <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {(seasons.data ?? []).map((season) => (
              <SeasonCard key={season.Id} season={season} series={item} />
            ))}
          </div>
        </section>
      )}

      {isSeason && (
        <section className="mt-12 px-4 sm:px-14">
          <div className="mb-4 flex items-center gap-4">
            <h2 className="text-xl font-semibold">Episodes</h2>
            <span className="text-sm text-white/40">{episodes.data?.length ?? 0}</span>
            {isAdmin && (
              <button
                onClick={() => setEditingItem(item)}
                className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/70 transition hover:border-white/50 hover:text-white"
              >
                Edit season
              </button>
            )}
          </div>

          <div className="max-w-5xl divide-y divide-white/8 border-t border-white/8">
            {episodes.isLoading &&
              Array.from({ length: 5 }, (_, i) => (
                <div key={i} className="skeleton my-2 h-24 rounded-lg" />
              ))}
            {episodes.data?.map((ep) => (
              <EpisodeRow
                key={ep.Id}
                episode={ep}
                onEdit={isAdmin ? () => setEditingItem(ep) : undefined}
                onTogglePlayed={() =>
                  ep.Id && played.mutate({ itemId: ep.Id, played: !ep.UserData?.Played })
                }
              />
            ))}
          </div>
        </section>
      )}

      {similar.data && similar.data.length > 0 && (
        <div className="mt-12">
          <Row title="More Like This" items={similar.data} />
        </div>
      )}

      {trailerOpen && <TrailerModal item={item} onClose={() => setTrailerOpen(false)} />}
      {playlistOpen && <AddToPlaylist item={item} onClose={() => setPlaylistOpen(false)} />}

      {editingItem && (
        <MetadataEditor item={editingItem} onClose={() => setEditingItem(null)} />
      )}
    </div>
  )
}



/**
 * Two targets, deliberately: the thumbnail plays, everything else opens the
 * episode's own page. Clicking a title should let you look before committing —
 * that page is where the video, audio and subtitle tracks are chosen.
 */
function EpisodeRow({
  episode,
  onEdit,
  onTogglePlayed,
}: {
  episode: BaseItemDto
  onEdit?: () => void
  onTogglePlayed?: () => void
}) {
  const api = useApi()
  const navigate = useNavigate()
  // Each row shows that episode's own still, not the series' art.
  const thumb = api.stillUrl(episode, 400)
  const progress = playedFraction(episode)
  const resumable = progress > 0.01 && progress < 0.95
  const watched = Boolean(episode.UserData?.Played)

  return (
    <div className="group flex w-full items-start gap-4 py-4 transition hover:bg-white/4">
      <span className="w-8 shrink-0 pt-8 text-center text-lg font-semibold text-white/35">
        {episode.IndexNumber}
      </span>

      <button
        onClick={() => navigate(`/watch/${episode.Id}`)}
        aria-label={`${resumable ? 'Resume' : 'Play'} ${episode.Name ?? 'episode'}`}
        className="relative aspect-video w-40 shrink-0 overflow-hidden rounded bg-ink-card sm:w-48"
      >
        {thumb && <img
            src={thumb}
            alt=""
            loading="lazy"
            decoding="async"
            style={blurhashBackground(episode, thumb)}
            className="h-full w-full object-cover"
          />}
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100">
          <PlayIcon className="size-8" />
        </span>
        {progress > 0 && (
          <span className="absolute inset-x-1.5 bottom-1.5 block h-[3px] overflow-hidden rounded-full bg-white/25">
            <span
              className="block h-full bg-accent"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </span>
        )}
      </button>

      <button
        onClick={() => navigate(`/item/${episode.Id}`)}
        className="min-w-0 flex-1 text-left"
      >
        <h3 className="truncate font-medium">
          {episode.Name}
          {episodeCode(episode) && (
            <span className="ml-2 text-xs font-normal text-white/35">{episodeCode(episode)}</span>
          )}
        </h3>
        <p className="mt-1 line-clamp-2 text-sm text-white/55">{episode.Overview}</p>
        <span className="mt-1 inline-block text-[11px] text-white/30 opacity-0 transition group-hover:opacity-100 touch:opacity-100">
          Details, audio &amp; subtitles →
        </span>
      </button>

      {/*
        Runtime and the actions share a column of their own. They used to be an
        absolutely positioned overlay, which sat on top of the runtime.
      */}
      <div className="flex shrink-0 items-center gap-2 pt-0.5">
        <span className="text-xs tabular-nums text-white/40">
          {formatRuntime(episode.RunTimeTicks)}
        </span>
        {onEdit && (
          <button
            onClick={onEdit}
            className="rounded border border-white/20 px-2 py-1 text-[11px] text-white/70 opacity-0 transition hover:border-white/50 hover:text-white group-hover:opacity-100 touch:opacity-100"
          >
            Edit
          </button>
        )}
        {onTogglePlayed && (
          <button
            onClick={onTogglePlayed}
            aria-label={watched ? 'Mark as unwatched' : 'Mark as watched'}
            title={watched ? 'Mark as unwatched' : 'Mark as watched'}
            className={`rounded-full p-1 transition ${
              watched
                ? 'text-emerald-400'
                : 'text-white/50 opacity-0 hover:text-white group-hover:opacity-100 touch:opacity-100'
            }`}
          >
            <WatchedIcon className="size-5" filled={watched} />
          </button>
        )}
      </div>
    </div>
  )
}
