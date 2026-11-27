import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useUpcoming } from '../lib/queries'
import { airStatus, dayKeyOf, groupByDay, withinDays } from '../lib/schedule'
import { useCarousel } from '../lib/useCarousel'
import { CarouselArrow } from './CarouselArrow'

const DAYS_AHEAD = 7

/**
 * The week ahead, on the home page.
 *
 * Deliberately not a `Row` of `MediaCard`s. Half of what is coming has no
 * file behind it yet, and a poster with a play button on it that cannot play
 * is worse than no row — so these are flat entries that link to the series
 * and say plainly which ones have landed.
 *
 * Renders nothing when there is nothing, like every other row here: an empty
 * shelf on the home page reads as something broken.
 */
export function AiringThisWeek() {
  const { data } = useUpcoming()
  const { scroller, canLeft, canRight, measure, page } = useCarousel(data)
  const tz = -new Date().getTimezoneOffset()
  const todayKey = dayKeyOf(Date.now(), tz)

  const days = useMemo(
    () => withinDays(groupByDay(data ?? [], tz, todayKey), DAYS_AHEAD, todayKey),
    [data, tz, todayKey],
  )
  if (days.length === 0) return null

  return (
    /*
      `relative` is load-bearing here, not decoration. Every `Row` above hangs
      7rem of invisible scroller over whatever follows it, so a hover-scaled
      card is not clipped, and a `Row` is positioned while this was not — a
      positioned sibling paints above an unpositioned one however late in the
      tree the unpositioned one comes. Next Up's overhang therefore covered
      this heading and the link beside it, and swallowed every click aimed at
      them. `group/row` is the hover scope the arrows below fade in on.
    */
    <section className="group/row relative mb-8">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-4 sm:px-12">
        <h2 className="text-lg font-semibold sm:text-xl">Airing This Week</h2>
        <Link to="/schedule" className="text-xs text-white/50 transition hover:text-white">
          Full schedule →
        </Link>
      </div>

      {/*
        A week of day cards is wider than the window on most screens, and a
        mouse wheel over a horizontal scroller moves the page rather than the
        shelf — so without these the back half of the week could be seen but
        never reached with a mouse.
      */}
      <div className="relative">
        {canLeft && (
          <CarouselArrow side="left" label="Scroll the week left" onClick={() => page(-1)} />
        )}
        {canRight && (
          <CarouselArrow side="right" label="Scroll the week right" onClick={() => page(1)} />
        )}

        <div
          ref={scroller}
          onScroll={measure}
          className="scrollbar-none flex gap-3 overflow-x-auto px-4 pb-1 sm:px-12"
        >
          {days.map((day) => (
            <div
              key={day.key}
              className="w-56 shrink-0 rounded-xl border border-white/10 bg-ink-soft/60 p-3"
            >
              <p className="mb-2 text-xs font-semibold text-white/70">{day.label}</p>
              <ul className="space-y-1.5">
                {day.items.slice(0, 4).map((item) => (
                  <li key={item.Id}>
                    <Link
                      to={`/item/${(airStatus(item) === 'have' ? item.Id : item.SeriesId) ?? item.Id}`}
                      className="group/entry block"
                    >
                      <span className="flex items-center gap-1.5">
                        <span
                          aria-hidden="true"
                          className={`size-1.5 shrink-0 rounded-full ${
                            airStatus(item) === 'have' ? 'bg-emerald-400' : 'bg-white/30'
                          }`}
                        />
                        <span className="truncate text-xs text-white/80 group-hover/entry:text-white">
                          {item.SeriesName ?? item.Name}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
                {day.items.length > 4 && (
                  <li className="pl-3 text-[0.7rem] text-white/35">
                    +{day.items.length - 4} more
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
