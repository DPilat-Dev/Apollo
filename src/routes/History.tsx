import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useApi } from '../lib/auth'
import { displayTitle, itemSubtitle } from '../lib/format'
import {
  formatPlayedTime,
  groupWatchHistory,
  historyItemsQuery,
  nextHistoryPage,
  type HistoryEntry,
  buildHeatmap,
  filterHistory,
  localDayKey,
  summariseDay,
  type HistoryDay,
  type HistoryFilter,
} from '../lib/watchHistory'

/**
 * What this account has watched, newest first.
 *
 * The server has always known — the admin dashboard's Activity tab reads it,
 * and the home page's recommendations are built from it — but the person it
 * describes had nowhere to see it. Everything that decides what this page says
 * lives in `watchHistory.ts`, because a page about dates is exactly the kind
 * that looks right in the afternoon and is wrong all evening.
 */
export function History() {
  const api = useApi()
  const sentinel = useRef<HTMLDivElement>(null)

  const query = useInfiniteQuery({
    queryKey: ['watchHistory', api.userId],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.items(historyItemsQuery(pageParam)),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + (p.Items?.length ?? 0), 0)
      return nextHistoryPage(loaded, last.TotalRecordCount ?? 0)
    },
  })

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.Items ?? []) ?? [], [query.data])
  const total = query.data?.pages[0]?.TotalRecordCount ?? 0
  // No timezone or locale passed: the defaults are the ones this browser is
  // set to, which is the whole point — the headings have to match the clock
  // the viewer was watching by.
  const days = useMemo(() => groupWatchHistory(items), [items])
  const [filter, setFilter] = useState<HistoryFilter>('all')
  const shown = useMemo(() => filterHistory(days, filter), [days, filter])

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

  const capped = !query.hasNextPage && items.length > 0 && items.length < total

  return (
    /* Capped rather than full-bleed: a row is a poster, a title and a time,
       and stretched across 1440px the timestamp ends up a hand's width from
       the thing it belongs to. */
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-24 sm:px-14 sm:pt-28">
      <div className="mb-6">
        <h1 className="text-2xl font-bold sm:text-4xl">Watch history</h1>
        {total > 0 && (
          <p className="mt-1 text-sm text-white/45">
            {total.toLocaleString()} {total === 1 ? 'thing watched' : 'things watched'}
          </p>
        )}
      </div>

      {query.isError && items.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-ink-soft/50 px-4 py-3">
          <p className="text-sm text-white/55">
            {query.error instanceof Error ? query.error.message : "Your history couldn't load."}
          </p>
          <button
            onClick={() => void query.refetch()}
            className="rounded border border-white/20 px-3 py-1 text-xs transition hover:border-white/50"
          >
            Retry
          </button>
        </div>
      )}

      {!query.isLoading && !query.isError && items.length > 0 && (
        <>
          <ActivityHeatmap days={days} />
          <div className="mb-6 flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  filter === f.id
                    ? 'border-white bg-white text-black'
                    : 'border-white/20 text-white/70 hover:border-white/45 hover:text-white'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </>
      )}

      {shown.length === 0 && days.length > 0 && (
        <p className="text-sm text-white/45">
          Nothing here matches that filter.{' '}
          <button onClick={() => setFilter('all')} className="underline hover:text-white">
            Show everything
          </button>
        </p>
      )}

      {query.isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton h-20 rounded-lg" />
          ))}
        </div>
      )}

      {!query.isLoading && !query.isError && items.length === 0 && (
        <p className="text-sm text-white/45">
          Nothing yet. Once you finish something it shows up here, with the day you watched it.
        </p>
      )}

      {shown.map((day) => (
        <section key={day.key} className="mb-8">
          {/* Sticky under the nav: on a long page the heading is the only thing
              saying which evening the rows below belong to. */}
          <h2 className="sticky top-14 z-10 -mx-4 bg-ink/95 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-white/40 backdrop-blur sm:top-16 sm:-mx-14 sm:px-14">
            <span className="flex flex-wrap items-baseline gap-x-2">
              {day.label}
              {/* What the evening amounted to, so a heading is a fact and not
                  just a divider. */}
              <span className="font-normal normal-case tracking-normal text-white/25">
                {summariseDay(day)}
              </span>
            </span>
          </h2>
          <ul className="mt-2 divide-y divide-white/5">
            {day.entries.map((entry) => (
              <HistoryRow key={entry.key} entry={entry} />
            ))}
          </ul>
        </section>
      ))}

      {capped && (
        <p className="pb-8 text-center text-xs text-white/35">
          Showing your {items.length.toLocaleString()} most recent. Older viewing is still on the
          server.
        </p>
      )}

      <div ref={sentinel} className="h-10" />
    </div>
  )
}

