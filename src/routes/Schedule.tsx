import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useUpcoming } from '../lib/queries'
import { LoadFailure } from '../components/LoadFailure'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { pageTitle } from '../lib/pageTitle'
import {
  addMonths,
  airStatus,
  dayKeyOf,
  groupByDay,
  monthGrid,
  monthKeyOf,
  monthLabel,
  type DayGroup,
} from '../lib/schedule'

/**
 * What is coming, and when.
 *
 * Jellyfin's own client has an Upcoming tab and Apollo had nothing, which
 * left the question "when is the next one out?" answerable only by opening
 * the series and reading episode dates one at a time.
 *
 * Two views of one list, because people mean two different things by
 * "calendar". The agenda is the one that answers "what is on tonight" and is
 * the only one that works on a phone; the month grid is the one people
 * picture when they say the word, and it answers "how far away is it".
 *
 * Every date here goes through `lib/schedule.ts` rather than through `new
 * Date()`, because almost every premiere this server holds is midnight UTC —
 * a date, not a time — and reading those in local time puts the whole
 * schedule a day early for anyone west of Greenwich.
 */
export function Schedule() {
  useDocumentTitle(pageTitle('Schedule'))
  const { data, isLoading, error, refetch } = useUpcoming()
  const [view, setView] = useState<'agenda' | 'month'>('agenda')

  // Read once per render rather than per item: the offset cannot change
  // mid-render, and `getTimezoneOffset` counts the wrong way round.
  const tz = -new Date().getTimezoneOffset()
  const todayKey = dayKeyOf(Date.now(), tz)
  const groups = useMemo(() => groupByDay(data ?? [], tz, todayKey), [data, tz, todayKey])

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 pt-24 sm:px-8 sm:pt-28">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">Schedule</h1>
          <p className="mt-1 text-sm text-white/45">
            Episodes of shows in your library that have not aired yet.
          </p>
        </div>
        <div role="tablist" aria-label="Schedule view" className="flex gap-1 rounded-lg border border-white/15 p-1">
          {(['agenda', 'month'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded px-3 py-1.5 text-sm capitalize transition ${
                view === v ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <LoadFailure
          error={error}
          fallback="The schedule could not be loaded."
          onRetry={() => void refetch()}
        />
      )}

      {isLoading && <Skeleton />}

      {/*
        An empty list is not a failure, and the reason it is empty is almost
        always the same one — so say it, rather than leaving a blank page that
        looks like the feature is broken.
      */}
      {!isLoading && !error && groups.length === 0 && (
        <div className="rounded-xl border border-white/10 bg-ink-soft/60 p-6">
          <p className="text-sm text-white/75">Nothing upcoming.</p>
          <p className="mt-1 text-xs text-white/45">
            This is built from the air dates your server already holds, so it fills up as
            Jellyfin refreshes metadata for shows that are still running.
          </p>
        </div>
      )}

      {!isLoading && !error && groups.length > 0 && (
        view === 'agenda' ? (
          <Agenda groups={groups} />
        ) : (
          <Month groups={groups} todayKey={todayKey} />
        )
      )}
    </div>
  )
}

function Agenda({ groups }: { groups: DayGroup<BaseItemDto>[] }) {
  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
            <span>{group.label}</span>
            <span className="text-xs font-normal text-white/35">
              {group.items.length} episode{group.items.length === 1 ? '' : 's'}
            </span>
          </h2>
          <ul className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10 bg-ink-soft/60">
            {group.items.map((item) => (
              <li key={item.Id}>
                <Entry item={item} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * One episode.
 *
 * An episode the server does not hold has no detail page worth opening and
 * certainly nothing to play, so it links to the series instead. Getting this
 * wrong is the difference between a schedule and a page full of dead ends.
 */
function Entry({ item }: { item: BaseItemDto }) {
  const status = airStatus(item)
  const href = status === 'have' && item.Id ? `/item/${item.Id}` : `/item/${item.SeriesId ?? item.Id}`
  const code =
    item.ParentIndexNumber != null && item.IndexNumber != null
      ? `S${item.ParentIndexNumber}:E${item.IndexNumber}`
      : null

  return (
    <Link
      to={href}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3 transition hover:bg-white/5"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{item.SeriesName ?? item.Name}</p>
        <p className="mt-0.5 truncate text-xs text-white/45">
          {code && <span className="tabular-nums">{code}</span>}
          {code && item.Name ? ' · ' : ''}
          {item.Name}
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs ${
          status === 'have'
            ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200/90'
            : 'border-white/15 text-white/50'
        }`}
      >
        {status === 'have' ? 'On the server' : 'Not here yet'}
      </span>
    </Link>
  )
}

const WEEKDAY_HEADS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const CHIPS_PER_CELL = 3

function Month({ groups, todayKey }: { groups: DayGroup<BaseItemDto>[]; todayKey: string }) {
  const [month, setMonth] = useState(() => monthKeyOf(todayKey))
  const byDay = useMemo(() => new Map(groups.map((g) => [g.key, g.items])), [groups])
  const weeks = useMemo(() => monthGrid(month), [month])

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <button
          onClick={() => setMonth(addMonths(month, -1))}
          className="rounded border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/50"
        >
          ← Earlier
        </button>
        <h2 className="text-sm font-semibold">{monthLabel(month)}</h2>
        <button
          onClick={() => setMonth(addMonths(month, 1))}
          className="rounded border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/50"
        >
          Later →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/8">
        {WEEKDAY_HEADS.map((d) => (
          <div key={d} className="bg-ink-soft px-1 py-1.5 text-center text-[0.7rem] font-medium text-white/40">
            {/* The letter alone on a phone: three letters per column at that
                width pushes the grid wider than the screen. */}
            <span className="sm:hidden">{d[0]}</span>
            <span className="hidden sm:inline">{d}</span>
          </div>
        ))}

        {weeks.flat().map((day) => {
          const items = byDay.get(day) ?? []
          const outside = monthKeyOf(day) !== month
          return (
            <div
              key={day}
              className={`min-h-16 bg-ink-soft/80 p-1 sm:min-h-24 sm:p-1.5 ${outside ? 'opacity-40' : ''}`}
            >
              <div
                className={`mb-1 text-right text-xs tabular-nums ${
                  day === todayKey ? 'font-bold text-accent' : 'text-white/40'
                }`}
              >
                {Number(day.slice(8))}
              </div>

              {/* Below `sm` a cell is too narrow for a title, so it carries a
                  count instead — still enough to see which nights are busy. */}
              {items.length > 0 && (
                <div className="sm:hidden flex justify-center">
                  <span className="rounded-full bg-accent/25 px-1.5 text-[0.65rem] tabular-nums text-white/85">
                    {items.length}
                  </span>
                </div>
              )}

              <div className="hidden space-y-0.5 sm:block">
                {items.slice(0, CHIPS_PER_CELL).map((item) => (
                  <Link
                    key={item.Id}
                    to={`/item/${(airStatus(item) === 'have' ? item.Id : item.SeriesId) ?? item.Id}`}
                    title={`${item.SeriesName ?? ''} ${item.Name ?? ''}`}
                    className={`block truncate rounded px-1 py-0.5 text-[0.7rem] transition hover:bg-white/15 ${
                      airStatus(item) === 'have' ? 'bg-emerald-400/15 text-emerald-100/90' : 'bg-white/10 text-white/65'
                    }`}
                  >
                    {item.SeriesName ?? item.Name}
                  </Link>
                ))}
                {items.length > CHIPS_PER_CELL && (
                  <p className="px-1 text-[0.65rem] text-white/40">
                    +{items.length - CHIPS_PER_CELL} more
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div className="skeleton mb-2 h-4 w-28 rounded" />
          <div className="skeleton h-28 rounded-xl" />
        </div>
      ))}
    </div>
  )
}
