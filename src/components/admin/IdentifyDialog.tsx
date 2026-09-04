import { useState } from 'react'
import type { BaseItemDto, RemoteSearchResult } from '@jellyfin/sdk/lib/generated-client/models'
import { useApplyRemoteSearch, useRemoteSearch } from '../../lib/queries'
import {
  applyWarnings,
  identifyKind,
  parseProviderId,
  remoteSearchQuery,
  replaceArtworkByDefault,
} from '../../lib/identify'
import { Modal } from '../Modal'
import { Section, ToggleRow, ToggleRows } from './controls'

const inputClass =
  'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none transition placeholder:text-white/25 focus:border-white/40'

const year = (result: RemoteSearchResult) =>
  result.ProductionYear ?? (result.PremiereDate ? Number(result.PremiereDate.slice(0, 4)) : null)

/**
 * Re-matching an item against the metadata providers.
 *
 * Posters, not a list of titles. The case this exists for is two shows sharing
 * a name, and a column of identical strings tells an admin nothing about which
 * one is theirs — the picture is the whole reason the dialog is worth opening.
 */
export function IdentifyDialog({
  item,
  onClose,
  onApplied,
}: {
  item: BaseItemDto
  onClose: () => void
  onApplied: () => void
}) {
  const [search, setSearch] = useState(item.Name ?? '')
  const [searchYear, setSearchYear] = useState(item.ProductionYear?.toString() ?? '')
  const [includeDisabledProviders, setIncludeDisabled] = useState(false)
  const [results, setResults] = useState<RemoteSearchResult[] | null>(null)
  const [chosen, setChosen] = useState<RemoteSearchResult | null>(null)
  const [replaceAllImages, setReplaceAllImages] = useState(() => replaceArtworkByDefault(item))
  const [notice, setNotice] = useState<string | null>(null)

  const lookup = useRemoteSearch()
  const apply = useApplyRemoteSearch()

  const kind = identifyKind(item.Type)
  const query = item.Id
    ? remoteSearchQuery(item.Id, {
        search,
        year: Number(searchYear) || undefined,
        includeDisabledProviders,
      })
    : null
  const byId = parseProviderId(search)

  const fail = (e: unknown) =>
    setNotice(e instanceof Error ? e.message : 'The providers could not be reached.')

  const runSearch = () => {
    if (!kind || !query) return
    setNotice(null)
    setChosen(null)
    lookup.mutate(
      { kind, query },
      { onSuccess: (found) => setResults(found), onError: fail },
    )
  }

  return (
    <Modal title={`Identify ${item.Name ?? 'item'}`} onClose={onClose} wide>
      {notice && (
        <p className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/75">
          {notice}
        </p>
      )}

      <Section
        title="Search the providers"
        hint="A title, or paste a TMDb, TVDb or IMDb id — or the address of the provider’s page."
      >
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            runSearch()
          }}
        >
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs text-white/50">Title or provider id</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Breaking Bad"
              className={inputClass}
            />
          </label>
          <label className="w-28">
            <span className="mb-1 block text-xs text-white/50">Year</span>
            <input
              type="number"
              value={searchYear}
              onChange={(e) => setSearchYear(e.target.value)}
              disabled={Boolean(byId)}
              className={`${inputClass} tabular-nums disabled:opacity-35`}
            />
          </label>
          <button
            type="submit"
            disabled={!query || lookup.isPending}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-35"
          >
            {lookup.isPending ? 'Searching…' : 'Search'}
          </button>
        </form>

        {byId && (
          <p className="mt-2 text-xs text-white/45">
            Searching {byId.provider} for <span className="font-mono">{byId.id}</span>. The year is
            ignored — an id already names one title.
          </p>
        )}

        <div className="mt-3">
          <ToggleRows>
            <ToggleRow
              label="Include disabled providers"
              hint="Ask providers this library has switched off"
              checked={includeDisabledProviders}
              onChange={() => setIncludeDisabled(!includeDisabledProviders)}
            />
          </ToggleRows>
        </div>
      </Section>

      {results && results.length === 0 && (
        <p className="text-sm text-white/50">
          No provider had a match. Try the other title it is released under, or paste an id.
        </p>
      )}

      {results && results.length > 0 && (
        <Section title={`${results.length} match${results.length === 1 ? '' : 'es'}`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            {results.map((result, index) => (
              <button
                key={`${result.SearchProviderName}-${index}`}
                onClick={() => {
                  setChosen(result)
                  setNotice(null)
                }}
                className={`overflow-hidden rounded-lg border text-left transition ${
                  chosen === result
                    ? 'border-accent bg-accent/10'
                    : 'border-white/10 hover:border-white/40'
                }`}
              >
                <div className="aspect-2/3 bg-white/5">
                  {result.ImageUrl && (
                    <img
                      src={result.ImageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      referrerPolicy="no-referrer"
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <div className="p-2">
                  <p className="truncate text-xs font-medium">{result.Name}</p>
                  <p className="truncate text-[11px] text-white/45">
                    {[year(result), result.SearchProviderName].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}

      {chosen && (
        <Section title={`Apply “${chosen.Name ?? 'this match'}”`}>
          {chosen.Overview && (
            <p className="mb-3 line-clamp-4 text-xs leading-relaxed text-white/55">
              {chosen.Overview}
            </p>
          )}

          <ToggleRows>
            <ToggleRow
              label="Replace artwork too"
              hint="Off keeps the posters this item already has"
              checked={replaceAllImages}
              onChange={() => setReplaceAllImages(!replaceAllImages)}
            />
          </ToggleRows>

          {/*
            Said before the button is pressed rather than after. Apply is the
            one call here with nothing to undo — the server refetches every
            field from the provider and drops what was there.
          */}
          <ul className="mt-3 space-y-2">
            {applyWarnings(item, { replaceAllImages }).map((warning) => (
              <li
                key={warning.code}
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-100/85"
              >
                {warning.text}
              </li>
            ))}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              onClick={() =>
                item.Id &&
                apply.mutate(
                  { itemId: item.Id, result: chosen, replaceAllImages },
                  { onSuccess: onApplied, onError: fail },
                )
              }
              disabled={!item.Id || apply.isPending}
              className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-35"
            >
              {apply.isPending ? 'Applying…' : 'Apply this match'}
            </button>
            <button
              onClick={() => setChosen(null)}
              className="rounded-lg border border-white/20 px-5 py-2 text-sm transition hover:border-white/45"
            >
              Cancel
            </button>
          </div>
        </Section>
      )}
    </Modal>
  )
}