function HistoryRow({ entry }: { entry: HistoryEntry }) {
  const api = useApi()
  const { item } = entry
  // `coverUrl`, not `posterUrl`: an episode's own Primary image is a still from
  // the scene, and a page whose job is "what did I watch" has to show which
  // show it was.
  const img = api.coverUrl(item, 200)
  const time = formatPlayedTime(entry.playedAt)
  const subtitle = entry.episodeCount > 1 ? entry.episodeLabel : itemSubtitle(item)

  const body = (
    <>
      <div className="w-12 shrink-0 overflow-hidden rounded bg-white/5 sm:w-14">
        {img ? (
          <img src={img} alt="" loading="lazy" className="aspect-2/3 w-full object-cover" />
        ) : (
          <div className="aspect-2/3 w-full" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white sm:text-base">
          {displayTitle(item)}
        </p>
        {subtitle && <p className="truncate text-xs text-white/45 sm:text-sm">{subtitle}</p>}
      </div>
      {time && <span className="shrink-0 text-xs tabular-nums text-white/40">{time}</span>}
    </>
  )

  return (
    <li>
      {entry.href ? (
        <Link
          to={entry.href}
          className="flex items-center gap-3 py-2.5 transition hover:bg-white/5 sm:gap-4"
        >
          {body}
        </Link>
      ) : (
        <div className="flex items-center gap-3 py-2.5 sm:gap-4">{body}</div>
      )}
    </li>
  )
}

const FILTERS: { id: HistoryFilter; label: string }[] = [
  { id: 'all', label: 'Everything' },
  { id: 'shows', label: 'Shows' },
  { id: 'films', label: 'Films' },
]

/**
 * A year of viewing as a grid of squares.
 *
 * The list answers "what did I watch on the 7th". Nothing answered "what does
 * a year of this look like", which is the question a history page is actually
 * opened to ask. Built from the same day keys the grouping already made.
 */
function ActivityHeatmap({ days }: { days: HistoryDay[] }) {
  const counts = useMemo(() => {
    const map = new Map<string, number>()
    for (const day of days) {
      if (day.key === 'unknown') continue
      map.set(day.key, day.entries.reduce((n, e) => n + e.episodeCount, 0))
    }
    return map
  }, [days])

  const today = useMemo(() => localDayKey(new Date(), undefined), [])
  const map = useMemo(() => buildHeatmap(counts, { today }), [counts, today])
  if (map.weeks.length === 0) return null

  const shade = ['bg-white/6', 'bg-accent/25', 'bg-accent/45', 'bg-accent/70', 'bg-accent']

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-white/70">The last year</h2>
        <p className="text-xs text-white/35">
          {map.totalDays} {map.totalDays === 1 ? 'day' : 'days'} with something on
        </p>
      </div>

      {/* Scrolls on a narrow screen rather than squeezing 53 columns into it. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="min-w-max">
          <div className="relative mb-1 h-3">
            {map.months.map((m) => (
              <span
                key={`${m.label}-${m.column}`}
                className="absolute text-[10px] text-white/30"
                style={{ left: `${m.column * 14}px` }}
              >
                {m.label}
              </span>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {map.weeks.map((week, w) => (
              <div key={w} className="flex flex-col gap-[3px]">
                {week.map((cell, d) => (
                  <div
                    key={cell.key ?? d}
                    title={
                      cell.key
                        ? `${cell.key}: ${cell.count || 'nothing'}${cell.count ? ` watched` : ''}`
                        : undefined
                    }
                    className={`size-[11px] rounded-[2px] ${shade[cell.level]}`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
