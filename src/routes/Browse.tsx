import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { MediaCard } from '../components/MediaCard'
import { FilterBar } from '../components/FilterBar'
import { useApi } from '../lib/auth'
import {
  NO_FILTERS,
  sortContextFor,
  filterCacheKey,
  filtersToParams,
  isFilterActive,
  parseFilters,
  parseSort,
  toItemsQuery,
  toSortQuery,
  type SortKey,
} from '../lib/libraryFilters'
import { personRedirect } from '../lib/persons'
import { collectionInView } from '../lib/boxSets'
import { useCanManageCollections, useRemoveFromCollection } from '../lib/queries'

const PAGE_SIZE = 60

/**
 * One grid for "everything by this person / studio / genre", or everything
 * inside one container.
 *
 * Filters arrive as query params so every chip on a detail page is a plain
 * link — shareable, and Back behaves the way people expect. `parentId` is the
 * same idea pointed at a box set, which is why collections need no route of
 * their own. Library now works this way too, which is what lets both pages
 * share one filter bar.
 *
 * Two things here are deliberately not shared with Library:
 *
 * `genre` is the *subject* of this page rather than a filter over it, so no
 * genre list is handed to the bar and no removable genre chip appears — an ×
 * on it would delete the page out from under the viewer.
 *
 * The curated sort is only offered when there is a container to be in order,
 * and is the default there, because a collection that opens alphabetically
 * opens the Lord of the Rings on The Return of the King. Passing the list of
 * sorts that apply here — rather than adding a sixth to the shared one — is
 * what keeps `?sort=curated` meaningful in this context and inert everywhere
 * else, while every sort still round-trips through the URL like the filters do.
 *
 * The person case is the one that is not merely a grid — an actor has a face, a
 * biography and dates — so `/person/:name` renders this component with its own
 * header in place of the title. That keeps one grid rather than two: paging,
 * filters and sorting are written once, here. `/browse?personIds=` is what the
 * cast chips used to link to, so it redirects into that page rather than
 * remaining a second way to see the same filmography.
 */
export interface BrowseProps {
  /** Stands in for the plain title block. The person page puts its header here. */
  heading?: ReactNode
  /**
   * Used only when the URL carries no `personIds` — a hand-typed or shared
   * `/person/{name}` has a name but no id until the person themselves loads.
   */
  fallbackPersonId?: string
}

