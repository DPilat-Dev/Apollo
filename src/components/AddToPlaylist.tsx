import { useState } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useAddToPlaylist, useCreatePlaylist, usePlaylists } from '../lib/queries'
import { displayTitle } from '../lib/format'
import { CheckIcon, PlusIcon } from './icons'

/** Picks an existing playlist, or makes one with this title already in it. */
export function AddToPlaylist({ item, onClose }: { item: BaseItemDto; onClose: () => void }) {
  const { data: playlists, isLoading } = usePlaylists()
  const add = useAddToPlaylist()
  const create = useCreatePlaylist()
  const [name, setName] = useState('')
  const [added, setAdded] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const itemId = item.Id
  const fail = (e: unknown) =>
    setError(e instanceof Error ? e.message : 'That did not go through.')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-sm rounded-xl border border-white/10 bg-ink-soft shadow-2xl">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-base font-semibold">Add to playlist</h2>
          <p className="mt-0.5 truncate text-xs text-white/45">{displayTitle(item)}</p>
        </div>

        <div className="max-h-64 overflow-y-auto px-2 py-2">
          {isLoading && <p className="px-3 py-3 text-sm text-white/45">Loading…</p>}
          {!isLoading && (playlists ?? []).length === 0 && (
            <p className="px-3 py-3 text-sm text-white/45">No playlists yet — make one below.</p>
          )}
          {(playlists ?? []).map((pl) => (
            <button
              key={pl.Id}
              onClick={() => {
                if (!pl.Id || !itemId) return
                setError(null)
                add.mutate(
                  { playlistId: pl.Id, itemIds: [itemId] },
                  { onSuccess: () => setAdded(pl.Id!), onError: fail },
                )
              }}
              disabled={add.isPending}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-white/8 disabled:opacity-50"
            >
              <span className="min-w-0 truncate">{pl.Name}</span>
              {added === pl.Id ? (
                <CheckIcon className="size-4 shrink-0 text-emerald-400" />
              ) : (
                <span className="shrink-0 text-xs text-white/35">{pl.ChildCount ?? 0}</span>
              )}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const trimmed = name.trim()
            if (!trimmed || !itemId) return
            setError(null)
            create.mutate(
              { name: trimmed, itemIds: [itemId] },
              {
                onSuccess: () => {
                  setName('')
                  setAdded('new')
                },
                onError: fail,
              },
            )
          }}
          className="flex gap-2 border-t border-white/10 px-5 py-4"
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New playlist"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-white/40"
          />
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
          >
            <PlusIcon className="size-4" />
            Add
          </button>
        </form>

        {error && <p className="px-5 pb-3 text-xs text-red-300">{error}</p>}

        <div className="border-t border-white/10 px-5 py-3 text-right">
          <button onClick={onClose} className="text-sm text-white/60 transition hover:text-white">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
