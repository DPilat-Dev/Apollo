import { useId, useState } from 'react'
import type { LibraryOptions, VirtualFolderInfo } from '@jellyfin/sdk/lib/generated-client/models'
import {
  useAddLibrary,
  useAddLibraryPath,
  useCountries,
  useCultures,
  useDirectoryContents,
  useRemoveLibrary,
  useRemoveLibraryPath,
  useRenameLibrary,
  useSaveLibraryOptions,
  useVirtualFolders,
} from '../../lib/queries'
import { NumberInput, Section, Select, Switch, TextInput, ToggleRow, ToggleRows } from './controls'
import { Modal } from '../Modal'

const COLLECTION_TYPES = [
  { value: 'movies', label: 'Movies' },
  { value: 'tvshows', label: 'TV Shows' },
  { value: 'music', label: 'Music' },
  { value: 'musicvideos', label: 'Music Videos' },
  { value: 'homevideos', label: 'Home Videos & Photos' },
  { value: 'boxsets', label: 'Collections' },
  { value: 'books', label: 'Books' },
  { value: 'mixed', label: 'Mixed content' },
]

/** The same key the list renders by, and the one the dialog is held open by. */
const folderKey = (f: VirtualFolderInfo) => f.ItemId ?? f.Name ?? ''

export function LibrariesPanel() {
  const folders = useVirtualFolders()
  /*
    Which library is being edited, not the record itself.

    Every mutation in the editor keys off `folder.Name`, and every one of them
    invalidates `virtualFolders` — so a held DTO was stale the moment anything
    succeeded. Rename a library and then add a folder in the same dialog, and
    the add went out under the name the server no longer knows and 404ed.
    `MiscPanels` keeps an open plugin detail this way for the same reason.

    `ItemId` and not the name, because the name is the one field a rename
    changes. Keyed on it, the dialog matched nothing for the length of the
    refetch — and a stand-in record to cover those renders only moved the fault:
    it carried the *old* name, so every mutation in the window went out under a
    name the server had stopped answering to, and a refetch that failed left the
    dialog on that record indefinitely with nothing to say why everything 404s.
    `saveOptions` already addresses the library by `ItemId` for this reason.
  */
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const editing =
    editingKey === null
      ? null
      : ((folders.data ?? []).find((f) => folderKey(f) === editingKey) ?? null)
  const [adding, setAdding] = useState(false)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Libraries</h2>
          <p className="text-sm text-white/45">{folders.data?.length ?? 0} libraries</p>
        </div>
        <button
          onClick={() => setAdding(true)}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot"
        >
          Add library
        </button>
      </div>

      {folders.isLoading && <div className="skeleton h-40 rounded-lg" />}
      {folders.error && (
        <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-red-200">
          {folders.error instanceof Error ? folders.error.message : 'Could not load libraries.'}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(folders.data ?? []).map((f) => (
          <button
            key={folderKey(f)}
            onClick={() => setEditingKey(folderKey(f))}
            className="rounded-xl border border-white/10 bg-ink-soft/60 p-4 text-left transition hover:border-white/25"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{f.Name}</p>
              <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                {f.CollectionType ?? 'mixed'}
              </span>
            </div>
            <p className="mt-2 truncate font-mono text-xs text-white/40">
              {(f.Locations ?? []).join(' · ') || 'No folders'}
            </p>
            {f.RefreshStatus && f.RefreshStatus !== 'Idle' && (
              <p className="mt-1 text-xs text-accent">
                {f.RefreshStatus} {f.RefreshProgress != null && `${Math.round(f.RefreshProgress)}%`}
              </p>
            )}
          </button>
        ))}
      </div>

      {editing && <LibraryEditor folder={editing} onClose={() => setEditingKey(null)} />}
      {adding && <AddLibraryDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

function LibraryEditor({ folder, onClose }: { folder: VirtualFolderInfo; onClose: () => void }) {
  const [options, setOptions] = useState<LibraryOptions>(folder.LibraryOptions ?? {})
  const [name, setName] = useState(folder.Name ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  /** Which folder's Remove has been pressed once, if any. */
  const [confirmPath, setConfirmPath] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [browsing, setBrowsing] = useState(false)
  const confirmId = useId()
  /*
    The name the server answers to, which is not always the one on the record.
    `virtualFolders` takes a round trip to catch up after a rename, and every
    other mutation here is addressed by name — so between the rename's answer
    and the refetch landing, the record carries a name the server has already
    forgotten. Remembering the rename closes that window without waiting for
    anything; once the list catches up the two say the same thing.
  */
  const [renamedTo, setRenamedTo] = useState<string | null>(null)
  const serverName = renamedTo ?? folder.Name ?? ''

  const saveOptions = useSaveLibraryOptions()
  const rename = useRenameLibrary()
  const remove = useRemoveLibrary()
  const addPath = useAddLibraryPath()
  const removePath = useRemoveLibraryPath()
  const cultures = useCultures()
  const countries = useCountries()

  const set = <K extends keyof LibraryOptions>(key: K, value: LibraryOptions[K]) =>
    setOptions({ ...options, [key]: value })

  const fail = (e: unknown) =>
    setNotice(e instanceof Error ? e.message : 'That change did not go through.')

  return (
    <Modal onClose={onClose} title={serverName || 'Library'}>
      {notice && (
        <p className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/75">
          {notice}
        </p>
      )}

      <Section title="Name">
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
          />
          <button
            onClick={() =>
              rename.mutate(
                { name: serverName, newName: name.trim() },
                {
                  onSuccess: () => {
                    setNotice('Renamed.')
                    setRenamedTo(name.trim())
                  },
                  onError: fail,
                },
              )
            }
            disabled={!name.trim() || name === serverName || rename.isPending}
            className="shrink-0 rounded-lg bg-white/10 px-4 text-sm transition hover:bg-white/20 disabled:opacity-35"
          >
            Rename
          </button>
        </div>
      </Section>

      <Section title="Folders">
        <div className="space-y-1.5">
          {/*
            Asking first, because this one is not the local list-editing
            "Remove" it looks like — the identical control in the add dialog
            only drops a path out of a form. Here it is a DELETE that takes
            every item under the folder out of the library, and the household's
            watch state for them with it. Named in full for the same reason:
            one of these paths is the one that holds everything.
          */}
          {(folder.Locations ?? []).map((loc) => (
            <div
              key={loc}
              className="rounded-lg border border-white/10 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/70">
                  {loc}
                </span>
                {confirmPath !== loc && (
                  <button
                    onClick={() => {
                      setNotice(null)
                      setConfirmPath(loc)
                    }}
                    // The trigger has to go dead while a DELETE is in flight
                    // too. On a slow link the confirm closes, nothing visibly
                    // happens, and a second press sent a second DELETE against
                    // a folder that may already be gone.
                    disabled={removePath.isPending}
                    className="shrink-0 text-xs text-white/40 transition hover:text-accent disabled:opacity-40"
                  >
                    Remove
                  </button>
                )}
              </div>
              {confirmPath === loc && (
                /*
                  Announced and focused, because the trigger that opened this
                  has just been unmounted — so focus fell to the top of the
                  document and a screen reader was told nothing at all. The
                  `autoFocus` also scrolls it into view, which matters inside a
                  scrolling modal where this can open below the fold.
                */
                <div
                  role="alertdialog"
                  aria-labelledby={`${confirmId}-path-title`}
                  aria-describedby={`${confirmId}-path-body`}
                  className="mt-2 border-t border-white/10 pt-2"
                >
                  <p id={`${confirmId}-path-title`} className="text-xs text-white/75">
                    Stop scanning this folder?
                  </p>
                  <p id={`${confirmId}-path-body`} className="mt-1 text-xs text-white/60">
                    Everything in it leaves the library, and the watch state for it goes too. The
                    files stay on disk.
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button
                      autoFocus
                      onClick={() =>
                        removePath.mutate(
                          { name: serverName, path: loc },
                          {
                            /*
                              Cleared here rather than before the call. Clearing
                              it first unmounted this panel in the same commit,
                              so the "Removing…" label and the guard below could
                              never be seen — and the row's own trigger came
                              back immediately, ready to send a second DELETE.
                            */
                            onSuccess: () => {
                              setNotice('Folder removed.')
                              setConfirmPath(null)
                            },
                            onError: (e) => {
                              fail(e)
                              setConfirmPath(null)
                            },
                          },
                        )
                      }
                      // A second press before the first DELETE comes back sends
                      // a second one, against a folder that may already be gone.
                      disabled={removePath.isPending}
                      className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold transition hover:bg-accent-hot disabled:opacity-50"
                    >
                      {removePath.isPending ? 'Removing…' : 'Yes, remove'}
                    </button>
                    <button
                      onClick={() => setConfirmPath(null)}
                      className="rounded-lg border border-white/20 px-3 py-1.5 text-xs transition hover:border-white/45"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {browsing ? (
            <FolderBrowser
              onCancel={() => setBrowsing(false)}
              onPick={(path) => {
                setBrowsing(false)
                addPath.mutate(
                  { name: serverName, path },
                  { onSuccess: () => setNotice('Folder added.'), onError: fail },
                )
              }}
            />
          ) : (
            <button
              onClick={() => setBrowsing(true)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs transition hover:border-white/45"
            >
              Add folder
            </button>
          )}
        </div>
      </Section>

      <Section title="Metadata">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Preferred language"
            value={options.PreferredMetadataLanguage ?? ''}
            options={[
              { value: '', label: 'Server default' },
              ...(cultures.data ?? [])
                .filter((c) => c.TwoLetterISOLanguageName)
                .map((c) => ({
                  value: c.TwoLetterISOLanguageName!,
                  label: c.DisplayName ?? c.Name ?? '',
                })),
            ]}
            onChange={(v) => set('PreferredMetadataLanguage', v)}
          />
          <Select
            label="Country"
            value={options.MetadataCountryCode ?? ''}
            options={[
              { value: '', label: 'Server default' },
              ...(countries.data ?? [])
                .filter((c) => c.TwoLetterISORegionName)
                .map((c) => ({
                  value: c.TwoLetterISORegionName!,
                  label: c.DisplayName ?? c.Name ?? '',
                })),
            ]}
            onChange={(v) => set('MetadataCountryCode', v)}
          />
          <TextInput
            label="Season zero name"
            value={options.SeasonZeroDisplayName ?? ''}
            placeholder="Specials"
            onChange={(v) => set('SeasonZeroDisplayName', v)}
          />
          <NumberInput
            label="Auto refresh (days)"
            hint="0 disables automatic refreshes"
            value={options.AutomaticRefreshIntervalDays ?? 0}
            min={0}
            onChange={(v) => set('AutomaticRefreshIntervalDays', v)}
          />
        </div>
      </Section>

      <Section title="Scanning">
        <ToggleRows>
          <ToggleRow
            label="Enabled"
            hint="Include this library in scans and on the home page"
            checked={options.Enabled !== false}
            onChange={() => set('Enabled', !(options.Enabled !== false))}
          />
          <ToggleRow
            label="Real-time monitoring"
            hint="Pick up file changes as they happen"
            checked={Boolean(options.EnableRealtimeMonitor)}
            onChange={() => set('EnableRealtimeMonitor', !options.EnableRealtimeMonitor)}
          />
          <ToggleRow
            label="Internet metadata providers"
            checked={Boolean(options.EnableInternetProviders)}
            onChange={() => set('EnableInternetProviders', !options.EnableInternetProviders)}
          />
          <ToggleRow
            label="Save metadata alongside media"
            checked={Boolean(options.SaveLocalMetadata)}
            onChange={() => set('SaveLocalMetadata', !options.SaveLocalMetadata)}
          />
          <ToggleRow
            label="Use embedded titles"
            checked={Boolean(options.EnableEmbeddedTitles)}
            onChange={() => set('EnableEmbeddedTitles', !options.EnableEmbeddedTitles)}
          />
          <ToggleRow
            label="Automatic series grouping"
            checked={Boolean(options.EnableAutomaticSeriesGrouping)}
            onChange={() =>
              set('EnableAutomaticSeriesGrouping', !options.EnableAutomaticSeriesGrouping)
            }
          />
        </ToggleRows>
      </Section>

      <Section title="Images">
        <ToggleRows>
          <ToggleRow
            label="Chapter image extraction"
            checked={Boolean(options.EnableChapterImageExtraction)}
            onChange={() =>
              set('EnableChapterImageExtraction', !options.EnableChapterImageExtraction)
            }
          />
          <ToggleRow
            label="Extract chapter images during scan"
            hint="Slower scans, but images are ready sooner"
            checked={Boolean(options.ExtractChapterImagesDuringLibraryScan)}
            onChange={() =>
              set(
                'ExtractChapterImagesDuringLibraryScan',
                !options.ExtractChapterImagesDuringLibraryScan,
              )
            }
          />
          <ToggleRow
            label="Trickplay images"
            hint="Thumbnails shown when scrubbing the player"
            checked={Boolean(options.EnableTrickplayImageExtraction)}
            onChange={() =>
              set('EnableTrickplayImageExtraction', !options.EnableTrickplayImageExtraction)
            }
          />
          <ToggleRow
            label="Extract trickplay during scan"
            checked={Boolean(options.ExtractTrickplayImagesDuringLibraryScan)}
            onChange={() =>
              set(
                'ExtractTrickplayImagesDuringLibraryScan',
                !options.ExtractTrickplayImagesDuringLibraryScan,
              )
            }
          />
        </ToggleRows>
      </Section>

      <div className="flex items-center gap-3">
        <button
          onClick={() =>
            saveOptions.mutate(
              { id: folder.ItemId!, libraryOptions: options },
              { onSuccess: () => setNotice('Settings saved.'), onError: fail },
            )
          }
          disabled={saveOptions.isPending}
          className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
        >
          {saveOptions.isPending ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      <Section title="Danger zone">
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="rounded-lg border border-accent/40 px-4 py-2 text-sm text-accent transition hover:bg-accent/10"
          >
            Remove this library
          </button>
        ) : (
          <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
            <p className="text-sm text-white/85">
              Remove <strong>{serverName}</strong> from Jellyfin?
            </p>
            <p className="mt-1 text-xs text-white/50">
              The media files stay on disk. Watch state and metadata for these items are lost.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                onClick={() =>
                  remove.mutate({ name: serverName }, { onSuccess: onClose, onError: fail })
                }
                disabled={remove.isPending}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-50"
              >
                {remove.isPending ? 'Removing…' : 'Yes, remove'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:border-white/45"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>
    </Modal>
  )
}

function AddLibraryDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('movies')
  const [paths, setPaths] = useState<string[]>([])
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = useAddLibrary()

  return (
    <Modal onClose={onClose} title="Add a library">
      <Section title="Basics">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Name" value={name} onChange={setName} placeholder="4K Movies" />
          <Select label="Content type" value={type} options={COLLECTION_TYPES} onChange={setType} />
        </div>
      </Section>

      <Section title="Folders">
        <div className="space-y-1.5">
          {paths.map((p) => (
            <div key={p} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/70">{p}</span>
              <button
                onClick={() => setPaths(paths.filter((x) => x !== p))}
                className="shrink-0 text-xs text-white/40 transition hover:text-accent"
              >
                Remove
              </button>
            </div>
          ))}
          {browsing ? (
            <FolderBrowser
              onCancel={() => setBrowsing(false)}
              onPick={(p) => {
                setBrowsing(false)
                if (!paths.includes(p)) setPaths([...paths, p])
              }}
            />
          ) : (
            <button
              onClick={() => setBrowsing(true)}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-xs transition hover:border-white/45"
            >
              Browse for a folder
            </button>
          )}
        </div>
      </Section>

      {error && <p className="text-xs text-red-300">{error}</p>}

      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:border-white/45"
        >
          Cancel
        </button>
        <button
          onClick={() =>
            add.mutate(
              { name: name.trim(), collectionType: type === 'mixed' ? undefined : type, paths },
              {
                onSuccess: onClose,
                onError: (e) =>
                  setError(e instanceof Error ? e.message : 'Could not create that library.'),
              },
            )
          }
          disabled={!name.trim() || paths.length === 0 || add.isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
        >
          {add.isPending ? 'Creating…' : 'Create library'}
        </button>
      </div>
    </Modal>
  )
}

/** Walks the server's filesystem — the browser has no access to those paths. */
function FolderBrowser({
  onPick,
  onCancel,
}: {
  onPick: (path: string) => void
  onCancel: () => void
}) {
  const [path, setPath] = useState<string | undefined>(undefined)
  const contents = useDirectoryContents(path)

  const parent = path?.replace(/[/\\][^/\\]+$/, '') || undefined

  return (
    <div className="rounded-lg border border-white/15 bg-black/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={() => setPath(parent)}
          disabled={!path}
          className="rounded border border-white/20 px-2 py-1 text-xs transition hover:border-white/45 disabled:opacity-30"
        >
          Up
        </button>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-white/55">
          {path ?? 'Drives'}
        </span>
        <button onClick={onCancel} className="text-xs text-white/40 hover:text-white">
          Cancel
        </button>
      </div>

      <div className="max-h-52 overflow-y-auto rounded border border-white/10">
        {contents.isLoading && <p className="px-3 py-2 text-xs text-white/35">Loading…</p>}
        {contents.error && (
          <p className="px-3 py-2 text-xs text-red-300">
            {contents.error instanceof Error ? contents.error.message : 'Could not read that path.'}
          </p>
        )}
        {(contents.data ?? []).map((entry) => (
          <button
            key={entry.Path}
            onClick={() => setPath(entry.Path ?? undefined)}
            className="block w-full truncate px-3 py-1.5 text-left font-mono text-xs text-white/70 transition hover:bg-white/8"
          >
            {entry.Name || entry.Path}
          </button>
        ))}
        {!contents.isLoading && (contents.data ?? []).length === 0 && (
          <p className="px-3 py-2 text-xs text-white/35">No subfolders here.</p>
        )}
      </div>

      <button
        onClick={() => path && onPick(path)}
        disabled={!path}
        className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold transition hover:bg-accent-hot disabled:opacity-35"
      >
        Use this folder
      </button>
    </div>
  )
}

export { Switch }
