import { useState } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useRefreshItem, useUpdateItem } from '../../lib/queries'
import { Modal } from './LibrariesPanel'
import { NumberInput, Section, Select, TextArea, TextInput, ToggleRow, ToggleRows } from './controls'

/** How Jellyfin orders episodes within a series. */
const DISPLAY_ORDERS = [
  { value: '', label: 'Default (aired order)' },
  { value: 'Aired', label: 'Aired order' },
  { value: 'OriginalAirDate', label: 'Original air date' },
  { value: 'Absolute', label: 'Absolute numbering' },
  { value: 'Dvd', label: 'DVD order' },
  { value: 'Digital', label: 'Digital order' },
  { value: 'StoryArc', label: 'Story arc' },
  { value: 'Production', label: 'Production order' },
  { value: 'Tv', label: 'TV order' },
  { value: 'Alternate', label: 'Alternate order' },
  { value: 'Regional', label: 'Regional order' },
  { value: 'AlternateDvd', label: 'Alternate DVD order' },
]

const list = (v?: string[] | null) => (v ?? []).join(', ')
const parseList = (v: string) =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** Dates arrive as full ISO strings but edit better as yyyy-mm-dd. */
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
const fromDateInput = (v: string) => (v ? new Date(`${v}T00:00:00Z`).toISOString() : null)

