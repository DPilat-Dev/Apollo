import { useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useApi } from '../lib/auth'
import { Browse } from './Browse'
import {
  bioIsLong,
  personBio,
  personBirthplace,
  personHeaderMode,
  personLifeline,
  personLinks,
  personRequestPath,
  personRoleLabel,
} from '../lib/persons'

/**
 * One person: who they are, above everything of theirs the library holds.
 *
 * The filmography is not reimplemented here — this renders `Browse`, which
 * already does grids of items with filters, sorting and infinite paging, and
 * hands it a header to show instead of a plain title. The route the cast chips
 * used to point at, `/browse?personIds=`, redirects here, so there is exactly
 * one page showing a filmography rather than two that drift apart.
 *
 * The name in the path is the key, because `/Persons/{name}` is what Jellyfin
 * offers — there is no by-id endpoint for a person's biography. The credit's
 * id rides in the query anyway: names are not unique, and the id is what makes
 * the grid below show the right person's work.
 */
export function Person() {
  const { name = '' } = useParams<{ name: string }>()
  const [params] = useSearchParams()
  const api = useApi()
  const [expanded, setExpanded] = useState(false)

  const { data: person, isFetched } = useQuery({
    queryKey: ['person', api.userId, name],
    queryFn: () => api.person(name),
    enabled: Boolean(personRequestPath(name)),
    // A person's biography changes when someone edits metadata, which is
    // rarely, and this refetches on every cast chip clicked without it.
    staleTime: 30 * 60 * 1000,
    // A name the server has never heard of 404s, and asking three more times
    // does not make it exist.
    retry: false,
  })

  /*
    Straight through `imageUrl`, which builds `/Items/{id}/Images/Primary`.

    A person is a library item like any other, so their portrait is served by
    the same endpoint as a poster and by the same tag — `/Persons/{name}/Images`
    is the same picture reached by a second name-keyed path. Going through
    `imageUrl` gets the pixel-ratio bucketing and quality every other image in
    the app has, and is what the cast chips on a detail page already do.
  */
  const portrait = person ? api.imageUrl(person, 'Primary', { width: 240 }) : null

  const details = person ?? {}
  const mode = personHeaderMode(details, Boolean(portrait))
  const role = personRoleLabel({ kind: params.get('kind'), role: params.get('role') })
  const bio = personBio(details)
  const lifeline = personLifeline(details)
  const birthplace = personBirthplace(details)
  const links = personLinks(details)

  /*
    No skeleton hero while the person loads. For the many people a library knows
    nothing about, a placeholder portrait and three grey bars would resolve into
    a bare name — a page that promises something and then takes it away. The
    header starts as the title Browse always showed and grows if there is
    anything to grow into.
  */
  const heading = (
    <div className={mode === 'full' ? 'flex gap-5 sm:gap-7' : undefined}>
      {mode === 'full' && portrait && (
        <img
          src={portrait}
          alt=""
          className="size-24 shrink-0 rounded-full object-cover ring-1 ring-white/10 sm:size-36"
        />
      )}

      <div className="min-w-0 flex-1">
        {role && <p className="text-xs uppercase tracking-wider text-white/40">{role}</p>}
        <h1 className="text-2xl font-bold sm:text-4xl">{person?.Name || name}</h1>

        {/*
          Said out loud rather than left as a gap. A page with a name and
          nothing else reads as something that failed to load; this one line is
          the difference between "broken" and "the library has no biography for
          this person, and here is everything they are in".
        */}
        {mode === 'compact' && isFetched && (
          <p className="mt-1.5 text-sm text-white/40">
            No biography on file. Everything of theirs in the library is below.
          </p>
        )}

        {lifeline && <p className="mt-1.5 text-sm text-white/60">{lifeline}</p>}
        {birthplace && <p className="text-sm text-white/40">{birthplace}</p>}

        {links.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-2">
            {links.map((link) => (
              <a
                key={link.label}
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/55 transition hover:border-white/40 hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>
        )}

        {bio && (
          <div className="mt-4 max-w-3xl">
            <p
              className={`whitespace-pre-line text-sm leading-relaxed text-white/70 ${
                bioIsLong(bio) && !expanded ? 'line-clamp-5' : ''
              }`}
            >
              {bio}
            </p>
            {bioIsLong(bio) && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 text-xs font-semibold text-white/45 transition hover:text-accent"
              >
                {expanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return <Browse heading={heading} fallbackPersonId={person?.Id ?? undefined} />
}
