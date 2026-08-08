import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { CardSkeleton, MediaCard } from '../components/MediaCard'
import { useApi } from '../lib/auth'
import { useViews } from '../lib/queries'
import { browsableTypes } from '../lib/collections'

const PAGE_SIZE = 60

const SORTS = [
  { label: 'Recently Added', sortBy: 'DateCreated', order: 'Descending' },
  { label: 'A–Z', sortBy: 'SortName', order: 'Ascending' },
  { label: 'Rating', sortBy: 'CommunityRating', order: 'Descending' },
  { label: 'Release Date', sortBy: 'PremiereDate', order: 'Descending' },
  { label: 'Random', sortBy: 'Random', order: 'Ascending' },
] as const

export function Library() {
  const { viewId } = useParams<{ viewId: string }>()
  const api = useApi()
  const { data: views, isPending: viewsPending } = useViews()
  const [sortIndex, setSortIndex] = useState(0)
  const [genre, setGenre] = useState<string>('')
  const sentinel = useRef<HTMLDivElement>(null)

  const view = views?.find((v) => v.Id === viewId)
  const itemTypes = browsableTypes(view?.CollectionType)

  const sort = SORTS[sortIndex]

  const query = useInfiniteQuery({
    // itemTypes belongs in the key: it is derived from the view list, which
    // loads separately. Without it the first fetch (made before the collection
    // type is known) would be cached and never revisited.
    queryKey: ['library', api.userId, viewId, itemTypes.join(','), sort.label, genre],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.items({
        parentId: viewId,
        includeItemTypes: itemTypes,
        recursive: true,
        sortBy: [sort.sortBy],
        sortOrder: [sort.order],
        genres: genre || undefined,
        startIndex: pageParam,
        limit: PAGE_SIZE,
        fields: ['PrimaryImageAspectRatio', 'ProductionYear'],
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

  // Infinite scroll: load the next page when the sentinel nears the viewport.
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

  // The grid query stays disabled until views resolve, and a disabled query
  // reports isLoading false — so the view load has to count as loading too.
  const showSkeleton = viewsPending || query.isLoading

  const genres = useMemo(() => {
    const set = new Set<string>()
    items.forEach((i) => i.Genres?.forEach((g) => set.add(g)))
    return [...set].sort().slice(0, 24)
  }, [items])

  return (
    <div className="px-4 pb-24 pt-24 sm:px-14 sm:pt-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-4xl">{view?.Name ?? 'Library'}</h1>
          {query.data?.pages[0]?.TotalRecordCount != null && (
            <p className="mt-1 text-sm text-white/45">
              {query.data.pages[0].TotalRecordCount!.toLocaleString()} titles
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={genre}
            onChange={(e) => setGenre(e.target.value)}
            className="rounded border border-white/15 bg-ink-soft px-3 py-2 text-sm outline-none transition hover:border-white/35"
          >
            <option value="">All genres</option>
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>

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
      </div>

      <div className="grid grid-cols-3 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {showSkeleton
          ? Array.from({ length: 24 }, (_, i) => (
              <div key={i} className="w-full">
                <div className="skeleton aspect-2/3 rounded-lg" />
              </div>
            ))
          : items.map((item) => (
              <div key={item.Id} className="[&>div]:w-full">
                <MediaCard item={item} />
              </div>
            ))}
      </div>

      {!showSkeleton && items.length === 0 && (
        <p className="py-24 text-center text-white/40">Nothing here yet.</p>
      )}

      <div ref={sentinel} className="h-10" />
      {query.isFetchingNextPage && (
        <div className="flex gap-2.5 overflow-hidden">
          {Array.from({ length: 8 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}
    </div>
  )
}
