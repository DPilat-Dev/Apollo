import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApi } from '../lib/auth'
import {
  useDeletePlaylist,
  useItem,
  useMovePlaylistItem,
  usePlaylistItems,
  useRemoveFromPlaylist,
} from '../lib/queries'
import { displayTitle, formatRuntime, itemSubtitle } from '../lib/format'
import { blurhashBackground } from '../lib/blurhash'
import { ChevronDown, ChevronLeft, PlayIcon, ShuffleIcon } from '../components/icons'
import { startShuffle } from '../lib/queue'

/**
 * One playlist: what is in it, in order, with the ordering editable.
 *
 * Removal and reordering address a playlist *entry*, not the item — the same
 * title can appear twice, and Jellyfin distinguishes them by PlaylistItemId.
 */
export function PlaylistDetail() {
  const { playlistId } = useParams<{ playlistId: string }>()
  const api = useApi()
  const navigate = useNavigate()
  const { data: playlist } = useItem(playlistId)
  const { data: items, isLoading } = usePlaylistItems(playlistId)
  const remove = useRemoveFromPlaylist()
  const move = useMovePlaylistItem()
  const destroy = useDeletePlaylist()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const entries = items ?? []
  const first = entries[0]

  const entryId = (item: { PlaylistItemId?: string | null; Id?: string | null }) =>
    item.PlaylistItemId ?? item.Id ?? ''

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-24 sm:px-8 sm:pt-28">
      <button
        onClick={() => navigate('/playlists')}
        className="mb-4 flex items-center gap-1 text-sm text-white/55 transition hover:text-white"
      >
        <ChevronLeft className="size-4" />
        Playlists
      </button>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">{playlist?.Name ?? 'Playlist'}</h1>
          <p className="mt-1 text-sm text-white/45">
            {entries.length} {entries.length === 1 ? 'item' : 'items'}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => first?.Id && navigate(`/watch/${first.Id}`)}
            disabled={!first}
            className="flex items-center gap-2 rounded bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-white/85 disabled:opacity-40"
          >
            <PlayIcon className="size-5" />
            Play
          </button>
          <button
            onClick={() => {
              const ids = entries.map((e) => e.Id).filter((id): id is string => Boolean(id))
              if (ids.length < 2 || !playlistId) return
              const queue = startShuffle(playlistId, ids)
              const firstId = queue?.ids[0]
              if (firstId) navigate(`/watch/${firstId}`)
            }}
            disabled={entries.length < 2}
            className="flex items-center gap-2 rounded bg-white/20 px-5 py-2.5 text-sm font-bold backdrop-blur transition hover:bg-white/30 disabled:opacity-40"
          >
            <ShuffleIcon className="size-5" />
            Shuffle
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="skeleton h-16 rounded-lg" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-sm text-white/45">
          Nothing in here yet. Open any title and use “Add to playlist”.
        </p>
      ) : (
        <ol className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10">
          {entries.map((item, index) => {
            const still = api.stillUrl(item, 320) ?? api.posterUrl(item, 200)
            return (
              <li key={entryId(item)} className="group flex items-center gap-3 px-3 py-2.5">
                <span className="w-6 shrink-0 text-center text-xs tabular-nums text-white/35">
                  {index + 1}
                </span>

                <button
                  onClick={() => item.Id && navigate(`/watch/${item.Id}`)}
                  className="relative aspect-video w-24 shrink-0 overflow-hidden rounded bg-ink-card"
                  aria-label={`Play ${displayTitle(item)}`}
                >
                  {still && (
                    <img
                      src={still}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      style={blurhashBackground(item, still)}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition group-hover:opacity-100 touch:opacity-100">
                    <PlayIcon className="size-6" />
                  </span>
                </button>

                <button
                  onClick={() => item.Id && navigate(`/item/${item.SeriesId ?? item.Id}`)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="truncate text-sm font-medium text-white/90">{displayTitle(item)}</p>
                  <p className="truncate text-xs text-white/45">
                    {itemSubtitle(item) ?? formatRuntime(item.RunTimeTicks)}
                  </p>
                </button>

                <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100 touch:opacity-100">
                  <button
                    onClick={() =>
                      playlistId &&
                      index > 0 &&
                      move.mutate({ playlistId, entryId: entryId(item), newIndex: index - 1 })
                    }
                    disabled={index === 0 || move.isPending}
                    aria-label="Move up"
                    className="rounded p-1 text-white/50 transition hover:text-white disabled:opacity-25"
                  >
                    <ChevronDown className="size-4 rotate-180" />
                  </button>
                  <button
                    onClick={() =>
                      playlistId &&
                      index < entries.length - 1 &&
                      move.mutate({ playlistId, entryId: entryId(item), newIndex: index + 1 })
                    }
                    disabled={index === entries.length - 1 || move.isPending}
                    aria-label="Move down"
                    className="rounded p-1 text-white/50 transition hover:text-white disabled:opacity-25"
                  >
                    <ChevronDown className="size-4" />
                  </button>
                  <button
                    onClick={() =>
                      playlistId &&
                      remove.mutate({ playlistId, entryIds: [entryId(item)] })
                    }
                    disabled={remove.isPending}
                    aria-label={`Remove ${displayTitle(item)}`}
                    className="rounded px-2 py-1 text-xs text-white/45 transition hover:text-accent disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      <div className="mt-10">
        {confirmDelete ? (
          <div className="max-w-md rounded-lg border border-accent/40 bg-accent/10 p-3">
            <p className="text-sm">
              Delete <strong>{playlist?.Name}</strong>?
            </p>
            <p className="mt-1 text-xs text-white/50">
              The playlist goes; the titles in it stay in your library.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() =>
                  playlistId &&
                  destroy.mutate(
                    { playlistId },
                    { onSuccess: () => navigate('/playlists') },
                  )
                }
                disabled={destroy.isPending}
                className="rounded bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-50"
              >
                {destroy.isPending ? 'Deleting…' : 'Yes, delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded border border-white/20 px-4 py-2 text-sm transition hover:border-white/45"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-xs text-white/40 underline underline-offset-4 transition hover:text-accent"
          >
            Delete this playlist
          </button>
        )}
      </div>
    </div>
  )
}
