import { useEffect, useMemo, useState } from 'react'
import {
  useActivityLog,
  useApiKeys,
  useBranding,
  useCreateApiKey,
  useInstallPackage,
  usePackages,
  usePlugins,
  useRepositories,
  useRevokeApiKey,
  useSaveRepositories,
  usePluginConfiguration,
  useSavePluginConfiguration,
  useSetPluginEnabled,
  useUninstallPlugin,
} from '../../lib/queries'
import {
  applyPluginConfigEdits,
  configDraft,
  configEdited,
  pluginConfigForm,
  pluginConfigPlan,
  pluginRows,
  pluginSummaryLine,
  pluginToggle,
  redactSecrets,
  secretEdit,
  secretInputValue,
  type ConfigDraft,
  type PluginConfigField,
  type PluginRow,
  type PluginStatusTone,
} from '../../lib/plugins'
import {
  ConfigPanel,
  LooseNumberInput,
  Section,
  SecretInput,
  Switch,
  TextArea,
  TextInput,
  ToggleRow,
  ToggleRows,
} from './controls'

// ------------------------------------------------------------------ branding

export function BrandingPanel() {
  const { query, save } = useBranding()
  return (
    <ConfigPanel query={query} save={save} savedMessage="Branding saved. Reload to see it.">
      {(draft, set) => (
        <>
          <Section
            title="Login page"
            hint="The disclaimer appears under the sign-in form on this client and the official one."
          >
            <TextArea
              label="Login disclaimer"
              value={draft.LoginDisclaimer ?? ''}
              placeholder="Household server — be nice to the transcoder."
              onChange={(v) => set('LoginDisclaimer', v)}
            />
          </Section>

          <Section
            title="Custom CSS"
            hint="Injected into the page. Apollo applies this on every screen, not only sign-in."
          >
            <TextArea
              label="CSS"
              rows={10}
              mono
              value={draft.CustomCss ?? ''}
              placeholder={'/* e.g. */\n:root { --color-accent: #7c3aed; }'}
              onChange={(v) => set('CustomCss', v)}
            />
          </Section>

          <Section title="Splash screen">
            <ToggleRows>
              <ToggleRow
                label="Generated splash screen"
                hint="Let the server build a splash image from your library art"
                checked={Boolean(draft.SplashscreenEnabled)}
                onChange={() => set('SplashscreenEnabled', !draft.SplashscreenEnabled)}
              />
            </ToggleRows>
          </Section>
        </>
      )}
    </ConfigPanel>
  )
}

// ------------------------------------------------------------------- plugins

const PLUGIN_TABS = ['Installed', 'Catalogue', 'Repositories'] as const
type PluginTab = (typeof PLUGIN_TABS)[number]

export function PluginsPanel() {
  const [tab, setTab] = useState<PluginTab>('Installed')
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-1.5">
        {PLUGIN_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg px-3.5 py-1.5 text-sm transition ${
              tab === t ? 'bg-accent text-white' : 'bg-white/8 text-white/60 hover:bg-white/15'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Installed' && <InstalledPlugins />}
      {tab === 'Catalogue' && <PluginCatalogue />}
      {tab === 'Repositories' && <RepositoriesEditor />}
    </div>
  )
}

/**
 * The installed list, and the detail behind each row.
 *
 * A plugin used to be a name, a version and an uninstall button. Two things
 * were missing: what the status means — seven of the twelve plugins on the
 * server this was built against are installed and not running — and the
 * settings, which until now meant leaving Apollo for Jellyfin's own dashboard.
 */
function InstalledPlugins() {
  const plugins = usePlugins()
  const [openKey, setOpenKey] = useState<string | null>(null)

  const rows = pluginRows(plugins.data ?? [])
  // Looked up by key on every render rather than held in state, so an open
  // detail follows a refetch instead of showing a row as it was before it was
  // enabled, disabled or removed.
  const open = rows.find((row) => row.key === openKey)

  if (open) return <PluginDetail row={open} onBack={() => setOpenKey(null)} />

  return (
    <div>
      <p className="mb-4 text-sm text-white/45">
        {plugins.isLoading ? 'Reading the plugin list…' : pluginSummaryLine(rows)}
      </p>

      {plugins.isLoading && <div className="skeleton h-32 rounded-lg" />}
      {!plugins.isLoading && rows.length === 0 && (
        <p className="py-12 text-center text-sm text-white/35">No plugins installed.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <button
            key={row.key}
            onClick={() => setOpenKey(row.key)}
            className="rounded-xl border border-white/10 bg-ink-soft/60 p-4 text-left transition hover:border-white/25"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{row.name}</p>
                <p className="text-xs text-white/40">
                  {row.version ? `v${row.version}` : 'No version'}
                </p>
              </div>
              <StatusPill row={row} />
            </div>
            {row.description && (
              <p className="mt-2 line-clamp-2 text-xs text-white/50">{row.description}</p>
            )}
            {/* Said on the card, not only inside the detail. A plugin that is
                installed and doing nothing is the thing somebody came here to
                find out, and it should not take a click. */}
            {!row.running && <p className="mt-2 text-xs text-amber-200/70">{row.statusHint}</p>}
          </button>
        ))}
      </div>
    </div>
  )
}

