import { useCallback, useEffect, useRef, useState } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { CardSkeleton, MediaCard, type CardShape } from './MediaCard'
import { ChevronLeft, ChevronRight } from './icons'

interface Props {
  title: string
  items?: BaseItemDto[]
  isLoading?: boolean
  /** Shown instead of the row so a failed fetch isn't mistaken for an empty one. */
  error?: unknown
  onRetry?: () => void
  shape?: CardShape
  showProgress?: boolean
}

/**
 * Horizontal carousel with paged arrow scrolling. Rows with nothing in them
 * render nothing at all, so the home page has no empty shelves.
 */
export function Row({
  title,
  items,
  isLoading,
  error,
  onRetry,
  shape = 'poster',
  showProgress,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    setCanLeft(el.scrollLeft > 8)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8)
  }, [])

  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [measure, items])

  const page = (dir: -1 | 1) => {
    const el = scroller.current
    if (!el) return
    // Leave a sliver of the previous card visible so the row reads as continuous.
    el.scrollBy({ left: dir * (el.clientWidth * 0.85), behavior: 'smooth' })
  }

  // A row that failed must say so. Rendering nothing makes a broken request
  // indistinguishable from a library that genuinely has none of this.
  if (error) {
    return (
      <section className="py-3">
        <h2 className="mb-2 px-4 text-base font-semibold text-white/90 sm:px-14 sm:text-lg">
          {title}
        </h2>
        <div className="mx-4 flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-ink-soft/50 px-4 py-3 sm:mx-14">
          <p className="text-sm text-white/55">
            {error instanceof Error ? error.message : "This row couldn't load."}
          </p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="rounded border border-white/20 px-3 py-1 text-xs transition hover:border-white/50"
            >
              Retry
            </button>
          )}
        </div>
      </section>
    )
  }

  /*
    Defend against a shape we didn't expect. `/Items/Latest` returns a bare
    array while `/Items` returns { Items: [...] }, and getting that wrong once
    crashed the whole page rather than losing one row.
  */
  const list = Array.isArray(items) ? items : []

  if (!isLoading && list.length === 0) return null

  return (
    <section className="group/row relative py-3">
      <h2 className="mb-2 px-4 text-base font-semibold text-white/90 sm:px-14 sm:text-lg">
        {title}
      </h2>

      <div className="relative">
        {canLeft && (
          <button
            onClick={() => page(-1)}
            aria-label={`Scroll ${title} left`}
            className="absolute left-0 top-0 z-20 hidden h-[calc(100%-2.5rem)] w-12 items-center justify-center bg-linear-to-r from-black/85 to-transparent text-white opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 hover:from-black sm:flex"
          >
            <ChevronLeft className="size-8" />
          </button>
        )}

        <div
          ref={scroller}
          onScroll={measure}
          className="scrollbar-none flex gap-2.5 overflow-x-auto scroll-smooth px-4 pb-28 -mb-28 sm:px-14"
        >
          {isLoading
            ? Array.from({ length: 8 }, (_, i) => <CardSkeleton key={i} shape={shape} />)
            : list.map((item) => (
                <MediaCard
                  key={item.Id}
                  item={item}
                  shape={shape}
                  showProgress={showProgress}
                />
              ))}
        </div>

        {canRight && (
          <button
            onClick={() => page(1)}
            aria-label={`Scroll ${title} right`}
            className="absolute right-0 top-0 z-20 hidden h-[calc(100%-2.5rem)] w-12 items-center justify-center bg-linear-to-l from-black/85 to-transparent text-white opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 hover:from-black sm:flex"
          >
            <ChevronRight className="size-8" />
          </button>
        )}
      </div>
    </section>
  )
}
