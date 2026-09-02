import { useEffect, useMemo } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useApi } from '../lib/auth'
import {
  ESTIMATE_CAVEAT,
  formatEstimatedTime,
  hasRecap,
  nextRecapPage,
  recapItemsQuery,
  recapSeason,
  summariseYear,
  type RecapCount,
  type RecapStats,
} from '../lib/yearRecap'

/**
 * The year, totalled up.
 *
 * Everything this page decides — which year, which items belong to it, what the
 * numbers are and how far the walk should go — is in `yearRecap.ts`. What is
 * left here is the shape of the ceremony, and one rule it must not lose: the
 * headline is called an estimate everywhere it appears, because the server
 * never measured it.
 */
export function YearRecap() {
  const api = useApi()
  // Read once, at the top, and immediately handed to the function that decides.
  const season = useMemo(() => recapSeason(new Date()), [])
  const year = season?.year ?? null

  const query = useInfiniteQuery({
    queryKey: ['yearRecap', api.userId, year],
    enabled: year !== null,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.items(recapItemsQuery(pageParam)),
    getNextPageParam: (last, all) => {
      const loaded = all.flatMap((page) => page.Items ?? [])
      // The early exit: there is no server-side "played during 2026" filter, so
      // the walk stops itself once it has passed the start of the year.
      return nextRecapPage(loaded, { year: year ?? 0, total: last.TotalRecordCount ?? 0 })
    },
  })

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query

  /*
    Unlike the history list there is nothing to scroll towards — a total is
    wrong until the last page is in — so the walk runs itself to the stopping
    condition rather than waiting for a sentinel to come into view.
  */
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.Items ?? []) ?? [],
    [query.data],
  )
  // No timezone or locale given, so both are this browser's — the year has to
  // break where the viewer's new year broke, not where UTC's did.
  const stats = useMemo(
    () => (year === null ? null : summariseYear(items, year)),
    [items, year],
  )

  // Out of season the page does not exist, the same as the link to it. Someone
  // arriving on the URL in June is not shown a stale ceremony.
  if (!season) return <Navigate to="/" replace />

  const settling = query.isLoading || hasNextPage || isFetchingNextPage

  return (
    <div className="px-4 pb-24 pt-24 sm:px-14 sm:pt-28">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
          Your year in review
        </p>
        <h1 className="text-5xl font-black tracking-tight sm:text-7xl">{season.year}</h1>
      </header>

      {query.isError && items.length === 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-ink-soft/50 px-4 py-3">
          <p className="text-sm text-white/55">
            {query.error instanceof Error ? query.error.message : "Your year couldn't load."}
          </p>
          <button
            onClick={() => void query.refetch()}
            className="rounded border border-white/20 px-3 py-1 text-xs transition hover:border-white/50"
          >
            Retry
          </button>
        </div>
      )}

      {settling && (
        <div className="space-y-4">
          <div className="skeleton h-32 rounded-xl" />
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="skeleton h-24 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {!settling && stats && !hasRecap(stats) && (
        <p className="max-w-prose text-sm text-white/50">
          Nothing finished in {season.year}, so there is nothing to add up. Anything you finish
          from here shows up in next year&rsquo;s.
        </p>
      )}

      {!settling && stats && hasRecap(stats) && <Recap stats={stats} />}
    </div>
  )
}

