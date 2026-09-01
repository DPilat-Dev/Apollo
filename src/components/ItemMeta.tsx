import { Link } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { personHref } from '../lib/persons'

/**
 * Rotten Tomatoes' own threshold: 60% and above is Fresh, below is Rotten.
 * Jellyfin stores the critic score as a plain 0–100 number.
 */
const FRESH_AT = 60

export function Ratings({ item }: { item: BaseItemDto }) {
  const critic = item.CriticRating
  const community = item.CommunityRating
  const imdbId = (item.ProviderIds as Record<string, string> | undefined)?.Imdb
  const tmdbId = (item.ProviderIds as Record<string, string> | undefined)?.Tmdb
  const tmdbKind = item.Type === 'Series' ? 'tv' : 'movie'

  if (critic == null && community == null && !imdbId && !tmdbId) return null

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
      {typeof critic === 'number' && (
        <span className="flex items-center gap-1.5" title="Rotten Tomatoes critic score">
          <Tomato fresh={critic >= FRESH_AT} />
          <span className="font-semibold tabular-nums">{Math.round(critic)}%</span>
        </span>
      )}

      {typeof community === 'number' && (
        <span className="flex items-center gap-1.5" title="Community rating">
          <span className="text-amber-400" aria-hidden>
            ★
          </span>
          <span className="font-semibold tabular-nums">{community.toFixed(1)}</span>
        </span>
      )}

      {imdbId && (
        <ExternalRating
          href={`https://www.imdb.com/title/${imdbId}/`}
          label="IMDb"
          className="bg-[#f5c518] text-black"
        />
      )}
      {tmdbId && (
        <ExternalRating
          href={`https://www.themoviedb.org/${tmdbKind}/${tmdbId}`}
          label="TMDB"
          className="bg-[#01b4e4] text-black"
        />
      )}
    </div>
  )
}

function Tomato({ fresh }: { fresh: boolean }) {
  return fresh ? (
    <svg viewBox="0 0 24 24" className="size-4" aria-label="Fresh">
      <circle cx="12" cy="13" r="8.5" fill="#fa320a" />
      <path d="M12 4.5c1.6-2 3.6-2.2 4.4-1.6-.6 1.6-2.2 2.6-3.4 2.8z" fill="#3f9e2d" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="size-4" aria-label="Rotten">
      <path d="M4 14c0-4 3.5-7.5 8-7.5s8 3.5 8 7.5-3.5 7-8 7-8-3-8-7z" fill="#0ac855" />
      <path d="M9 12.5l1.5 2M15 12.5l-1.5 2" stroke="#063" strokeWidth="1.4" />
    </svg>
  )
}

function ExternalRating({
  href,
  label,
  className,
}: {
  href: string
  label: string
  className: string
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={`rounded px-1.5 py-0.5 text-[11px] font-bold tracking-wide transition hover:opacity-80 ${className}`}
    >
      {label}
    </a>
  )
}

// ------------------------------------------------------------------- chips

export function FilterChips({ item }: { item: BaseItemDto }) {
  // GenreItems carries ids; Genres is names only, so prefer the former and
  // fall back to a name filter when a server hasn't populated it.
  const genres = item.GenreItems?.length
    ? item.GenreItems.map((g) => ({
        key: g.Id ?? g.Name ?? '',
        name: g.Name ?? '',
        to: `/browse?genreIds=${g.Id}&name=${encodeURIComponent(g.Name ?? '')}&kind=Genre`,
      }))
    : (item.Genres ?? []).map((name) => ({
        key: name,
        name,
        to: `/browse?genre=${encodeURIComponent(name)}&name=${encodeURIComponent(name)}&kind=Genre`,
      }))

  const studios = (item.Studios ?? [])
    .filter((s) => s.Name)
    .map((s) => ({
      key: s.Id ?? s.Name!,
      name: s.Name!,
      to: `/browse?studioIds=${s.Id}&name=${encodeURIComponent(s.Name!)}&kind=Studio`,
    }))

  if (genres.length === 0 && studios.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {genres.map((g) => (
        <Chip key={`g-${g.key}`} to={g.to}>
          {g.name}
        </Chip>
      ))}
      {studios.map((s) => (
        <Chip key={`s-${s.key}`} to={s.to} muted>
          {s.name}
        </Chip>
      ))}
    </div>
  )
}

function Chip({
  to,
  muted,
  children,
}: {
  to: string
  muted?: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      className={`rounded-full px-3 py-1 text-xs transition ${
        muted
          ? 'border border-white/15 text-white/55 hover:border-white/40 hover:text-white'
          : 'bg-white/10 text-white/80 hover:bg-white/20'
      }`}
    >
      {children}
    </Link>
  )
}

// ------------------------------------------------------------ cast and crew

const CREW_TYPES = ['Director', 'Writer', 'Producer', 'Composer']

export function CastAndCrew({ item }: { item: BaseItemDto }) {
  const api = useApi()
  const people = item.People ?? []
  if (people.length === 0) return null

  const actors = people.filter((p) => p.Type === 'Actor')
  const crew = people.filter((p) => CREW_TYPES.includes(p.Type ?? ''))
  // Crew first — a director is usually why someone is looking.
  const ordered = [...crew.slice(0, 6), ...actors.slice(0, 24)]

  return (
    <section className="mt-12 px-4 sm:px-14">
      <h2 className="mb-4 text-xl font-semibold">Cast &amp; Crew</h2>
      <div className="scrollbar-none flex gap-4 overflow-x-auto pb-2">
        {ordered.map((person) => {
          // Goes through imageUrl so cast portraits get the same pixel-ratio
          // scaling and quality as everything else.
          const portrait =
            person.Id && person.PrimaryImageTag
              ? api.imageUrl(
                  { Id: person.Id, ImageTags: { Primary: person.PrimaryImageTag } },
                  'Primary',
                  { width: 140 },
                )
              : null
          // Both the name and the punctuation in it are the person page's
          // key, so the link is built where that encoding is tested.
          const href = personHref(person)
          const key = `${person.Id}-${person.Type}-${person.Role ?? ''}`
          const card = (
            <>
              <div className="aspect-square overflow-hidden rounded-full bg-ink-card ring-2 ring-transparent transition group-hover:ring-accent">
                {portrait ? (
                  <img
                    src={portrait}
                    alt=""
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-lg font-bold text-white/35">
                    {(person.Name ?? '?').charAt(0).toUpperCase()}
                  </span>
                )}
              </div>
              <p className="mt-2 line-clamp-2 text-xs font-medium text-white/85">{person.Name}</p>
              <p className="line-clamp-1 text-[11px] text-white/40">
                {person.Role || person.Type}
              </p>
            </>
          )

          // A credit carrying neither a name nor an id leads nowhere, and a
          // link to nowhere is worse than a card that simply does not move.
          return href ? (
            <Link key={key} to={href} className="group w-24 shrink-0 text-center sm:w-28">
              {card}
            </Link>
          ) : (
            <div key={key} className="w-24 shrink-0 text-center sm:w-28">
              {card}
            </div>
          )
        })}
      </div>
    </section>
  )
}
