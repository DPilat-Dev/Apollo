import { useState } from 'react'
import {
  availability,
  seerrBackdrop,
  seerrPoster,
  seerrTitle,
  seerrYear,
  type SeerrResult,
} from '../lib/jellyseerr'
import { useJellyseerrDetails, useRequestMedia } from '../lib/queries'
import { useSettings } from '../lib/settings'
import {
  defaultSeasonSelection,
  listedSeasons,
  metaLine,
  nothingRequestable,
  requestLabel,
  requestedAnnouncement,
  seasonState,
  seasonStatusOf,
  seasonSublabel,
  seasonTitle,
  toggleSeason,
} from '../lib/requestSeasons'
import { Modal } from './Modal'
import { CheckIcon, PlusIcon } from './icons'
import { errorText } from '../lib/api'

/**
 * The long way to request something.
 *
 * The short way stays exactly as it was — hover a card, press Request, it goes
 * — because for a film there is nothing to decide and for most shows "all of
 * it" is the right answer. This is for the rest: reading what a title actually
 * is before asking for it, and asking for seasons 3 to 5 of a show you already
 * have the first two of.
 *
 * Which seasons are offered, which are already spoken for and what is ticked
 * on arrival are all decided in `requestSeasons`, which has no document and is
 * tested. This file is the part that needs one.
 */
