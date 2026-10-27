import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useMemo, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { CardSkeleton, MediaCard } from '../components/MediaCard'
import { FilterBar } from '../components/FilterBar'
import { LetterRail } from '../components/LetterRail'
import { useApi } from '../lib/auth'
import { useViews } from '../lib/queries'
import { browsableTypes } from '../lib/collections'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { pageTitle } from '../lib/pageTitle'
import { WindowedGrid } from '../components/WindowedGrid'
import { LoadFailure } from '../components/LoadFailure'
import { usePageOnScroll } from '../lib/usePageWalk'
import {
  NO_FILTERS,
  filterCacheKey,
  isFilterActive,
  letterApplies,
  matchCountLabel,
  toItemsQuery,
} from '../lib/libraryFilters'
import { useFilterParams } from '../lib/useFilterParams'

const PAGE_SIZE = 60

const GRID_CLASS =
  'grid grid-cols-3 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8'

/*
  Defined once, outside any render. `WindowedGrid` is memoised, and a new
  function here on every render would defeat that — the grid would rebuild
  whenever the page re-rendered for reasons of its own.
*/
const renderCard = (item: BaseItemDto) => (
  <div key={item.Id} className="[&>div]:w-full">
    <MediaCard item={item} />
  </div>
)

export function Library() {
  const { viewId } = useParams<{ viewId: string }>()
  const api = useApi()
  const { data: views, isPending: viewsPending } = useViews()
  const sentinel = useRef<HTMLDivElement>(null)
  // Declared before `items` exists: the count is passed in below, and hooks
  // cannot be ordered around data.

  const view = views?.find((v) => v.Id === viewId)
  const itemTypes = browsableTypes(view?.CollectionType)

  /*
    Sort and filters are read from the URL rather than held in state. A library
    of 27,000 episodes is only usable filtered, and a filtered grid is something
    people bookmark, share and come back to — all of which a useState filter
    loses on the first refresh. Browse works this way too, and the hook is what
    keeps the two pages from drifting apart about it — including about a letter
    the sort does not apply to, which is cleared before the request, the cache
    key, the chip bar and the rail ever see it.
  */
  const { filters, sort, setFilters, setSort } = useFilterParams(() => ({ fallback: 'added' }))

  const currentYear = new Date().getFullYear()
  const filterQuery = toItemsQuery(filters, currentYear)

  const query = useInfiniteQuery({
    // itemTypes belongs in the key: it is derived from the view list, which
    // loads separately. Without it the first fetch (made before the collection
    // type is known) would be cached and never revisited. The filters go in as
    // the same string the URL carries, so a filter can never reach the request
    // without also reaching the key and being served another filter's results.
    queryKey: ['library', api.userId, viewId, itemTypes.join(','), sort.key, filterCacheKey(filters)],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.items({
        parentId: viewId,
        includeItemTypes: itemTypes,
        recursive: true,
        sortBy: [sort.sortBy],
        sortOrder: [sort.order],
        ...filterQuery,
        startIndex: pageParam,
        limit: PAGE_SIZE,
        // Genres is asked for by name because the genre picker is built from
        // what has loaded; without it every item comes back genre-less.
        fields: ['PrimaryImageAspectRatio', 'ProductionYear', 'Genres'],
      }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + (p.Items?.length ?? 0), 0)
      return loaded < (last.TotalRecordCount ?? 0) ? loaded : undefined
    },
    // Hold off until the view is known, so we never fetch with fallback types.
    enabled: Boolean(viewId) && !viewsPending,
  })

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.Items ?? []) ?? [],
    [query.data],
  )

  // Infinite scroll: the next page loads as the sentinel nears the viewport,
  // and stops for good on a refused one — see `usePageWalk`.
  const { isFetchNextPageError, fetchNextPage } = query
  usePageOnScroll(sentinel, query)

  // The grid query stays disabled until views resolve, and a disabled query
  // reports isLoading false — so the view load has to count as loading too.
  const showSkeleton = viewsPending || query.isLoading

  const genres = useMemo(() => {
    const set = new Set<string>()
    items.forEach((i) => i.Genres?.forEach((g) => set.add(g)))
    return [...set].sort().slice(0, 24)
  }, [items])

  const total = query.data?.pages[0]?.TotalRecordCount
  const filtered = isFilterActive(filters)
  const showRail = letterApplies(sort.key)

  useDocumentTitle(pageTitle(view?.Name))

  return (
    /* The rail is fixed to the right edge rather than floated over the grid:
       at xl:grid-cols-8 the eighth column's hover-grow would reach it. So the
       page gives the edge back while the rail is there — 56px is not enough
       for the rail, air and a desktop scrollbar. */
    <div
      className={`px-4 pb-24 pt-24 sm:pl-14 sm:pt-28 ${showRail ? 'sm:pr-20' : 'sm:pr-14'}`}
    >
      <div className="mb-6 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-4xl">{view?.Name ?? 'Library'}</h1>
            {/*
              One attribute that makes every filter change announce the new
              count: the whole bar was silent before, so a screen reader user
              chose Unwatched and got no confirmation anything had happened.

              It says which letter it counted, too. "88 matching titles" is the
              same sentence for M, N and O, and walking the alphabet is exactly
              the loop that queues three of them in a row.

              The paragraph stays mounted with nothing in it rather than
              appearing with the count, because a live region has to be in the
              tree *before* it changes to be read out — inserted together with
              its own text, it is just another node appearing, which is the
              silence this is meant to fix. Empty, it is a block with no line
              box: 4px of margin and nothing else.
            */}
            <p role="status" className="mt-1 text-sm text-white/45">
              {matchCountLabel(total, filters)}
            </p>
          </div>
        </div>

        <FilterBar
          filters={filters}
          onFilters={setFilters}
          sortKey={sort.key}
          onSort={setSort}
          genres={genres}
        />
      </div>

      {showRail && (
        <LetterRail
          value={filters.letter}
          onSelect={(letter) => setFilters({ ...filters, letter })}
        />
      )}

      {showSkeleton ? (
        <div className={GRID_CLASS}>
          {Array.from({ length: 24 }, (_, i) => (
            <div key={i} className="w-full">
              <div className="skeleton aspect-2/3 rounded-lg" />
            </div>
          ))}
        </div>
      ) : (
        <WindowedGrid items={items} className={GRID_CLASS}>
          {renderCard}
        </WindowedGrid>
      )}

      {/*
        A refused /Items request used to print "Nothing here yet." over a
        library with 27,000 things in it, which is the one sentence guaranteed
        to send someone looking for the fault in their server. Same reasoning
        as the rows on Home: a broken request and an empty library have to read
        differently.
      */}
      {!showSkeleton && query.isError && items.length === 0 && (
        <LoadFailure
          error={query.error}
          fallback="This library couldn't load."
          onRetry={() => void query.refetch()}
        />
      )}

      {!showSkeleton && !query.isError && items.length === 0 && (
        <div className="py-24 text-center">
          {/* An empty grid reads as a broken library unless it says otherwise.
              Someone who filtered to unwatched days ago and forgot needs the
              reason and the way out in the same place. */}
          <p className="text-white/40">
            {filtered ? 'Nothing here matches those filters.' : 'Nothing here yet.'}
          </p>
          {filtered && (
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="mt-4 rounded bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      <div ref={sentinel} className="h-10" />
      {query.isFetchingNextPage && (
        <div className="flex gap-2.5 overflow-hidden">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* The grid above is real, so this is a footnote rather than a failure:
          part of the library is here and the rest is one press away. */}
      {isFetchNextPageError && (
        <LoadFailure
          error={query.error}
          fallback="Couldn't load the rest of this library."
          label="Try again"
          busy={query.isFetchingNextPage}
          onRetry={() => void fetchNextPage()}
        />
      )}
    </div>
  )
}
