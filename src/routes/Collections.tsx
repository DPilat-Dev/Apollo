import { MediaCard } from '../components/MediaCard'
import { useBoxSets } from '../lib/queries'
import { collectionsSurface } from '../lib/boxSets'

/**
 * Every collection on the server, as a grid of their own posters.
 *
 * Nothing links here unless the server has some, but a bookmark can still land
 * on it — so the four outcomes are spelled out rather than all collapsing into
 * one blank page. "None here" and "could not ask" in particular have to read
 * differently, or a broken server looks like an empty one.
 */
export function Collections() {
  const query = useBoxSets()
  const surface = collectionsSurface(query)
  const collections = query.data ?? []

  return (
    <div className="px-4 pb-24 pt-24 sm:px-14 sm:pt-28">
      <div className="mb-6">
        <h1 className="text-2xl font-bold sm:text-4xl">Collections</h1>
        {surface === 'present' && (
          <p className="mt-1 text-sm text-white/45">
            {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
          </p>
        )}
      </div>

      {surface === 'failed' && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-ink-soft/50 px-4 py-3">
          <p className="text-sm text-white/55">
            {query.error instanceof Error ? query.error.message : "Collections couldn't load."}
          </p>
          <button
            onClick={() => void query.refetch()}
            className="rounded border border-white/20 px-3 py-1 text-xs transition hover:border-white/50"
          >
            Retry
          </button>
        </div>
      )}

      {surface === 'absent' && (
        <p className="text-sm text-white/45">
          No collections on this server yet. Group titles into one on the Jellyfin dashboard and
          they will show up here.
        </p>
      )}

      {(surface === 'pending' || surface === 'present') && (
        <div className="grid grid-cols-3 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {surface === 'pending'
            ? Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="w-full">
                  <div className="skeleton aspect-2/3 rounded-lg" />
                </div>
              ))
            : collections.map((item) => (
                <div key={item.Id} className="[&>div]:w-full">
                  <MediaCard item={item} />
                </div>
              ))}
        </div>
      )}
    </div>
  )
}
