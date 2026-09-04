import { useState } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useDownloadRemoteImage, useRemoteImages } from '../../lib/queries'
import {
  ARTWORK_KINDS,
  artworkPaging,
  artworkSummary,
  artworkThumbnail,
  type ArtworkKind,
} from '../../lib/artwork'
import { Modal } from '../Modal'
import { Section, ToggleRow, ToggleRows } from './controls'

/**
 * Browsing the artwork the providers hold, and taking one.
 *
 * Every image on screen is a provider thumbnail and every page is a request
 * for one window — see artwork.ts for why. A dialog that asked for the whole
 * list at full size is not a hypothetical: a popular film has several hundred
 * backdrops, and TMDb serves the originals at two thousand pixels wide.
 */
export function ArtworkPicker({ item, onClose }: { item: BaseItemDto; onClose: () => void }) {
  const [kind, setKind] = useState<ArtworkKind>('Primary')
  const [requestedPage, setRequestedPage] = useState(0)
  const [providerName, setProviderName] = useState('')
  const [includeAllLanguages, setIncludeAllLanguages] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const query = useRemoteImages(item.Id ?? undefined, {
    type: kind,
    page: requestedPage,
    providerName: providerName || undefined,
    includeAllLanguages,
  })
  const download = useDownloadRemoteImage()

  const paging = artworkPaging(query.data?.TotalRecordCount, requestedPage)
  const images = query.data?.Images ?? []
  const providers = query.data?.Providers ?? []

  // Changing the filter has to reset the page as well as the filter. Logo has
  // a handful of candidates where Backdrop had hundreds, and a page number
  // carried across lands past the end of the shorter list.
  const refilter = (change: () => void) => {
    change()
    setRequestedPage(0)
    setNotice(null)
  }

  return (
    <Modal title={`Artwork for ${item.Name ?? 'item'}`} onClose={onClose} wide>
      {notice && (
        <p className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/75">
          {notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {ARTWORK_KINDS.map((entry) => (
          <button
            key={entry.type}
            onClick={() => refilter(() => setKind(entry.type))}
            className={`rounded-full border px-4 py-1.5 text-sm transition ${
              kind === entry.type
                ? 'border-accent bg-accent/15 text-white'
                : 'border-white/15 text-white/60 hover:border-white/40'
            }`}
          >
            {entry.label}
          </button>
        ))}

        {providers.length > 1 && (
          <select
            value={providerName}
            onChange={(e) => refilter(() => setProviderName(e.target.value))}
            className="ml-auto rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm outline-none focus:border-white/40"
          >
            <option value="">Every provider</option>
            {providers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        )}
      </div>

      <ToggleRows>
        <ToggleRow
          label="Every language"
          hint="Providers hold a poster per language, so this list gets long"
          checked={includeAllLanguages}
          onChange={() => refilter(() => setIncludeAllLanguages(!includeAllLanguages))}
        />
      </ToggleRows>

      {query.isPending && <div className="skeleton h-64 rounded-lg" />}

      {query.error && (
        <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-red-200">
          {query.error instanceof Error ? query.error.message : 'Could not reach the providers.'}
        </p>
      )}

      {!query.isPending && !query.error && images.length === 0 && (
        <p className="text-sm text-white/50">
          No provider has a {kind.toLowerCase()} image for this item.
        </p>
      )}

      {images.length > 0 && (
        <>
          <div
            className={`grid gap-3 ${
              kind === 'Primary' ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3'
            }`}
          >
            {images.map((image, index) => {
              const thumbnail = artworkThumbnail(image)
              const full = image.Url
              return (
                <button
                  key={`${image.Url}-${index}`}
                  onClick={() =>
                    item.Id &&
                    full &&
                    download.mutate(
                      { itemId: item.Id, type: kind, imageUrl: full },
                      {
                        onSuccess: () => setNotice('Applied. The page behind this has updated.'),
                        onError: (e) =>
                          setNotice(e instanceof Error ? e.message : 'That image was not saved.'),
                      },
                    )
                  }
                  disabled={!full || download.isPending}
                  className="overflow-hidden rounded-lg border border-white/10 text-left transition hover:border-white/50 disabled:opacity-40"
                >
                  <div
                    className={`bg-white/5 ${kind === 'Primary' ? 'aspect-2/3' : 'aspect-video'}`}
                  >
                    {thumbnail && (
                      <img
                        src={thumbnail}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="size-full object-contain"
                      />
                    )}
                  </div>
                  <p className="truncate px-2 py-1.5 text-[11px] text-white/45">
                    {artworkSummary(image)}
                  </p>
                </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-white/40">
              {paging.from}–{paging.to} of {query.data?.TotalRecordCount ?? 0}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setRequestedPage(paging.page - 1)}
                disabled={!paging.hasPrev}
                className="rounded-lg border border-white/20 px-4 py-1.5 text-sm transition hover:border-white/45 disabled:opacity-30"
              >
                Previous
              </button>
              <button
                onClick={() => setRequestedPage(paging.page + 1)}
                disabled={!paging.hasNext}
                className="rounded-lg border border-white/20 px-4 py-1.5 text-sm transition hover:border-white/45 disabled:opacity-30"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      <Section title="Note">
        <p className="text-xs leading-relaxed text-white/45">
          Choosing an image downloads it to the server and replaces the current one of that kind.
          Any later refresh that replaces all images will undo it — locking the item does not
          prevent that, because the server’s lock covers the text fields and not the pictures.
        </p>
      </Section>
    </Modal>
  )
}
