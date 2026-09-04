import { useEffect, useMemo } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useApi } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { useCountUp } from '../lib/useCountUp'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { pageTitle } from '../lib/pageTitle'
import {
  ESTIMATE_CAVEAT,
  formatEstimatedTime,
  hasRecap,
  nextRecapPage,
  recapItemsQuery,
  previewSeason,
  recapSeason,
  type PosterRef,
  type RecapHabits,
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
  useDocumentTitle(pageTitle('Year in review'))
  const api = useApi()
  // Read once, at the top, and immediately handed to the function that decides.
  const [params] = useSearchParams()
  const preview = params.get('preview')
  const season = useMemo(() => previewSeason(preview) ?? recapSeason(new Date()), [preview])
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
      <header className="relative mb-8 overflow-hidden rounded-2xl py-6 sm:py-10">
        {/* Empty while the walk is still settling, which is the right time to
            show nothing rather than a wash that pops in halfway down. */}
        <PosterWash
          posters={(stats?.topShows ?? []).map((s) => s.poster).filter(Boolean) as PosterRef[]}
        />
        <div className="relative px-1">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-accent">
            Your year in review
          </p>
          <h1 className="text-5xl font-black tracking-tight sm:text-7xl">{season.year}</h1>
        </div>
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
        <Tile value={stats.movieCount} label={stats.movieCount === 1 ? 'film' : 'films'} delay={80} />
        <Tile value={stats.episodeCount} label={stats.episodeCount === 1 ? 'episode' : 'episodes'} delay={160} />
        <Tile value={stats.seriesCount} label={stats.seriesCount === 1 ? 'show' : 'shows'} delay={240} />
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

      <HabitsPanel habits={stats.habits} year={stats.year} />

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

function Tile({ value, label, delay = 0 }: { value: number; label: string; delay?: number }) {
  const { reduceMotion } = useSettings()
  const shown = useCountUp(value, { enabled: !reduceMotion })
  return (
    <div className="rounded-xl border border-white/10 bg-ink-soft/50 p-5" style={rise(reduceMotion, delay)}>
      <p className="text-3xl font-black tabular-nums">{shown.toLocaleString()}</p>
      <p className="mt-0.5 text-sm text-white/45">{label}</p>
    </div>
  )
}

/*
  The staggered entrance, as an inline style because the delay is per-panel and
  Tailwind has no arbitrary-delay-per-instance. `both` matters: without it a
  panel is drawn at full opacity for its delay and then jumps to zero to start.
*/
function rise(reduceMotion: boolean, delayMs: number): React.CSSProperties {
  if (reduceMotion) return {}
  return { animation: `recap-rise 520ms cubic-bezier(.2,.7,.3,1) ${delayMs}ms both` }
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
            <li key={entry.key} className="flex items-center gap-3 py-2.5">
              <span className="w-5 shrink-0 text-sm tabular-nums text-white/30">{index + 1}</span>
              {/* Only where there is one. A slot held open for missing art is a
                  row of grey rectangles, which looks broken rather than sparse. */}
              {entry.poster && <Poster item={entry.poster} rank={index} />}
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

/** A show's own poster, at the size it is drawn rather than a full-size one. */
function Poster({ item, rank }: { item: PosterRef; rank: number }) {
  const api = useApi()
  const { reduceMotion } = useSettings()
  const src = api.coverUrl(item as never, 80, 120)
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      className="h-14 w-[2.35rem] shrink-0 rounded object-cover ring-1 ring-white/10"
      style={rise(reduceMotion, 120 + rank * 70)}
    />
  )
}

/**
 * The year's posters, drifting behind the headline.
 *
 * Blurred and heavily dimmed on purpose: it is texture, not content, and every
 * title on it is already listed further down in a form you can actually read.
 * Hidden entirely when there is nothing to show, so a sparse year gets a clean
 * headline rather than a mostly-empty smear.
 */
function PosterWash({ posters }: { posters: PosterRef[] }) {
  const api = useApi()
  const { reduceMotion } = useSettings()
  const srcs = posters.map((p) => api.coverUrl(p as never, 160, 240)).filter(Boolean) as string[]
  if (srcs.length === 0) return null

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
      <div className="flex h-full items-center gap-4 opacity-[0.13] blur-[2px]">
        {/* Doubled so the strip fills a wide viewport from a handful of shows. */}
        {[...srcs, ...srcs, ...srcs].slice(0, 14).map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-40 w-28 shrink-0 rounded-lg object-cover"
            style={reduceMotion ? {} : { animation: `recap-rise 900ms ease-out ${i * 60}ms both` }}
          />
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/85 to-ink/60" />
    </div>
  )
}

const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

/** A day key back to something readable, without re-deriving the timezone. */
const prettyDay = (key: string | null) =>
  key
    ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
        new Date(`${key}T12:00:00Z`),
      )
    : ''