function Recap({ stats }: { stats: RecapStats }) {
  return (
    <div className="space-y-10">
      <section className="rounded-xl border border-white/10 bg-ink-soft/50 p-6 sm:p-8">
        <p className="text-xs uppercase tracking-wider text-white/40">Roughly</p>
        <p className="mt-1 text-4xl font-black tracking-tight text-accent sm:text-6xl">
          {formatEstimatedTime(stats.estimatedMinutes)}
        </p>
        {/*
          Not a footnote to be trimmed later. The number above is the sum of the
          runtimes of things marked played; nothing in Jellyfin knows whether
          anyone was in the room. Saying so is the difference between a recap
          and a claim.
        */}
        <p className="mt-3 max-w-prose text-sm text-white/45">{ESTIMATE_CAVEAT}</p>
        {stats.itemsWithoutRuntime > 0 && (
          <p className="mt-1 max-w-prose text-xs text-white/35">
            {stats.itemsWithoutRuntime === 1
              ? 'One item has no runtime on the server, so it added nothing to this.'
              : `${stats.itemsWithoutRuntime} items have no runtime on the server, so they added nothing to this.`}
          </p>
        )}
        {stats.truncated && (
          <p className="mt-1 max-w-prose text-xs text-white/35">
            A very full year — these are the most recent {stats.itemCount.toLocaleString()} and the
            real totals are higher.
          </p>
        )}
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile value={stats.itemCount} label={stats.itemCount === 1 ? 'thing watched' : 'things watched'} />
        <Tile value={stats.movieCount} label={stats.movieCount === 1 ? 'film' : 'films'} />
        <Tile value={stats.episodeCount} label={stats.episodeCount === 1 ? 'episode' : 'episodes'} />
        <Tile value={stats.seriesCount} label={stats.seriesCount === 1 ? 'show' : 'shows'} />
      </section>

      {stats.busiestDay && (
        <section className="rounded-xl border border-white/10 bg-ink-soft/50 p-6">
          <p className="text-xs uppercase tracking-wider text-white/40">Your biggest day</p>
          <p className="mt-1 text-2xl font-bold sm:text-3xl">{stats.busiestDay.label}</p>
          <p className="mt-1 text-sm text-white/45">
            {stats.busiestDay.count === 1
              ? 'One thing — a quiet year’s best effort.'
              : `${stats.busiestDay.count} things in one day.`}
          </p>
        </section>
      )}

      <MonthChart months={stats.months} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TopList
          title="Shows you kept coming back to"
          entries={stats.topShows}
          unit={(n) => (n === 1 ? '1 episode' : `${n} episodes`)}
          empty="No episodes this year — a year of films."
        />
        <TopList
          title="What you were in the mood for"
          entries={stats.topGenres}
          unit={(n) => (n === 1 ? '1 title' : `${n} titles`)}
          // Genre metadata is patchy and episodes rarely carry any, so an empty
          // panel here is a fact about the library rather than about the viewer.
          empty="Nothing you watched carries a genre on this server."
        />
      </div>

      {stats.undatedCount > 0 && (
        <p className="text-xs text-white/35">
          {stats.undatedCount === 1
            ? 'One played item has no date on the server, so it belongs to no year and is not counted here.'
            : `${stats.undatedCount} played items have no date on the server, so they belong to no year and are not counted here.`}
        </p>
      )}

      <Link
        to="/history"
        className="inline-block rounded border border-white/20 px-4 py-2 text-sm transition hover:border-white/50"
      >
        See it day by day
      </Link>
    </div>
  )
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-soft/50 p-5">
      <p className="text-3xl font-black tabular-nums">{value.toLocaleString()}</p>
      <p className="mt-0.5 text-sm text-white/45">{label}</p>
    </div>
  )
}

function TopList({
  title,
  entries,
  unit,
  empty,
}: {
  title: string
  entries: RecapCount[]
  unit: (count: number) => string
  empty: string
}) {
  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">{title}</h2>
      {entries.length === 0 ? (
        <p className="text-sm text-white/40">{empty}</p>
      ) : (
        <ol className="divide-y divide-white/5">
          {entries.map((entry, index) => (
            <li key={entry.key} className="flex items-baseline gap-3 py-2.5">
              <span className="w-5 shrink-0 text-sm tabular-nums text-white/30">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium sm:text-base">
                {entry.label}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-white/40">
                {unit(entry.count)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

/** Twelve bars, scaled to the biggest month, so the shape of the year shows. */
function MonthChart({ months }: { months: number[] }) {
  const peak = Math.max(...months, 1)
  const names = months.map((_, i) =>
    new Intl.DateTimeFormat(undefined, { month: 'narrow', timeZone: 'UTC' }).format(
      new Date(Date.UTC(2001, i, 1)),
    ),
  )

  return (
    <section>
      <h2 className="mb-3 text-lg font-bold">Month by month</h2>
      <div className="flex items-end gap-1.5 sm:gap-3">
        {months.map((count, i) => (
          <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <span className="text-xs tabular-nums text-white/35">{count || ''}</span>
            <div
              className="w-full rounded-t bg-accent/70"
              // Zero still draws a hairline, so an empty month reads as an empty
              // month rather than as a gap in the chart.
              style={{ height: `${Math.max((count / peak) * 96, 2)}px` }}
            />
            <span className="text-[11px] uppercase text-white/35">{names[i]}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
