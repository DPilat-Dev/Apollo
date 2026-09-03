import { useState } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useAddToCollection, useBoxSets, useCreateCollection } from '../lib/queries'
import { collectionsSurface, planCollectionCreate } from '../lib/boxSets'
import { displayTitle } from '../lib/format'
import { CheckIcon, PlusIcon } from './icons'

/**
 * Picks an existing collection, or makes one with this title already in it.
 *
 * Deliberately the same shape as `AddToPlaylist`, down to the layout: the two
 * are the same gesture from the viewer's side, and a second pattern for it
 * would be a second thing to learn for no gain.
 *
 * The lower half is the half that matters. A server that has never had a box
 * set made on it hides collections everywhere — no nav entry, no shelf — so
 * the naming field is not a convenience here, it is the only door in. That is
 * why the empty list says what it says instead of "nothing here".
 */
export function AddToCollection({ item, onClose }: { item: BaseItemDto; onClose: () => void }) {
  const query = useBoxSets()
  const collections = query.data ?? []
  const surface = collectionsSurface(query)
  const add = useAddToCollection()
  const create = useCreateCollection()
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
          <h2 className="text-base font-semibold">Add to collection</h2>
          <p className="mt-0.5 truncate text-xs text-white/45">{displayTitle(item)}</p>
        </div>

        <div className="max-h-64 overflow-y-auto px-2 py-2">
          {surface === 'pending' && <p className="px-3 py-3 text-sm text-white/45">Loading…</p>}
          {/* Told apart on purpose: a server with none is a prompt to make the
              first, while a request that never landed is not. */}
          {surface === 'failed' && (
            <p className="px-3 py-3 text-sm text-white/45">
              Couldn't load the collections on this server.
            </p>
          )}
          {surface === 'absent' && (
            <p className="px-3 py-3 text-sm text-white/45">
              No collections yet. Name one below and this becomes its first title.
            </p>
          )}
          {collections.map((collection) => (
            <button
              key={collection.Id}
              onClick={() => {
                if (!collection.Id || !itemId) return
                setError(null)
                add.mutate(
                  { collectionId: collection.Id, itemIds: [itemId] },
                  { onSuccess: () => setAdded(collection.Id!), onError: fail },
                )
              }}
              disabled={add.isPending}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition hover:bg-white/8 disabled:opacity-50"
            >
              <span className="min-w-0 truncate">{collection.Name}</span>
              {added === collection.Id ? (
                <CheckIcon className="size-4 shrink-0 text-emerald-400" />
              ) : (
                <span className="shrink-0 text-xs text-white/35">
                  {collection.ChildCount ?? 0}
                </span>
              )}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            const plan = planCollectionCreate({ name, itemId, existing: collections })
            if (!plan.ok) {
              // Only the duplicate is worth saying out loud; the empty case is
              // already visible as a disabled button and an empty field.
              return setError(
                plan.problem === 'duplicate'
                  ? 'There is already a collection with that name — pick it from the list above.'
                  : null,
              )
            }
            setError(null)
            create.mutate(
              { name: plan.name, itemIds: plan.itemIds },
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
            placeholder="New collection"
            aria-label="New collection name"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-white/40"
          />
          <button
            type="submit"
            disabled={!name.trim() || create.isPending}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-accent px-3 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
          >
            <PlusIcon className="size-4" />
            Create
          </button>
        </form>

        {error && <p className="px-5 pb-3 text-xs text-red-300">{error}</p>}
        {added === 'new' && !error && (
          <p className="px-5 pb-3 text-xs text-emerald-300">
            Collection created. It is on the Collections page now.
          </p>
        )}

        <div className="border-t border-white/10 px-5 py-3 text-right">
          <button onClick={onClose} className="text-sm text-white/60 transition hover:text-white">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
