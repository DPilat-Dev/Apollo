import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { MediaCard } from '../components/MediaCard'
import { useJellyseerrSession, useSearchByLibrary } from '../lib/queries'
import { RequestResults } from '../components/RequestResults'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { pageTitle } from '../lib/pageTitle'

/** 'all' | a library id | 'jellyseerr' */
type Filter = string

export function Search() {
  const [params] = useSearchParams()
  const term = params.get('q') ?? ''
  const [filter, setFilter] = useState<Filter>('all')

  const groups = useSearchByLibrary(term)
  const seerr = useJellyseerrSession()
  const seerrAvailable = Boolean(seerr.data?.reachable)

  const found = groups.data ?? []
  const totalInLibrary = found.reduce((n, g) => n + g.items.length, 0)

  // A filter pointing at a library with no hits would show an empty page.
  const activeGroups =
    filter === 'all' ? found : found.filter((g) => g.view.Id === filter)
  const showSeerr = seerrAvailable && (filter === 'all' || filter === 'jellyseerr')
  const showLibrary = filter !== 'jellyseerr'

  useDocumentTitle(pageTitle(term, 'Search'))

  return (
    <div className="px-4 pb-24 pt-24 sm:px-14 sm:pt-28">
      <h1 className="text-xl text-white/60">
        Results for <span className="font-semibold text-white">{term}</span>
      </h1>

      {(found.length > 0 || seerrAvailable) && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            All{totalInLibrary > 0 ? ` · ${totalInLibrary}` : ''}
          </Chip>
          {found.map((g) => (
            <Chip
              key={g.view.Id}
              active={filter === g.view.Id}
              onClick={() => setFilter(g.view.Id ?? 'all')}
            >
              {g.view.Name} · {g.items.length}
            </Chip>
          ))}
          {seerrAvailable && (
            <Chip
              active={filter === 'jellyseerr'}
              onClick={() => setFilter('jellyseerr')}
              accent
            >
              Jellyseerr
            </Chip>
          )}
        </div>
      )}

      {groups.isLoading && showLibrary && (
        <div className="mt-8 grid grid-cols-3 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="skeleton aspect-2/3 rounded-lg" />
          ))}
        </div>
      )}

      {showLibrary &&
        activeGroups.map((group) => (
          <section key={group.view.Id} className="mt-10">
            <div className="mb-4 flex items-baseline gap-3">
              <h2 className="text-lg font-semibold text-white/85">{group.view.Name}</h2>
              <span className="text-xs text-white/35">
                {group.items.length}
                {group.total > group.items.length ? ` of ${group.total}` : ''}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-x-2.5 gap-y-6 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
              {group.items.map((item) => (
                <div key={item.Id} className="[&>div]:w-full">
                  <MediaCard item={item} />
                </div>
              ))}
            </div>
          </section>
        ))}

      {showLibrary && !groups.isLoading && found.length === 0 && (
        <p className="py-12 text-center text-white/40">
          Nothing in your libraries matched “{term}”.
          {seerrAvailable && ' Jellyseerr results are below.'}
        </p>
      )}

      {showSeerr && <RequestResults term={term} standalone={filter === 'jellyseerr'} />}
    </div>
  )
}

function Chip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean
  accent?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3.5 py-1.5 text-sm transition ${
        active
          ? 'bg-accent text-white'
          : accent
            ? 'border border-accent/45 text-accent hover:bg-accent/10'
            : 'bg-white/8 text-white/65 hover:bg-white/15'
      }`}
    >
      {children}
    </button>
  )
}
