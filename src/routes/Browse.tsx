import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { MediaCard } from '../components/MediaCard'
import { useApi } from '../lib/auth'

const PAGE_SIZE = 60

const SORTS = [
  { label: 'A–Z', sortBy: 'SortName', order: 'Ascending' },
  { label: 'Rating', sortBy: 'CommunityRating', order: 'Descending' },
  { label: 'Recently Added', sortBy: 'DateCreated', order: 'Descending' },
  { label: 'Release Date', sortBy: 'PremiereDate', order: 'Descending' },
] as const

/**
 * Only offered when browsing inside a container. A collection is a curated
 * thing — "Marvel, in order" — and the server already keeps the order its
 * curator chose, whereas A–Z opens the Lord of the Rings on Return of the King.
 * An empty `sortBy` is dropped from the query, which is what asks for it.
 */
const CURATED_SORT = { label: 'Collection order', sortBy: '', order: 'Ascending' } as const

/**
 * One grid for "everything by this person / studio / genre", or everything
 * inside one container.
 *
 * Filters arrive as query params so every chip on a detail page is a plain
 * link — shareable, and Back behaves the way people expect. `parentId` is the
 * same idea pointed at a box set, which is why collections need no route of
 * their own.
 */
export function Browse() {
  const [params] = useSearchParams()
  const api = useApi()
  const sentinel = useRef<HTMLDivElement>(null)

  const personIds = params.get('personIds') ?? undefined
  const studioIds = params.get('studioIds') ?? undefined
  const genreIds = params.get('genreIds') ?? undefined
  const genre = params.get('genre') ?? undefined
  const parentId = params.get('parentId') ?? undefined
  const title = params.get('name') ?? genre ?? 'Browse'
  const kind = params.get('kind') ?? ''

  const sorts = parentId ? ([CURATED_SORT, ...SORTS] as const) : SORTS
  const [sortIndex, setSortIndex] = useState(0)
  const sort = sorts[sortIndex] ?? sorts[0]
  const filterKey = [personIds, studioIds, genreIds, genre, parentId].join('|')

  const query = useInfiniteQuery({
    queryKey: ['browse', api.userId, filterKey, sort.label],
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
        genres: genre,
        sortBy: sort.sortBy ? [sort.sortBy] : undefined,
        sortOrder: sort.sortBy ? [sort.order] : undefined,
        startIndex: pageParam,
        limit: PAGE_SIZE,
        fields: ['Genres', 'Studios', 'Tags', 'ProductionYear', 'PrimaryImageAspectRatio'],
      }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + (p.Items?.length ?? 0), 0)
      return loaded < (last.TotalRecordCount ?? 0) ? loaded : undefined
    },
    enabled: Boolean(personIds || studioIds || genreIds || genre || parentId),
  })

  const items = useMemo(
    () => query.data?.pages.flatMap((p) => p.Items ?? []) ?? [],
    [query.data],
  )
  const total = query.data?.pages[0]?.TotalRecordCount ?? 0

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

  return (
    <div className="px-4 pb-24 pt-24 sm:px-14 sm:pt-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          {kind && (
            <p className="text-xs uppercase tracking-wider text-white/40">{kind}</p>
          )}
          <h1 className="text-2xl font-bold sm:text-4xl">{title}</h1>
          {total > 0 && (
            <p className="mt-1 text-sm text-white/45">{total.toLocaleString()} titles</p>
          )}
        </div>
        <select
          value={sortIndex}
          onChange={(e) => setSortIndex(Number(e.target.value))}
          className="rounded border border-white/15 bg-ink-soft px-3 py-2 text-sm outline-none transition hover:border-white/35"
        >
          {sorts.map((s, i) => (
            <option key={s.label} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-3 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {query.isLoading
          ? Array.from({ length: 18 }, (_, i) => (
              <div key={i} className="skeleton aspect-2/3 rounded-lg" />
            ))
          : items.map((item) => (
              <div key={item.Id} className="[&>div]:w-full">
                <MediaCard item={item} />
              </div>
            ))}
      </div>

      {!query.isLoading && items.length === 0 && (
        <p className="py-24 text-center text-white/40">Nothing matched.</p>
      )}

      <div ref={sentinel} className="h-10" />
    </div>
  )
}
