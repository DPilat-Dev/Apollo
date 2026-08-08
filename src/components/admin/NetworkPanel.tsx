import { useEffect, useState } from 'react'
import type { NetworkConfiguration } from '@jellyfin/sdk/lib/generated-client/models'
import { useNetworkConfig, useSaveNetworkConfig } from '../../lib/queries'

type Cfg = NetworkConfiguration

const TOGGLES: { key: keyof Cfg; label: string; hint: string }[] = [
  { key: 'EnableRemoteAccess', label: 'Remote access', hint: 'Allow connections from outside the local network' },
  { key: 'AutoDiscovery', label: 'Auto-discovery', hint: 'Answer client discovery broadcasts on the LAN' },
  { key: 'EnableUPnP', label: 'UPnP port forwarding', hint: 'Ask the router to forward ports automatically' },
  { key: 'EnableIPv4', label: 'IPv4', hint: 'Bind to IPv4 addresses' },
  { key: 'EnableIPv6', label: 'IPv6', hint: 'Bind to IPv6 addresses' },
  { key: 'EnableHttps', label: 'HTTPS', hint: 'Serve over TLS (needs a certificate)' },
  { key: 'RequireHttps', label: 'Require HTTPS', hint: 'Redirect plain HTTP to HTTPS' },
  { key: 'IgnoreVirtualInterfaces', label: 'Ignore virtual interfaces', hint: 'Skip docker/vpn adapters when binding' },
]

const PORTS: { key: keyof Cfg; label: string }[] = [
  { key: 'InternalHttpPort', label: 'HTTP port' },
  { key: 'InternalHttpsPort', label: 'HTTPS port' },
  { key: 'PublicHttpPort', label: 'Public HTTP port' },
  { key: 'PublicHttpsPort', label: 'Public HTTPS port' },
]

const LISTS: { key: keyof Cfg; label: string; hint: string }[] = [
  { key: 'LocalNetworkSubnets', label: 'LAN subnets', hint: 'One per line, e.g. 192.168.1.0/24' },
  { key: 'LocalNetworkAddresses', label: 'Bind addresses', hint: 'Leave empty to bind all interfaces' },
  { key: 'KnownProxies', label: 'Known proxies', hint: 'Reverse proxies allowed to set forwarded headers' },
  { key: 'RemoteIPFilter', label: 'Remote IP filter', hint: 'Addresses to allow or block, one per line' },
]

export function NetworkPanel() {
  const query = useNetworkConfig()
  const save = useSaveNetworkConfig()
  const [draft, setDraft] = useState<Cfg | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Edit a local copy so nothing is sent until Save is pressed.
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data)
  }, [query.data, draft])

  if (query.isLoading) return <div className="skeleton h-64 rounded-lg" />
  if (query.error) {
    return (
      <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-red-200">
        {query.error instanceof Error ? query.error.message : 'Could not load network settings.'}
      </p>
    )
  }
  if (!draft) return null

  const set = <K extends keyof Cfg>(key: K, value: Cfg[K]) => {
    setNotice(null)
    setDraft({ ...draft, [key]: value })
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(query.data)

  return (
    <div className="max-w-3xl space-y-6">
      <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
        Most of these need a server restart before they take effect, and a wrong value here can
        make the server unreachable — including from this page.
      </p>

      {notice && (
        <p className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/75">
          {notice}
        </p>
      )}

      <Section title="Access">
        <div className="divide-y divide-white/8 rounded-lg border border-white/10">
          {TOGGLES.map((t) => (
            <div key={String(t.key)} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm">{t.label}</p>
                <p className="text-xs text-white/40">{t.hint}</p>
              </div>
              <Switch
                label={t.label}
                checked={Boolean(draft[t.key])}
                onChange={() => set(t.key, !draft[t.key] as Cfg[typeof t.key])}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section title="Ports">
        <div className="grid gap-3 sm:grid-cols-2">
          {PORTS.map((p) => (
            <label key={String(p.key)} className="block">
              <span className="mb-1 block text-xs text-white/50">{p.label}</span>
              <input
                type="number"
                value={(draft[p.key] as number | undefined) ?? ''}
                onChange={(e) => set(p.key, Number(e.target.value) as Cfg[typeof p.key])}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm tabular-nums outline-none focus:border-white/40"
              />
            </label>
          ))}
        </div>
      </Section>

      <Section title="Addressing">
        <label className="block">
          <span className="mb-1 block text-xs text-white/50">Base URL</span>
          <input
            value={draft.BaseUrl ?? ''}
            onChange={(e) => set('BaseUrl', e.target.value)}
            placeholder="/jellyfin"
            className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/40"
          />
          <span className="mt-1 block text-xs text-white/35">
            Path prefix when served behind a reverse proxy. Leave empty for none.
          </span>
        </label>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {LISTS.map((l) => (
            <label key={String(l.key)} className="block">
              <span className="mb-1 block text-xs text-white/50">{l.label}</span>
              <textarea
                rows={3}
                value={((draft[l.key] as string[] | undefined) ?? []).join('\n')}
                onChange={(e) =>
                  set(
                    l.key,
                    e.target.value
                      .split('\n')
                      .map((s) => s.trim())
                      .filter(Boolean) as Cfg[typeof l.key],
                  )
                }
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-xs outline-none focus:border-white/40"
              />
              <span className="mt-1 block text-xs text-white/35">{l.hint}</span>
            </label>
          ))}
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setNotice(null)
            save.mutate(draft, {
              onSuccess: () => setNotice('Saved. Restart Jellyfin for these to take effect.'),
              onError: (e) =>
                setNotice(e instanceof Error ? e.message : 'Could not save network settings.'),
            })
          }}
          disabled={!dirty || save.isPending}
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-35"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={() => {
            setDraft(query.data ?? null)
            setNotice(null)
          }}
          disabled={!dirty}
          className="rounded-lg border border-white/20 px-5 py-2.5 text-sm transition hover:border-white/45 disabled:opacity-35"
        >
          Discard
        </button>
        {dirty && <span className="text-xs text-white/40">Unsaved changes</span>}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">{title}</h3>
      {children}
    </section>
  )
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        checked ? 'bg-accent' : 'bg-white/20'
      }`}
    >
      {/* Positioned with `left`, not translate — see Settings.tsx for why. */}
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white transition-[left] duration-200 ${
          checked ? 'left-[1.375rem]' : 'left-0.5'
        }`}
      />
    </button>
  )
}