export function RequestDialog({
  result,
  onClose,
}: {
  result: SeerrResult
  onClose: () => void
}) {
  const { requestAllSeasons } = useSettings()
  const details = useJellyseerrDetails(result.mediaType as 'movie' | 'tv', result.id, true)
  const request = useRequestMedia()

  /*
    Null means "nobody has touched the boxes", which is not the same as "no
    seasons are ticked" — the default has to keep applying until then, because
    the details arrive after the dialog opens and the default is computed from
    them. Derived rather than copied into state by an effect, which would also
    have to decide what to do when the details refetch underneath it.
  */
  const [chosen, setChosen] = useState<number[] | null>(null)
  const [sent, setSent] = useState<number[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const isTv = result.mediaType === 'tv'
  const data = details.data
  const listed = isTv ? listedSeasons(data?.seasons) : []
  const states = data?.mediaInfo?.seasons
  const selected = chosen ?? defaultSeasonSelection(listed, states, requestAllSeasons)
  const everything = defaultSeasonSelection(listed, states, true)

  const title = seerrTitle(result)
  const year = seerrYear(result)
  const poster = seerrPoster(result, 500)
  const backdrop = seerrBackdrop(data?.backdropPath)
  const overview = data?.overview ?? result.overview

  const exhausted = isTv && nothingRequestable(listed, states)
  const { label: wholeLabel, requestable } = availability(result)

  // A film has nothing to tick, so the only question is whether it can be
  // asked for at all. A show needs at least one box.
  const canSend = isTv ? selected.length > 0 && !exhausted : requestable
  const done = sent !== null

  const submit = () => {
    setMessage(null)
    request.mutate(
      {
        mediaType: result.mediaType as 'movie' | 'tv',
        mediaId: result.id,
        ...(isTv ? { seasons: selected } : {}),
      },
      {
        onSuccess: () => setSent(isTv ? selected : []),
        onError: (e) => setMessage(errorText(e, 'Request failed.')),
      },
    )
  }

  return (
    <Modal title={title} onClose={onClose}>
      {/* Pulled up under the sticky header so the still meets it, and kept
          short: this is context for a decision, not a poster wall. */}
      {backdrop && (
        <div className="-mx-5 -mt-5 relative h-32 overflow-hidden sm:h-40">
          <img src={backdrop} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-soft via-ink-soft/40 to-transparent" />
        </div>
      )}

      <div className="flex gap-4">
        {poster && (
          <img
            src={poster}
            alt=""
            className="hidden w-24 shrink-0 self-start rounded-lg sm:block"
          />
        )}
        <div className="min-w-0">
          <p className="text-sm text-white/45">
            {metaLine({
              year,
              runtime: data?.runtime,
              seasons: isTv ? (data?.numberOfSeasons ?? listed.length) : undefined,
              voteAverage: data?.voteAverage,
            })}
          </p>
          {data?.genres && data.genres.length > 0 && (
            <p className="mt-1 text-xs text-white/35">
              {data.genres.map((g) => g.name).join(', ')}
            </p>
          )}
          {overview ? (
            <p className="mt-3 text-sm leading-relaxed text-white/70">{overview}</p>
          ) : details.isLoading ? (
            <div className="mt-3 space-y-2">
              <div className="skeleton h-3 w-full rounded" />
              <div className="skeleton h-3 w-11/12 rounded" />
              <div className="skeleton h-3 w-2/3 rounded" />
            </div>
          ) : (
            <p className="mt-3 text-sm text-white/40">No description.</p>
          )}
        </div>
      </div>

      {/* Films skip all of this. So does a show whose details failed, rather
          than offering a season list built from nothing. */}
      {isTv && (details.isLoading || listed.length > 0 || details.isError) && (
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-white/80">Seasons</h3>
            {everything.length > 0 && (
              <button
                type="button"
                onClick={() =>
                  setChosen(selected.length === everything.length ? [] : everything)
                }
                className="rounded text-xs text-accent underline underline-offset-4 hover:text-accent-hot"
              >
                {selected.length === everything.length ? 'Clear all' : 'Select all'}
              </button>
            )}
          </div>

          {details.isLoading && (
            <div className="space-y-2">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="skeleton h-12 rounded-lg" />
              ))}
            </div>
          )}

          {details.isError && (
            <p className="text-sm text-white/40">
              Couldn't load the season list. The whole series can still be requested from the
              card.
            </p>
          )}

          <ul className="space-y-1.5">
            {listed.map((season) => {
              const { note, selectable } = seasonState(
                seasonStatusOf(states, season.seasonNumber),
              )
              const checked = selected.includes(season.seasonNumber)
              const sub = seasonSublabel(season)
              return (
                <li key={season.id}>
                  <label
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                      selectable
                        ? `cursor-pointer ${
                            checked
                              ? 'border-accent/60 bg-accent/15'
                              : 'border-white/15 bg-ink-soft hover:border-white/35'
                          }`
                        : 'border-white/5 bg-white/[0.02]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked && selectable}
                      disabled={!selectable || done}
                      onChange={() => setChosen(toggleSeason(selected, season.seasonNumber))}
                      className="size-4 shrink-0 accent-accent"
                    />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm ${selectable ? 'text-white/90' : 'text-white/40'}`}
                      >
                        {seasonTitle(season)}
                      </span>
                      {sub && <span className="block text-[11px] text-white/40">{sub}</span>}
                    </span>
                    {note && (
                      <span className="shrink-0 text-[11px] uppercase tracking-wide text-white/40">
                        {note}
                      </span>
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-3">
        {/*
          Mounted empty rather than appearing with its text, for the same
          reason as the library's count line: a live region has to be in the
          tree before it changes to be read out.
        */}
        <p role="status" className="mr-auto text-sm text-white/55">
          {done
            ? requestedAnnouncement(sent)
            : exhausted
              ? 'Every season is already here or on its way.'
              : !isTv && !requestable
                ? wholeLabel
                : ''}
        </p>

        <button
          type="button"
          onClick={onClose}
          className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/70 transition hover:border-white/35 hover:text-white"
        >
          {done ? 'Close' : 'Cancel'}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSend || request.isPending || done}
          className={`flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition ${
            done
              ? 'bg-emerald-500/90 text-white'
              : 'bg-white text-black hover:bg-white/85 disabled:opacity-50'
          }`}
        >
          {done ? (
            <>
              <CheckIcon className="size-3.5" /> Requested
            </>
          ) : (
            <>
              <PlusIcon className="size-3.5" />
              {request.isPending
                ? 'Sending…'
                : isTv
                  ? requestLabel(selected.length)
                  : 'Request'}
            </>
          )}
        </button>
      </div>

      {message && <p className="text-right text-sm text-red-300">{message}</p>}
    </Modal>
  )
}