export function MetadataEditor({ item, onClose }: { item: BaseItemDto; onClose: () => void }) {
  const [draft, setDraft] = useState<BaseItemDto>(() => structuredClone(item))
  const [notice, setNotice] = useState<string | null>(null)
  const update = useUpdateItem()
  const refresh = useRefreshItem()
  const itemId = item.Id

  const set = <K extends keyof BaseItemDto>(key: K, value: BaseItemDto[K]) => {
    setNotice(null)
    setDraft({ ...draft, [key]: value })
  }

  const isSeries = item.Type === 'Series'
  const isSeason = item.Type === 'Season'
  const isEpisode = item.Type === 'Episode'
  const dirty = JSON.stringify(draft) !== JSON.stringify(item)

  const fail = (e: unknown) =>
    setNotice(e instanceof Error ? e.message : 'Those changes were not saved.')

  return (
    <Modal onClose={onClose} title={`Edit ${item.Name ?? 'item'}`}>
      {notice && (
        <p className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/75">
          {notice}
        </p>
      )}

      <Section title="Titles">
        <div className="space-y-3">
          <TextInput label="Name" value={draft.Name ?? ''} onChange={(v) => set('Name', v)} />
          <TextInput
            label="Original title"
            value={draft.OriginalTitle ?? ''}
            onChange={(v) => set('OriginalTitle', v)}
          />
          {/* ForcedSortName is the override field; SortName is derived and gets
              recomputed on the next refresh. */}
          <TextInput
            label="Sort name"
            hint={`Overrides A–Z placement. Currently sorting as “${draft.SortName ?? draft.Name ?? ''}”.`}
            value={draft.ForcedSortName ?? ''}
            onChange={(v) => set('ForcedSortName', v)}
          />
          <TextArea
            label="Overview"
            rows={5}
            value={draft.Overview ?? ''}
            onChange={(v) => set('Overview', v)}
          />
          <TextInput
            label="Tagline"
            value={draft.Taglines?.[0] ?? ''}
            onChange={(v) => set('Taglines', v ? [v] : [])}
          />
        </div>
      </Section>

      {(isSeries || isSeason || isEpisode) && (
        <Section
          title="Ordering"
          hint={
            isSeries
              ? 'Display order decides how the server numbers episodes for this series.'
              : 'Index numbers control the position within the parent.'
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {isSeries && (
              <div className="sm:col-span-2">
                <Select
                  label="Display order"
                  value={draft.DisplayOrder ?? ''}
                  options={DISPLAY_ORDERS}
                  onChange={(v) => set('DisplayOrder', v)}
                />
              </div>
            )}
            {(isSeason || isEpisode) && (
              <NumberInput
                label={isSeason ? 'Season number' : 'Episode number'}
                value={draft.IndexNumber ?? undefined}
                onChange={(v) => set('IndexNumber', v)}
              />
            )}
            {isEpisode && (
              <NumberInput
                label="Season number"
                value={draft.ParentIndexNumber ?? undefined}
                onChange={(v) => set('ParentIndexNumber', v)}
              />
            )}
            {isEpisode && (
              <NumberInput
                label="Ends at episode"
                hint="For a file holding more than one episode"
                value={draft.IndexNumberEnd ?? undefined}
                onChange={(v) => set('IndexNumberEnd', v)}
              />
            )}
          </div>
        </Section>
      )}

      <Section title="Release">
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberInput
            label="Year"
            value={draft.ProductionYear ?? undefined}
            onChange={(v) => set('ProductionYear', v)}
          />
          <div>
            <span className="mb-1 block text-xs text-white/50">Premiere date</span>
            <input
              type="date"
              value={toDateInput(draft.PremiereDate)}
              onChange={(e) => set('PremiereDate', fromDateInput(e.target.value))}
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
            />
          </div>
          <TextInput
            label="Official rating"
            hint="e.g. PG-13, TV-MA"
            value={draft.OfficialRating ?? ''}
            onChange={(v) => set('OfficialRating', v)}
          />
          <NumberInput
            label="Community rating"
            value={draft.CommunityRating ?? undefined}
            min={0}
            max={10}
            onChange={(v) => set('CommunityRating', v)}
          />
        </div>
      </Section>

      <Section title="Classification">
        <div className="space-y-3">
          <TextInput
            label="Genres"
            hint="Comma separated"
            value={list(draft.Genres)}
            onChange={(v) => set('Genres', parseList(v))}
          />
          <TextInput
            label="Tags"
            hint="Comma separated"
            value={list(draft.Tags)}
            onChange={(v) => set('Tags', parseList(v))}
          />
          <TextInput
            label="Studios"
            hint="Comma separated"
            value={list(draft.Studios?.map((s) => s.Name ?? '').filter(Boolean))}
            onChange={(v) => set('Studios', parseList(v).map((name) => ({ Name: name })))}
          />
        </div>
      </Section>

      <Section title="Availability">
        <ToggleRows>
          <ToggleRow
            label="Locked"
            hint="Stop automatic refreshes from overwriting these fields"
            checked={Boolean(draft.LockData)}
            onChange={() => set('LockData', !draft.LockData)}
          />
        </ToggleRows>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() =>
            update.mutate(
              { itemId: itemId!, item: draft },
              { onSuccess: () => setNotice('Saved.'), onError: fail },
            )
          }
          disabled={!dirty || !itemId || update.isPending}
          className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-35"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={() => setDraft(structuredClone(item))}
          disabled={!dirty}
          className="rounded-lg border border-white/20 px-5 py-2 text-sm transition hover:border-white/45 disabled:opacity-35"
        >
          Discard
        </button>
      </div>

      <Section
        title="Refresh from providers"
        hint="Re-queries metadata providers. Replacing overwrites what is here now."
      >
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() =>
              refresh.mutate(
                { itemId: itemId! },
                { onSuccess: () => setNotice('Refresh queued.'), onError: fail },
              )
            }
            disabled={!itemId || refresh.isPending}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:border-white/45 disabled:opacity-40"
          >
            Refresh missing
          </button>
          <button
            onClick={() =>
              refresh.mutate(
                { itemId: itemId!, replaceAllMetadata: true, replaceAllImages: true },
                { onSuccess: () => setNotice('Full refresh queued.'), onError: fail },
              )
            }
            disabled={!itemId || refresh.isPending}
            className="rounded-lg border border-amber-500/40 px-4 py-2 text-sm text-amber-200 transition hover:bg-amber-500/10 disabled:opacity-40"
          >
            Replace all metadata and images
          </button>
        </div>
      </Section>
    </Modal>
  )
}
