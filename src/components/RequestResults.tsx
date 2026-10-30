import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  availability,
  seerrPoster,
  seerrTitle,
  seerrYear,
  type SeerrResult,
} from '../lib/jellyseerr'
import { useJellyseerrSearch, useJellyseerrSession, useRequestMedia } from '../lib/queries'
import { useSettings } from '../lib/settings'
import { PlusIcon, CheckIcon, InfoIcon } from './icons'
import { RequestDialog } from './RequestDialog'
import { errorText } from '../lib/api'

/**
 * The "we don't have it" half of search. Sits under the library results,
 * because that is exactly the moment someone wants to request something.
 *
 * Renders nothing at all when Jellyseerr isn't wired up — an unconfigured
 * install should not leave a broken panel on the search page.
 */
export function RequestResults({
  term,
  standalone = false,
}: {
  term: string
  /** True when this is the only thing on the page, so it needs no top margin. */
  standalone?: boolean
}) {
  const { jellyseerrEnabled } = useSettings()
  const session = useJellyseerrSession()
  const signedIn = Boolean(session.data?.user)
  const search = useJellyseerrSearch(term, signedIn && jellyseerrEnabled)

  if (!jellyseerrEnabled) return null
  if (session.isLoading || !session.data?.reachable) return null

  if (!signedIn) {
    return (
      <section
        className={`rounded-xl border border-white/10 bg-ink-soft/50 px-5 py-4 ${standalone ? 'mt-8' : 'mt-12'}`}
      >
        <p className="text-sm text-white/70">
          Can't find it? Connect Jellyseerr to request titles that aren't in the library.
        </p>
        <Link
          to="/settings"
          className="mt-2 inline-block text-xs text-accent underline underline-offset-4"
        >
          Connect in Settings
        </Link>
      </section>
    )
  }

  // People are matches in Jellyseerr but there's nothing to request.
  const raw = search.data?.results
  const results = (Array.isArray(raw) ? raw : []).filter((r) => r.mediaType !== 'person')

  if (search.isLoading) {
    return (
      <section className={standalone ? 'mt-8' : 'mt-12'}>
        <h2 className="mb-4 text-lg font-semibold text-white/80">Request from Jellyseerr</h2>
        <div className="grid grid-cols-2 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton aspect-2/3 rounded-lg" />
          ))}
        </div>
      </section>
    )
  }

  if (search.error) return null
  if (results.length === 0) {
    return standalone ? (
      <p className="py-12 text-center text-white/40">Jellyseerr found nothing for “{term}”.</p>
    ) : null
  }

  return (
    <section className={standalone ? 'mt-8' : 'mt-12'}>
      <h2 className="mb-1 text-lg font-semibold text-white/80">Request from Jellyseerr</h2>
      <p className="mb-4 text-sm text-white/40">
        Titles beyond your library. Requesting sends it to Jellyseerr as you.
      </p>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
        {results.map((r) => (
          <RequestCard key={`${r.mediaType}-${r.id}`} result={r} />
        ))}
      </div>
    </section>
  )
}

function RequestCard({ result }: { result: SeerrResult }) {
  const { requestAllSeasons } = useSettings()
  const request = useRequestMedia()
  const [state, setState] = useState<'idle' | 'done' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const poster = seerrPoster(result)
  const year = seerrYear(result)
  // The button says what it opens: a film has no seasons to pick.
  const isTv = result.mediaType === 'tv'
  const { label, requestable } = availability(result)
  const done = state === 'done'

  const submit = () => {
    setMessage(null)
    request.mutate(
      {
        mediaType: result.mediaType as 'movie' | 'tv',
        mediaId: result.id,
        // Seasons are required for TV. 'all' matches what the official
        // integration sends; the setting narrows it to season one.
        ...(result.mediaType === 'tv'
          ? { seasons: requestAllSeasons ? ('all' as const) : [1] }
          : {}),
      },
      {
        onSuccess: () => setState('done'),
        onError: (e) => {
          setState('error')
          setMessage(errorText(e, 'Request failed.'))
        },
      },
    )
  }

  return (
    <div className="group/req">
      <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-ink-card">
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center px-2 text-center text-xs text-white/40">
            {seerrTitle(result)}
          </div>
        )}

        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/70">
          {result.mediaType === 'tv' ? 'Series' : 'Film'}
        </span>

        {/*
          Both intents, named, in the same place.

          This started as a bare ⓘ in the corner, over a dim that filled the
          poster. Two things were wrong with it. The dim was a later sibling
          with no z-index, so it painted over the icon and swallowed the
          click — and the click it swallowed was Request, which filed five
          seasons of a show nobody asked for. And an unlabelled icon that
          appears on hover is a poor way to advertise the only route to the
          season picker.

          So: the dim takes no clicks at all, the two controls are labelled
          and sit together, and a stray click on artwork does nothing. Request
          stays first and primary, because it is still the one people came
          for — the picker is the considered path, not the default one.
        */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 touch:gap-3 bg-black/55 opacity-0 transition-opacity group-hover/req:opacity-100 focus-within:opacity-100 touch:opacity-100">
          {(requestable || done) && (
            <button
              onClick={submit}
              disabled={request.isPending || done}
              className={`pointer-events-auto flex items-center gap-1.5 rounded-full px-3.5 py-2 touch:py-3.5 text-xs font-semibold transition ${
                done
                  ? 'bg-emerald-500/90 text-white'
                  : 'bg-white text-black hover:bg-white/85 disabled:opacity-60'
              }`}
            >
              {done ? (
                <>
                  <CheckIcon className="size-3.5" /> Requested
                </>
              ) : (
                <>
                  <PlusIcon className="size-3.5" />
                  {request.isPending ? 'Sending…' : 'Request'}
                </>
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label={`More about ${seerrTitle(result)}`}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-white/45 px-3 py-1.5 touch:py-3.5 text-xs font-medium text-white/90 transition hover:border-white hover:bg-white/15 hover:text-white"
          >
            <InfoIcon className="size-3.5" />
            {isTv ? 'Seasons' : 'Details'}
          </button>
        </div>
      </div>

      <p className="mt-2 line-clamp-1 text-[13px] font-medium text-white/85">
        {seerrTitle(result)}
      </p>
      <p className="line-clamp-1 text-[11px] text-white/45">
        {[year, done ? 'Requested' : label].filter(Boolean).join(' · ')}
      </p>
      {message && <p className="mt-0.5 text-[11px] text-red-300">{message}</p>}

      {open && <RequestDialog result={result} onClose={() => setOpen(false)} />}
    </div>
  )
}
