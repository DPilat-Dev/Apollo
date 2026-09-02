import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useApi } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { useCountUp } from '../lib/useCountUp'
import {
  ESTIMATE_CAVEAT,
  RECAP_HREF,
  nextRecapPage,
  previewSeason,
  recapItemsQuery,
  recapSeason,
  summariseYear,
  type PosterRef,
  type RecapStats,
} from '../lib/yearRecap'
import { SLIDE_MS, advance, storySlides, tapDirection, type StorySlide } from '../lib/recapStory'
import { CloseIcon } from '../components/icons'

/**
 * The year, dealt out one card at a time.
 *
 * The same numbers the recap page shows, given a screen each and a moment to
 * land on. It is a lead-in rather than a replacement: the last card hands over
 * to `/recap`, which is where everything is legible at once and where anyone
 * who skips ends up immediately.
 */
export function RecapStory() {
  const api = useApi()
  const navigate = useNavigate()
  const { reduceMotion } = useSettings()
  const [params] = useSearchParams()
  const preview = params.get('preview')
  const season = useMemo(() => previewSeason(preview) ?? recapSeason(new Date()), [preview])
  const year = season?.year ?? null

  const query = useInfiniteQuery({
    queryKey: ['yearRecap', api.userId, year],
    enabled: year !== null,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.items(recapItemsQuery(pageParam)),
    getNextPageParam: (last, all) =>
      // Same walk and same stopping condition as the page. Sharing the query
      // key means arriving there after the run costs no second fetch.
      nextRecapPage(all.flatMap((page) => page.Items ?? []), {
        year: year ?? 0,
        total: last.TotalRecordCount ?? 0,
      }),
  })

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const items = useMemo(() => query.data?.pages.flatMap((p) => p.Items ?? []) ?? [], [query.data])
  const stats: RecapStats | null = useMemo(
    () => (year === null ? null : summariseYear(items, year)),
    [items, year],
  )

  const monthName = useCallback(
    (m: number) =>
      new Intl.DateTimeFormat(undefined, { month: 'long', timeZone: 'UTC' }).format(
        new Date(Date.UTC(2001, m, 1)),
      ),
    [],
  )
  const slides = useMemo(
    () => (stats ? storySlides(stats, { monthName }) : []),
    [stats, monthName],
  )

  const [index, setIndex] = useState(0)
  const settling = query.isLoading || hasNextPage || isFetchingNextPage

  // Where the run ends, and where anyone impatient goes. Replacing rather than
  // pushing, so Back leaves the recap instead of walking the cards again.
  const toPage = useCallback(
    () => navigate(preview ? `${RECAP_HREF}?preview=${preview}` : RECAP_HREF, { replace: true }),
    [navigate, preview, ],
  )

  const step = useCallback(
    (direction: -1 | 1) => {
      const next = advance(index, slides.length, direction)
      if (next === null) toPage()
      else setIndex(next)
    },
    [index, slides.length, toPage],
  )

  /*
    Held open by a press, the way every story does it — the card you want to
    read is always the one about to advance. Also the reason the timer is a
    state flag rather than a ref: pausing has to re-render the progress bar.
  */
  const [paused, setPaused] = useState(false)
  const startedAt = useRef(0)

  useEffect(() => {
    // Motion off means the viewer sets the pace. An auto-advancing carousel is
    // the least dismissible kind of motion there is.
    if (settling || paused || reduceMotion || slides.length === 0) return
    startedAt.current = performance.now()
    const timer = window.setTimeout(() => step(1), SLIDE_MS)
    return () => window.clearTimeout(timer)
  }, [index, paused, settling, reduceMotion, slides.length, step])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'Escape') toPage()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [step, toPage])

  if (!season) return <Navigate to="/" replace />

  if (settling || slides.length === 0) {
    return (
      <div className="flex h-dvh items-center justify-center bg-ink">
        <div className="size-10 animate-spin rounded-full border-3 border-white/15 border-t-accent" />
      </div>
    )
  }

  const slide = slides[Math.min(index, slides.length - 1)]

  return (
    <div
      className="relative flex h-dvh select-none flex-col overflow-hidden bg-ink"
      style={{ touchAction: 'manipulation' }}
      onPointerDown={(e) => {
        if (e.pointerType === 'touch') setPaused(true)
      }}
      onPointerUp={(e) => {
        setPaused(false)
        const rect = e.currentTarget.getBoundingClientRect()
        step(tapDirection(e.clientX - rect.left, rect.width))
      }}
      onPointerCancel={() => setPaused(false)}
    >
      <Progress count={slides.length} index={index} paused={paused} still={reduceMotion} />

      <Link
        to={preview ? `${RECAP_HREF}?preview=${preview}` : RECAP_HREF}
        replace
        onPointerUp={(e) => e.stopPropagation()}
        className="absolute right-4 top-6 z-20 flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/70 backdrop-blur transition hover:bg-white/20 hover:text-white"
      >
        Skip
        <CloseIcon className="size-3.5" />
      </Link>

      <Card key={index} slide={slide} stats={stats!} still={reduceMotion} onFinish={toPage} />
    </div>
  )
}

