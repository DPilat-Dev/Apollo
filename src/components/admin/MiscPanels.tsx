import { useState } from 'react'
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
  useUninstallPlugin,
} from '../../lib/queries'
import { ConfigPanel, Section, Switch, TextArea, ToggleRow, ToggleRows } from './controls'

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

function InstalledPlugins() {
  const plugins = usePlugins()
  const uninstall = useUninstallPlugin()
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <div>
      <p className="mb-4 text-sm text-white/45">
        {plugins.data?.length ?? 0} installed. Removing one takes effect after a server restart.
      </p>

      {plugins.isLoading && <div className="skeleton h-32 rounded-lg" />}
      {!plugins.isLoading && (plugins.data ?? []).length === 0 && (
        <p className="py-12 text-center text-sm text-white/35">No plugins installed.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {(plugins.data ?? []).map((p) => (
          <div key={`${p.Id}-${p.Version}`} className="rounded-xl border border-white/10 bg-ink-soft/60 p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{p.Name}</p>
                <p className="text-xs text-white/40">v{p.Version}</p>
              </div>
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                  p.Status === 'Active'
                    ? 'border-emerald-500/40 text-emerald-300'
                    : 'border-amber-500/40 text-amber-300'
                }`}
              >
                {p.Status}
              </span>
            </div>
            {p.Description && (
              <p className="mt-2 line-clamp-2 text-xs text-white/50">{p.Description}</p>
            )}

            {p.CanUninstall && (
              <div className="mt-3">
                {confirming === p.Id ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => p.Id && uninstall.mutate(p.Id, { onSettled: () => setConfirming(null) })}
                      disabled={uninstall.isPending}
                      className="rounded bg-accent px-3 py-1 text-xs font-semibold transition hover:bg-accent-hot disabled:opacity-50"
                    >
                      Confirm removal
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
                    onClick={() => setConfirming(p.Id ?? null)}
                    className="rounded border border-white/20 px-3 py-1 text-xs transition hover:border-accent hover:text-accent"
                  >
                    Uninstall
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
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