const STATUS_TONE: Record<PluginStatusTone, string> = {
  running: 'border-emerald-500/40 text-emerald-300',
  pending: 'border-amber-500/40 text-amber-300',
  stopped: 'border-red-500/40 text-red-300',
}

function StatusPill({ row }: { row: PluginRow }) {
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_TONE[row.statusTone]}`}
    >
      {row.statusLabel}
    </span>
  )
}

function PluginDetail({ row, onBack }: { row: PluginRow; onBack: () => void }) {
  const uninstall = useUninstallPlugin()
  const setEnabled = useSetPluginEnabled()
  const [confirming, setConfirming] = useState(false)
  const offer = pluginToggle(row)

  return (
    <div className="max-w-3xl space-y-6">
      <button onClick={onBack} className="text-sm text-white/50 transition hover:text-white">
        ← All plugins
      </button>

      <header>
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-xl font-semibold">{row.name}</h2>
          <StatusPill row={row} />
        </div>
        <p className="mt-1 font-mono text-xs text-white/35">
          {row.version ? `v${row.version}` : 'no version reported'} · {row.id}
        </p>
        {row.description && <p className="mt-3 text-sm text-white/60">{row.description}</p>}
        {/* In full, rather than as a word from the server's vocabulary.
            "NotSupported" on a badge tells a reader nothing about why the
            plugin they installed does nothing. */}
        <p className={`mt-3 text-sm ${row.running ? 'text-white/50' : 'text-amber-200/80'}`}>
          {row.statusHint}
        </p>
      </header>

      {(offer || row.canUninstall) && (
        <div className="flex flex-wrap items-center gap-2">
          {offer && row.version && (
            <button
              onClick={() =>
                setEnabled.mutate({
                  pluginId: row.id,
                  version: row.version ?? '',
                  enable: offer.enable,
                })
              }
              disabled={setEnabled.isPending}
              title={offer.hint}
              className="rounded border border-white/20 px-3 py-1.5 text-xs transition hover:border-white/50 disabled:opacity-40"
            >
              {offer.label}
            </button>
          )}
          {row.canUninstall &&
            (confirming ? (
              <>
                <button
                  onClick={() => uninstall.mutate(row.id, { onSuccess: onBack })}
                  disabled={uninstall.isPending}
                  className="rounded bg-accent px-3 py-1.5 text-xs font-semibold transition hover:bg-accent-hot disabled:opacity-50"
                >
                  Confirm removal
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="text-xs text-white/45 transition hover:text-white"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                className="rounded border border-white/20 px-3 py-1.5 text-xs transition hover:border-accent hover:text-accent"
              >
                Uninstall
              </button>
            ))}
          {setEnabled.isPending && <span className="text-xs text-white/45">Working…</span>}
          {setEnabled.isError && (
            <span className="text-xs text-red-300">The server refused that.</span>
          )}
          <span className="text-xs text-white/35">Both take effect after a server restart.</span>
        </div>
      )}

      <PluginConfiguration row={row} />
    </div>
  )
}

/**
 * A plugin's settings, drawn from the shape of its own JSON.
 *
 * Nothing is decided here. Which fields exist, which of them are credentials,
 * which cannot be edited safely, whether to ask the server at all and what to
 * send back are all in `src/lib/plugins.ts`, where they are tested without a
 * browser. What is left in this file is markup.
 */
function PluginConfiguration({ row }: { row: PluginRow }) {
  const plan = pluginConfigPlan(row)
  const query = usePluginConfiguration(row)
  const save = useSavePluginConfiguration()

  const form = useMemo(() => pluginConfigForm(query.data), [query.data])
  const [draft, setDraft] = useState<ConfigDraft>({})
  const [syncedFrom, setSyncedFrom] = useState<unknown>(undefined)
  const [notice, setNotice] = useState<string | null>(null)

  // Rebuilt whenever the server copy changes underneath — after a save, or
  // after a refetch — so edits made against an older document are never
  // written back over a newer one.
  useEffect(() => {
    if (query.data !== syncedFrom) {
      setSyncedFrom(query.data)
      setDraft(configDraft(form))
      setNotice(null)
    }
  }, [query.data, syncedFrom, form])

  const set = (key: string, value: boolean | number | string) => {
    setNotice(null)
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const dirty = configEdited(form, draft)

  return (
    <Section title="Settings">
      {!plan.fetch && <p className="text-sm text-white/50">{plan.note}</p>}

      {plan.fetch && query.isLoading && <div className="skeleton h-32 rounded-lg" />}

      {plan.fetch && query.error && (
        <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-red-200">
          Could not read this plugin&rsquo;s settings.
        </p>
      )}

      {plan.fetch && !query.isLoading && !query.error && (
        <>
          {/* A running plugin can still have no configuration at all — several
              on this server have none — and the 404 that says so is not an
              error worth drawing as one. */}
          {form.kind === 'none' && (
            <p className="text-sm text-white/50">This plugin has no settings.</p>
          )}
          {form.kind === 'empty' && (
            <p className="text-sm text-white/50">
              The server holds a settings document for this plugin with nothing in it.
            </p>
          )}

          {form.fields.length > 0 && (
            <div className="space-y-4">
              {form.fields.map((field) => (
                <ConfigField
                  key={field.key}
                  field={field}
                  value={draft[field.key] ?? field.value}
                  onChange={(value) => set(field.key, value)}
                />
              ))}
            </div>
          )}

          {form.readOnly.length > 0 && (
            <div className="mt-4 space-y-3">
              {form.readOnly.map((entry) => (
                <div key={entry.key} className="rounded-lg border border-white/10 p-3">
                  <p className="text-xs text-white/60">{entry.label}</p>
                  <p className="mt-1 text-xs text-white/35">{entry.reason}</p>
                  <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/30 p-2 font-mono text-[11px] text-white/55">
                    {entry.preview}
                  </pre>
                </div>
              ))}
            </div>
          )}

          {notice && <p className="mt-4 text-sm text-white/70">{notice}</p>}

          {form.fields.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={() =>
                  save.mutate(
                    // The whole document, never the fields that happened to be
                    // drawn: this endpoint replaces what is stored.
                    { pluginId: row.id, config: applyPluginConfigEdits(query.data, draft) },
                    {
                      onSuccess: () => setNotice('Saved.'),
                      onError: (error) =>
                        setNotice(
                          // Whatever the server said back, with any credential
                          // of this plugin's taken out of it again.
                          redactSecrets(
                            error instanceof Error ? error.message : 'Could not save.',
                            query.data,
                          ),
                        ),
                    },
                  )
                }
                disabled={!dirty || save.isPending}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-35"
              >
                {save.isPending ? 'Saving…' : 'Save settings'}
              </button>
              <button
                onClick={() => {
                  setDraft(configDraft(form))
                  setNotice(null)
                }}
                disabled={!dirty}
                className="rounded-lg border border-white/20 px-5 py-2 text-sm transition hover:border-white/45 disabled:opacity-35"
              >
                Discard
              </button>
              {dirty && <span className="text-xs text-white/40">Unsaved changes</span>}
            </div>
          )}
        </>
      )}
    </Section>
  )
}

function ConfigField({
  field,
  value,
  onChange,
}: {
  field: PluginConfigField
  value: boolean | number | string
  onChange: (value: boolean | number | string) => void
}) {
  // The plugin's own key, kept beside the label: it is what the plugin's
  // documentation calls the setting, and a humanised label is not.
  const hint = field.key === field.label ? undefined : field.key

  if (field.kind === 'boolean') {
    return (
      <ToggleRows>
        <ToggleRow
          label={field.label}
          hint={hint}
          checked={Boolean(value)}
          onChange={() => onChange(!value)}
        />
      </ToggleRows>
    )
  }
  if (field.kind === 'number') {
    return (
      <LooseNumberInput label={field.label} hint={hint} value={String(value)} onChange={onChange} />
    )
  }
  if (field.kind === 'secret') {
    return (
      <SecretInput
        label={field.label}
        hint={
          field.masked
            ? 'A value is stored and is not shown here. Leave this blank to keep it.'
            : `${hint ? `${hint} · ` : ''}Nothing is stored yet.`
        }
        value={secretInputValue(value)}
        onChange={(typed) => onChange(secretEdit(typed))}
      />
    )
  }
  return <TextInput label={field.label} hint={hint} value={String(value)} onChange={onChange} />
}

function PluginCatalogue() {
  const packages = usePackages()
  const installed = usePlugins()
  const install = useInstallPackage()
  const [filter, setFilter] = useState('')
  const [category, setCategory] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  // Match on guid — a package and its installed plugin share it, while names
  // can differ between the catalogue entry and the assembly.
  const installedGuids = new Set(
    (installed.data ?? []).map((p) => p.Id?.replace(/-/g, '').toLowerCase()).filter(Boolean),
  )

  const categories = [...new Set((packages.data ?? []).map((p) => p.category).filter(Boolean))].sort()

  const needle = filter.trim().toLowerCase()
  const visible = (packages.data ?? []).filter((p) => {
    if (category && p.category !== category) return false
    if (!needle) return true
    return `${p.name} ${p.description} ${p.owner}`.toLowerCase().includes(needle)
  })

  return (
    <div>
      <p className="mb-3 text-sm text-white/45">
        Everything offered by your enabled repositories. Installing downloads the plugin; it
        loads on the next server restart.
      </p>

      {notice && (
        <p className="mb-4 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/75">
          {notice}
        </p>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search the catalogue…"
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/40"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border border-white/15 bg-ink-soft px-3 py-2 text-sm outline-none"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {packages.isLoading && <div className="skeleton h-48 rounded-lg" />}
      {packages.error && (
        <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-red-200">
          {packages.error instanceof Error ? packages.error.message : 'Could not load the catalogue.'}
        </p>
      )}
      {!packages.isLoading && !packages.error && visible.length === 0 && (
        <p className="py-12 text-center text-sm text-white/35">
          {(packages.data ?? []).length === 0
            ? 'No packages available — check that a repository is enabled.'
            : 'Nothing matches that search.'}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((pkg) => {
          const latest = pkg.versions?.[0]
          const isInstalled = installedGuids.has(pkg.guid?.replace(/-/g, '').toLowerCase() ?? '')
          return (
            <div key={pkg.guid ?? pkg.name} className="rounded-xl border border-white/10 bg-ink-soft/60 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{pkg.name}</p>
                  <p className="text-xs text-white/40">
                    {pkg.owner}
                    {latest?.version ? ` · v${latest.version}` : ''}
                  </p>
                </div>
                {pkg.category && (
                  <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/45">
                    {pkg.category}
                  </span>
                )}
              </div>

              {pkg.description && (
                <p className="mt-2 line-clamp-2 text-xs text-white/50">{pkg.description}</p>
              )}

              <div className="mt-3">
                {isInstalled ? (
                  <span className="text-xs text-emerald-300">Installed</span>
                ) : (
                  <button
                    onClick={() =>
                      install.mutate(
                        {
                          name: pkg.name ?? '',
                          version: latest?.version ?? undefined,
                          repositoryUrl: latest?.repositoryUrl ?? undefined,
                          assemblyGuid: pkg.guid ?? undefined,
                        },
                        {
                          onSuccess: () =>
                            setNotice(
                              `${pkg.name} is downloading. Restart Jellyfin to finish installing it.`,
                            ),
                          onError: (e) =>
                            setNotice(
                              e instanceof Error ? e.message : `Could not install ${pkg.name}.`,
                            ),
                        },
                      )
                    }
                    disabled={install.isPending || !pkg.name}
                    className="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold transition hover:bg-accent-hot disabled:opacity-40"
                  >
                    {install.isPending ? 'Working…' : 'Install'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function RepositoriesEditor() {
  const repositories = useRepositories()
  const save = useSaveRepositories()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const repos = repositories.data ?? []
  const commit = (next: typeof repos, message: string) =>
    save.mutate(next, {
      onSuccess: () => setNotice(message),
      onError: (e) => setNotice(e instanceof Error ? e.message : 'Could not save repositories.'),
    })

  return (
    <div className="max-w-2xl">
      <p className="mb-4 text-sm text-white/45">
        Where the catalogue comes from. Only add repositories you trust — a plugin runs with full
        access to the server.
      </p>

      {notice && (
        <p className="mb-4 rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/75">
          {notice}
        </p>
      )}

      {repositories.isLoading && <div className="skeleton h-24 rounded-lg" />}

      <div className="divide-y divide-white/8 rounded-xl border border-white/10">
        {repos.map((repo, index) => (
          <div key={repo.Url ?? index} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{repo.Name}</p>
              <p className="truncate font-mono text-xs text-white/40">{repo.Url}</p>
            </div>
            <Switch
              label={`${repo.Name} enabled`}
              checked={repo.Enabled !== false}
              onChange={() =>
                commit(
                  repos.map((r, i) => (i === index ? { ...r, Enabled: !(r.Enabled !== false) } : r)),
                  'Repositories updated.',
                )
              }
            />
            <button
              onClick={() =>
                commit(repos.filter((_, i) => i !== index), `Removed ${repo.Name}.`)
              }
              className="shrink-0 rounded border border-white/20 px-3 py-1 text-xs transition hover:border-accent hover:text-accent"
            >
              Remove
            </button>
          </div>
        ))}
        {!repositories.isLoading && repos.length === 0 && (
          <p className="px-4 py-6 text-center text-sm text-white/35">No repositories configured.</p>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/40"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…/manifest.json"
          className="min-w-0 flex-[2] rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/40"
        />
        <button
          onClick={() => {
            commit([...repos, { Name: name.trim(), Url: url.trim(), Enabled: true }], 'Repository added.')
            setName('')
            setUrl('')
          }}
          disabled={!name.trim() || !url.trim() || save.isPending}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ api keys

export function ApiKeysPanel() {
  const keys = useApiKeys()
  const create = useCreateApiKey()
  const revoke = useRevokeApiKey()
  const [appName, setAppName] = useState('')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<string | null>(null)

  return (
    <div className="max-w-3xl">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">API keys</h2>
        <p className="text-sm text-white/45">
          Keys grant full server access. Revoke anything you do not recognise.
        </p>
      </div>

      <div className="mb-5 flex gap-2">
        <input
          value={appName}
          onChange={(e) => setAppName(e.target.value)}
          placeholder="App name, e.g. Jellyseerr"
          className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/40"
        />
        <button
          onClick={() =>
            create.mutate({ app: appName.trim() }, { onSuccess: () => setAppName('') })
          }
          disabled={!appName.trim() || create.isPending}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
        >
          {create.isPending ? 'Creating…' : 'Create key'}
        </button>
      </div>

      {keys.isLoading && <div className="skeleton h-32 rounded-lg" />}
      {!keys.isLoading && (keys.data ?? []).length === 0 && (
        <p className="py-12 text-center text-sm text-white/35">No API keys yet.</p>
      )}

      <div className="divide-y divide-white/8 rounded-xl border border-white/10">
        {(keys.data ?? []).map((k) => (
          <div key={k.AccessToken} className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{k.AppName || 'Unnamed app'}</p>
                <p className="text-xs text-white/40">
                  {k.DateCreated ? `Created ${new Date(k.DateCreated).toLocaleDateString()}` : ''}
                  {k.UserName ? ` · ${k.UserName}` : ''}
                </p>
              </div>
              <button
                onClick={() =>
                  setRevealed(revealed === k.AccessToken ? null : (k.AccessToken ?? null))
                }
                className="shrink-0 text-xs text-white/45 underline underline-offset-4 hover:text-white"
              >
                {revealed === k.AccessToken ? 'Hide' : 'Show key'}
              </button>
              {confirming === k.AccessToken ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() =>
                      k.AccessToken &&
                      revoke.mutate(
                        { key: k.AccessToken },
                        { onSettled: () => setConfirming(null) },
                      )
                    }
                    className="rounded bg-accent px-3 py-1 text-xs font-semibold transition hover:bg-accent-hot"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setConfirming(null)}
                    className="text-xs text-white/45 hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(k.AccessToken ?? null)}
                  className="shrink-0 rounded border border-white/20 px-3 py-1 text-xs transition hover:border-accent hover:text-accent"
                >
                  Revoke
                </button>
              )}
            </div>
            {revealed === k.AccessToken && (
              <p className="mt-2 select-all break-all rounded bg-black/50 px-3 py-2 font-mono text-xs text-white/70">
                {k.AccessToken}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ activity

const FILTERS = ['All', 'User', 'System'] as const
type Filter = (typeof FILTERS)[number]

export function ActivityPanel() {
  const [filter, setFilter] = useState<Filter>('All')
  const [limit, setLimit] = useState(50)
  const activity = useActivityLog(limit)

  // Entries carrying a UserId came from someone; the rest are the server itself.
  const entries = (activity.data ?? []).filter((e) => {
    if (filter === 'User') return Boolean(e.UserId && e.UserId !== '00000000-0000-0000-0000-000000000000')
    if (filter === 'System') return !e.UserId || e.UserId === '00000000-0000-0000-0000-000000000000'
    return true
  })

  return (
    <div className="max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Activity</h2>
          <p className="text-sm text-white/45">{entries.length} entries shown</p>
        </div>
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-lg px-3.5 py-1.5 text-sm transition ${
                filter === f ? 'bg-accent text-white' : 'bg-white/8 text-white/60 hover:bg-white/15'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {activity.isLoading && <div className="skeleton h-64 rounded-lg" />}
      {!activity.isLoading && entries.length === 0 && (
        <p className="py-12 text-center text-sm text-white/35">Nothing recorded for this filter.</p>
      )}

      <div className="divide-y divide-white/8 rounded-xl border border-white/10">
        {entries.map((e) => (
          <div key={e.Id} className="flex items-start gap-3 px-4 py-3">
            <span
              className={`mt-1.5 size-1.5 shrink-0 rounded-full ${
                e.Severity === 'Error' || e.Severity === 'Critical'
                  ? 'bg-accent'
                  : e.Severity === 'Warning'
                    ? 'bg-amber-400'
                    : 'bg-white/25'
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-white/85">{e.Name}</p>
              {e.ShortOverview && <p className="text-xs text-white/45">{e.ShortOverview}</p>}
              {e.Overview && e.Overview !== e.ShortOverview && (
                <p className="mt-0.5 text-xs text-white/35">{e.Overview}</p>
              )}
              <p className="mt-0.5 text-[11px] text-white/25">
                {e.Type}
                {e.UserId && e.UserId !== '00000000-0000-0000-0000-000000000000' ? ' · user' : ' · system'}
              </p>
            </div>
            {e.Date && (
              <span className="shrink-0 text-xs text-white/35">
                {new Date(e.Date).toLocaleString()}
              </span>
            )}
          </div>
        ))}
      </div>

      {entries.length >= limit && (
        <button
          onClick={() => setLimit(limit + 50)}
          className="mt-4 w-full rounded-lg border border-white/15 py-2.5 text-sm text-white/65 transition hover:border-white/40 hover:text-white"
        >
          Load more
        </button>
      )}
    </div>
  )
}