/** Story bars: filled behind, draining on the current one, empty ahead. */
function Progress({
  count,
  index,
  paused,
  still,
}: {
  count: number
  index: number
  paused: boolean
  still: boolean
}) {
  return (
    <div className="absolute inset-x-0 top-0 z-20 flex gap-1 p-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-0.5 flex-1 overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full origin-left bg-white"
            style={
              i < index
                ? { transform: 'scaleX(1)' }
                : i > index
                  ? { transform: 'scaleX(0)' }
                  : still
                    ? { transform: 'scaleX(1)' }
                    : {
                        animation: `recap-drain ${SLIDE_MS}ms linear both`,
                        animationPlayState: paused ? 'paused' : 'running',
                      }
            }
          />
        </div>
      ))}
    </div>
  )
}

function Card({
  slide,
  stats,
  still,
  onFinish,
}: {
  slide: StorySlide
  stats: RecapStats
  still: boolean
  onFinish: () => void
}) {
  const counted = useCountUp(slide.countTo ?? 0, { enabled: !still && slide.countTo != null })
  const headline = slide.countTo != null ? counted.toLocaleString() : slide.headline

  return (
    <div
      className="relative flex flex-1 flex-col items-center justify-center px-6 text-center"
      style={still ? {} : { animation: 'recap-rise 480ms cubic-bezier(.2,.7,.3,1) both' }}
    >
      {slide.posters && slide.posters.length > 0 && <Wash posters={slide.posters} still={still} />}

      <div className="relative z-10 flex w-full max-w-2xl flex-col items-center">
        {slide.poster && <BigPoster item={slide.poster} still={still} />}

        {slide.eyebrow && (
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.22em] text-accent">
            {slide.eyebrow}
          </p>
        )}

        <h1
          className={`font-black tracking-tight ${
            headline.length > 22 ? 'text-4xl sm:text-6xl' : 'text-6xl sm:text-8xl'
          }`}
        >
          {headline}
        </h1>

        {slide.detail && <p className="mt-5 max-w-lg text-base text-white/55">{slide.detail}</p>}

        {slide.kind === 'shows' && <TopFive stats={stats} still={still} />}

        {slide.kind === 'time' && (
          <p className="mt-6 max-w-md text-xs text-white/30">{ESTIMATE_CAVEAT}</p>
        )}

        {slide.kind === 'closing' && (
          <button
            onPointerUp={(e) => {
              e.stopPropagation()
              onFinish()
            }}
            className="mt-8 rounded-full bg-white px-8 py-3 font-bold text-black transition hover:bg-white/85"
          >
            See the full recap
          </button>
        )}
      </div>
    </div>
  )
}

function TopFive({ stats, still }: { stats: RecapStats; still: boolean }) {
  const api = useApi()
  return (
    <ol className="mt-8 w-full max-w-md space-y-2 text-left">
      {stats.topShows.map((show, i) => {
        const src = show.poster ? api.coverUrl(show.poster as never, 80, 120) : null
        return (
          <li
            key={show.key}
            className="flex items-center gap-3 rounded-lg bg-white/5 p-2"
            style={still ? {} : { animation: `recap-rise 460ms ease-out ${i * 110}ms both` }}
          >
            <span className="w-4 shrink-0 text-center text-sm tabular-nums text-white/30">
              {i + 1}
            </span>
            {src && <img src={src} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{show.label}</span>
            <span className="shrink-0 text-xs tabular-nums text-white/40">{show.count}</span>
          </li>
        )
      })}
    </ol>
  )
}

function BigPoster({ item, still }: { item: PosterRef; still: boolean }) {
  const api = useApi()
  const src = api.coverUrl(item as never, 300, 450)
  if (!src) return null
  return (
    <img
      src={src}
      alt=""
      className="mb-6 h-52 w-36 rounded-xl object-cover shadow-2xl ring-1 ring-white/15 sm:h-64 sm:w-44"
      style={still ? {} : { animation: 'recap-pop 620ms cubic-bezier(.2,.8,.3,1.2) both' }}
    />
  )
}

/** Posters behind the opening card, dim enough to be texture. */
function Wash({ posters, still }: { posters: PosterRef[]; still: boolean }) {
  const api = useApi()
  const srcs = posters.map((p) => api.coverUrl(p as never, 200, 300)).filter(Boolean) as string[]
  if (srcs.length === 0) return null
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="flex h-full items-center justify-center gap-5 opacity-[0.16] blur-[3px]">
        {[...srcs, ...srcs, ...srcs].slice(0, 10).map((src, i) => (
          <img
            key={i}
            src={src}
            alt=""
            className="h-64 w-44 shrink-0 rounded-xl object-cover"
            style={still ? {} : { animation: `recap-rise 900ms ease-out ${i * 70}ms both` }}
          />
        ))}
      </div>
      <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/70 to-ink/85" />
    </div>
  )
}
