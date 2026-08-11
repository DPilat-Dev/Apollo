import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useLocalTrailers } from '../lib/queries'
import { remoteTrailers } from '../lib/trailers'
import { displayTitle } from '../lib/format'
import { PlayIcon } from './icons'

/**
 * Trailer playback.
 *
 * A local trailer is an ordinary item on the server, so it goes to this
 * client's own player — direct play, subtitles, the lot. A remote one is a
 * YouTube URL, embedded through the no-cookie host, with a way out to the
 * original for anything that cannot be embedded.
 */
export function TrailerModal({ item, onClose }: { item: BaseItemDto; onClose: () => void }) {
  const navigate = useNavigate()
  const locals = useLocalTrailers(item.Id ?? undefined, item.LocalTrailerCount ?? 0)
  const remotes = remoteTrailers(item)
  const [playing, setPlaying] = useState<string | null>(null)

  // Escape closes, as it does everywhere else in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const localItems = locals.data ?? []
  // One embeddable trailer and nothing else: skip the list and just play it.
  const only = remotes.length === 1 && localItems.length === 0 ? remotes[0] : null
  const active = playing ?? only?.embedUrl ?? null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-4xl">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="truncate text-lg font-semibold text-white">
            {displayTitle(item)} <span className="text-white/45">— trailer</span>
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/20"
          >
            Close
          </button>
        </div>

        {active ? (
          <div className="overflow-hidden rounded-xl bg-black shadow-2xl">
            <iframe
              src={active}
              title={`${displayTitle(item)} trailer`}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
              className="aspect-video w-full"
            />
          </div>
        ) : (
          <div className="rounded-xl border border-white/10 bg-ink-soft p-3 shadow-2xl">
            {localItems.map((trailer) => (
              <button
                key={trailer.Id}
                onClick={() => trailer.Id && navigate(`/watch/${trailer.Id}`)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/8"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black">
                  <PlayIcon className="ml-0.5 size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">
                    {trailer.Name || 'Trailer'}
                  </span>
                  <span className="text-[11px] text-white/45">On your server</span>
                </span>
              </button>
            ))}

            {remotes.map((trailer) => (
              <button
                key={trailer.url}
                onClick={() => {
                  if (trailer.embedUrl) return setPlaying(trailer.embedUrl)
                  // Not embeddable — hand it to the browser rather than
                  // showing a frame that will refuse to load.
                  window.open(trailer.url, '_blank', 'noopener,noreferrer')
                }}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-white/8"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-white/30 text-white/85">
                  <PlayIcon className="ml-0.5 size-4" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-white">
                    {trailer.name}
                  </span>
                  <span className="text-[11px] text-white/45">
                    {trailer.embedUrl ? 'YouTube' : 'Opens in a new tab'}
                  </span>
                </span>
              </button>
            ))}

            {localItems.length === 0 && remotes.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-white/50">
                {locals.isLoading ? 'Looking for trailers…' : 'No trailer for this one.'}
              </p>
            )}
          </div>
        )}

        {active && (
          <p className="mt-2 text-center text-[11px] text-white/35">
            Played through youtube-nocookie.com
          </p>
        )}
      </div>
    </div>
  )
}