export function Browse({ heading, fallbackPersonId }: BrowseProps = {}) {
  const [params, setParams] = useSearchParams()
  const api = useApi()
  const sentinel = useRef<HTMLDivElement>(null)

  // Unconditional, because `personRedirect` is what knows not to fire: the
  // person page renders this same component, and the rule that a person URL
  // never redirects to itself belongs next to the one that builds it.
  const handOff = personRedirect(params)

  const personIds = params.get('personIds') ?? fallbackPersonId ?? undefined
  const studioIds = params.get('studioIds') ?? undefined
  const genreIds = params.get('genreIds') ?? undefined
  const parentId = params.get('parentId') ?? undefined
  const filters = useMemo(() => parseFilters(params), [params])
  const title = params.get('name') || filters.genre || 'Browse'
  const kind = params.get('kind') ?? ''

  const { sorts, fallback } = sortContextFor(Boolean(parentId))
  const sort = parseSort(params.get('sort'), fallback, sorts)
  const filterKey = [personIds, studioIds, genreIds, parentId, filterCacheKey(filters)].join('|')

  /*
    This same grid is a filmography, a genre and a library shelf, and none of
    those can have anything taken out of them — so whether a remove control
    belongs on these cards is `collectionInView`'s decision, made from the
    parameters and the viewer's permission together.
  */
  const canManageCollections = useCanManageCollections()
  const collection = collectionInView({ params, canManage: canManageCollections })
  const removeFromCollection = useRemoveFromCollection()

  const write = (next: URLSearchParams) => setParams(next, { replace: true })
  const setSort = (key: SortKey) => {
    const next = new URLSearchParams(params)
    next.set('sort', key)
    write(next)
  }

  const currentYear = new Date().getFullYear()
  const filterQuery = toItemsQuery(filters, currentYear)

  const query = useInfiniteQuery({
    queryKey: ['browse', api.userId, filterKey, sort.key],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.items({
        // Inside a container, its own children and nothing deeper: a box set
        // holding a series must list the series, not its 62 episodes. Every
        // other filter is a search of the whole tree.
        parentId,
        recursive: !parentId,
        // Cast credits include episodes; collapsing to series keeps the grid
        // readable rather than listing forty episodes of one show. A
        // collection can hold anything, so it constrains nothing.
        includeItemTypes: parentId ? undefined : ['Movie', 'Series'],
        personIds,
        studioIds,
        genreIds,
        ...filterQuery,
        ...toSortQuery(sort),
        startIndex: pageParam,
        limit: PAGE_SIZE,
        fields: ['Genres', 'Studios', 'Tags', 'ProductionYear', 'PrimaryImageAspectRatio'],
      }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + (p.Items?.length ?? 0), 0)
      return loaded < (last.TotalRecordCount ?? 0) ? loaded : undefined
    },
    // Nothing is worth fetching for a page about to be navigated away from.
    enabled:
      !handOff && Boolean(personIds || studioIds || genreIds || filters.genre || parentId),
  })

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.Items ?? []) ?? [],
    [query.data],
  )
  const total = query.data?.pages[0]?.TotalRecordCount ?? 0

  // The page's own genre is not one of the filters a viewer can drop, so it is
  // excluded when deciding whether filters are what emptied the grid.
  const filtered = isFilterActive({ ...filters, genre: '' })

  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && query.hasNextPage && !query.isFetchingNextPage) {
          void query.fetchNextPage()
        }
      },
      { rootMargin: '800px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [query])

  if (handOff) return <Navigate to={handOff} replace />

  return (
    <div className="px-4 pb-24 pt-24 sm:px-14 sm:pt-28">
      <div className="mb-6 flex flex-col gap-4">
        <div>
          {heading ?? (
            <>
              {kind && (
                <p className="text-xs uppercase tracking-wider text-white/40">{kind}</p>
              )}
              <h1 className="text-2xl font-bold sm:text-4xl">{title}</h1>
            </>
          )}
          {total > 0 && (
            <p className="mt-1 text-sm text-white/45">
              {total.toLocaleString()} {filtered ? 'matching titles' : 'titles'}
            </p>
          )}
        </div>

        <FilterBar
          filters={filters}
          onFilters={(next) => write(filtersToParams(next, params))}
          sortKey={sort.key}
          onSort={setSort}
          sorts={sorts}
        />
      </div>

      <div className="grid grid-cols-3 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {query.isLoading
          ? Array.from({ length: 18 }, (_, i) => (
              <div key={i} className="skeleton aspect-2/3 rounded-lg" />
            ))
          : items.map((item) => (
              <div key={item.Id} className="[&>div]:w-full">
                <MediaCard
                  item={item}
                  removeLabel={collection?.name}
                  onRemove={
                    collection && item.Id
                      ? () =>
                          removeFromCollection.mutate({
                            collectionId: collection.id,
                            itemIds: [item.Id!],
                          })
                      : undefined
                  }
                />
              </div>
            ))}
      </div>

      {!query.isLoading && items.length === 0 && (
        <div className="py-24 text-center">
          <p className="text-white/40">
            {filtered ? 'Nothing here matches those filters.' : 'Nothing matched.'}
          </p>
          {filtered && (
            <button
              type="button"
              // Keeps the genre, which is the page rather than a filter on it.
              onClick={() => write(filtersToParams({ ...NO_FILTERS, genre: filters.genre }, params))}
              className="mt-4 rounded bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div ref={sentinel} className="h-10" />
    </div>
  )
}
