import { MediaCard } from '../components/MediaCard'
import { useBoxSets } from '../lib/queries'
import { collectionsSurface } from '../lib/boxSets'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { pageTitle } from '../lib/pageTitle'
import { LoadFailure } from '../components/LoadFailure'

/**
 * Every collection on the server, as a grid of their own posters.
 *
 * Nothing links here unless the server has some, but a bookmark can still land
 * on it — so the four outcomes are spelled out rather than all collapsing into
 * one blank page. "None here" and "could not ask" in particular have to read
 * differently, or a broken server looks like an empty one.
 */
export function Collections() {
  useDocumentTitle(pageTitle('Collections'))
  const query = useBoxSets()
  const surface = collectionsSurface(query)
  const collections = query.data ?? []

  return (
    <div className="px-4 pb-24 pt-24 sm:px-14 sm:pt-28">
      <div className="mb-6">
        <h1 className="text-2xl font-bold sm:text-4xl">Collections</h1>
        {surface === 'ready' && (
          <p className="mt-1 text-sm text-white/45">
            {collections.length} {collections.length === 1 ? 'collection' : 'collections'}
          </p>
        )}
      </div>

      {surface === 'failed' && (
        <LoadFailure
          error={query.error}
          fallback="Collections couldn't load."
          onRetry={() => void query.refetch()}
        />
      )}

      {surface === 'empty' && (
        <p className="text-sm text-white/45">
          No collections on this server yet. Open any film or show, press the three-dot button and
          choose "Add to collection" to start the first one.
        </p>
      )}

      {(surface === 'pending' || surface === 'ready') && (
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