/**
 * The numbers a viewer can check against their own memory.
 *
 * Each entry is omitted rather than shown as zero or "none": a recap that
 * announces "your favourite weekday: none" is worse than one that never raises
 * the subject, and a tie genuinely has no answer.
 */
function HabitsPanel({ habits, year }: { habits: RecapHabits; year: number }) {
  const { reduceMotion } = useSettings()
  const streak = useCountUp(habits.longestStreak, { enabled: !reduceMotion })
  const active = useCountUp(habits.activeDays, { enabled: !reduceMotion })
  if (habits.activeDays === 0) return null

  const monthName =
    habits.busiestMonth === null
      ? null
      : new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
          new Date(Date.UTC(2001, habits.busiestMonth, 1)),
        )

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" style={rise(reduceMotion, 60)}>
      <Fact big={`${streak}`} unit={habits.longestStreak === 1 ? 'day' : 'days'} label="Longest streak"
        detail={
          habits.longestStreak > 1 && habits.streakStart
            ? `${prettyDay(habits.streakStart)} – ${prettyDay(habits.streakEnd)}`
            : 'Every run has to start somewhere.'
        }
      />
      <Fact big={`${active}`} unit="days" label={`Days you watched something in ${year}`}
        detail={`${Math.round((habits.activeDays / 365) * 100)}% of the year.`}
      />
      {habits.favouriteWeekday !== null && (
        <Fact big={WEEKDAYS[habits.favouriteWeekday]} label="Your day for it"
          detail="More finished then than on any other day." />
      )}
      {monthName && (
        <Fact big={monthName} label="Your busiest month" detail="More finished than any other." />
      )}
    </section>
  )
}

function Fact({ big, unit, label, detail }: { big: string; unit?: string; label: string; detail: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-soft/50 p-5">
      <p className="text-2xl font-black leading-tight sm:text-3xl">
        <span className="tabular-nums">{big}</span>
        {unit && <span className="ml-1.5 text-base font-bold text-white/50">{unit}</span>}
      </p>
      <p className="mt-1 text-sm text-white/45">{label}</p>
      <p className="mt-1.5 text-xs text-white/30">{detail}</p>
    </div>
  )
}

/** Twelve bars, scaled to the biggest month, so the shape of the year shows. */
function MonthChart({ months }: { months: number[] }) {
  const { reduceMotion } = useSettings()
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
              /*
                A month with nothing in it is drawn in grey, not in the accent.
                At the hairline height an accent-coloured empty month reads as a
                red rule under the chart rather than as an absence.
              */
              className={`w-full origin-bottom rounded-t ${count > 0 ? 'bg-accent/70' : 'bg-white/12'}`}
              style={{
                // Zero still draws a hairline, so an empty month reads as an
                // empty month rather than as a gap in the chart.
                height: `${Math.max((count / peak) * 96, 2)}px`,
                ...(reduceMotion
                  ? {}
                  : { animation: `recap-grow 620ms cubic-bezier(.2,.7,.3,1) ${i * 45}ms both` }),
              }}
            />
            <span className="text-[11px] uppercase text-white/35">{names[i]}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
