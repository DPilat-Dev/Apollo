import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '../lib/auth'
import { useCreatePlaylist, usePlaylists } from '../lib/queries'
import { CardSkeleton } from '../components/MediaCard'
import { PlusIcon } from '../components/icons'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { pageTitle } from '../lib/pageTitle'

/** Every playlist this user can see, plus a way to start a new one. */
export function Playlists() {
  useDocumentTitle(pageTitle('Playlists'))
  const api = useApi()
  const { data, isLoading, error } = usePlaylists()
  const create = useCreatePlaylist()
  const [name, setName] = useState('')
  const [failed, setFailed] = useState<string | null>(null)

  const playlists = data ?? []

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-8 sm:pt-28">
      <h1 className="mb-6 text-3xl font-bold sm:text-4xl">Playlists</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const trimmed = name.trim()
          if (!trimmed) return
          setFailed(null)
          create.mutate(
            { name: trimmed },
            {
              onSuccess: () => setName(''),
              onError: (err) =>
                setFailed(err instanceof Error ? err.message : 'Could not create that playlist.'),
            },
          )
        }}
        className="mb-8 flex max-w-md gap-2"
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New playlist name"
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-white/40"
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
        >
          <PlusIcon className="size-4" />
          {create.isPending ? 'Creating…' : 'Create'}
        </button>
      </form>

      {failed && <p className="mb-4 text-sm text-red-300">{failed}</p>}

      {error && (
        <p className="text-sm text-white/55">
          {error instanceof Error ? error.message : 'Playlists could not be loaded.'}
        </p>
      )}

      {isLoading ? (
        <div className="flex gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <CardSkeleton key={i} shape="poster" />
          ))}
        </div>
      ) : playlists.length === 0 ? (
        <p className="text-sm text-white/45">
          No playlists yet. Create one above, then add titles from any detail page.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {playlists.map((pl) => {
            const art = api.posterUrl(pl, 400) ?? api.backdropUrl(pl, 640)
            return (
              <Link
                key={pl.Id}
                to={`/playlist/${pl.Id}`}
                className="group block focus:outline-none"
              >
                <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-ink-card ring-white/0 transition group-hover:ring-2 group-hover:ring-white/40">
                  {art ? (
                    <img
                      src={art}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center px-3 text-center text-xs text-white/35">
                      {pl.Name}
                    </div>
                  )}
                </div>
                <p className="mt-2 line-clamp-1 text-sm font-medium text-white/85">{pl.Name}</p>
                <p className="text-xs text-white/40">
                  {pl.ChildCount ?? 0} {pl.ChildCount === 1 ? 'item' : 'items'}
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
