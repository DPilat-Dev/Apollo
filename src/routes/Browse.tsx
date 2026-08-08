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
 * One grid for "everything by this person / studio / genre".
 *
 * Filters arrive as query params so every chip on a detail page is a plain
 * link — shareable, and Back behaves the way people expect.
 */
export function Browse() {
  const [params] = useSearchParams()
  const api = useApi()
  const [sortIndex, setSortIndex] = useState(0)
  const sentinel = useRef<HTMLDivElement>(null)

  const personIds = params.get('personIds') ?? undefined
  const studioIds = params.get('studioIds') ?? undefined
  const genreIds = params.get('genreIds') ?? undefined
  const genre = params.get('genre') ?? undefined
  const title = params.get('name') ?? genre ?? 'Browse'
  const kind = params.get('kind') ?? ''

  const sort = SORTS[sortIndex]
  const filterKey = [personIds, studioIds, genreIds, genre].join('|')

  const query = useInfiniteQuery({
    queryKey: ['browse', api.userId, filterKey, sort.label],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.items({
        recursive: true,
        // Cast credits include episodes; collapsing to series keeps the grid
        // readable rather than listing forty episodes of one show.
        includeItemTypes: ['Movie', 'Series'],
        personIds,
        studioIds,
        genreIds,
        genres: genre,
        sortBy: [sort.sortBy],
        sortOrder: [sort.order],
        startIndex: pageParam,
        limit: PAGE_SIZE,
        fields: ['Genres', 'Studios', 'Tags', 'ProductionYear', 'PrimaryImageAspectRatio'],
      }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + (p.Items?.length ?? 0), 0)
      return loaded < (last.TotalRecordCount ?? 0) ? loaded : undefined
    },
    enabled: Boolean(personIds || studioIds || genreIds || genre),
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
          {SORTS.map((s, i) => (
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
