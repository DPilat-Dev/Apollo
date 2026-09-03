import { useState, type ReactNode } from 'react'
import { useDevices, useIsAdmin, useRevokeDevices } from '../lib/queries'
import {
  deviceScopes,
  deviceSummaryLine,
  revokeMessage,
  revokePlan,
  visibleDevices,
  type DeviceGroup,
  type DeviceRow,
  type DeviceScope,
  type RevokeSelection,
} from '../lib/devices'

const SCOPE_LABELS: Record<DeviceScope, string> = {
  mine: 'My devices',
  everyone: 'Everyone',
}

/**
 * Which devices hold a token for this server, and a way to take one back.
 *
 * It lives in Settings rather than the dashboard because the row that matters
 * most is the browser the reader is sitting in, and this is the page that
 * already ends "Switch user, Sign out". An admin gets the whole server through
 * the toggle instead of a second copy of the same list in another route.
 *
 * The section renders for nobody else: `/Devices` is elevated, so a non-admin's
 * request would come back 403 and there is nothing honest to show them.
 */
export function DevicesSection() {
  const isAdmin = useIsAdmin()
  const [scope, setScope] = useState<DeviceScope>('mine')
  const [expanded, setExpanded] = useState<readonly string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const devices = useDevices(scope)
  const revoke = useRevokeDevices()

  const scopes = deviceScopes(isAdmin)
  if (scopes.length === 0) return null

  const overview = devices.data
  const rows = overview?.rows ?? []

  const run = (selection: RevokeSelection) => {
    const plan = revokePlan(rows, selection)
    if (!plan) return
    setMessage(null)
    revoke.mutate(plan, {
      onSuccess: (outcome) => setMessage(revokeMessage(outcome)),
      onError: () => setMessage('Could not reach the server — nothing was signed out.'),
    })
  }

  const sweep = revokePlan(rows, { kind: 'stale' })
  const others = revokePlan(rows, { kind: 'others' })

  return (
    <Wrapper>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {devices.isPending
              ? 'Counting devices…'
              : overview
                ? deviceSummaryLine(overview)
                : 'Could not read the device list.'}
          </p>
          <p className="mt-0.5 text-xs text-white/45">
            Each one holds an access token until it is signed out here.
          </p>
        </div>
        {scopes.length > 1 && (
          <div className="flex shrink-0 rounded-lg border border-white/15 p-0.5 text-xs">
            {scopes.map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={`rounded-md px-2.5 py-1 transition ${
                  scope === s ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'
                }`}
              >
                {SCOPE_LABELS[s]}
              </button>
            ))}
          </div>
        )}
      </div>

      {(sweep || others) && (
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {sweep && (
            <button
              onClick={() => run({ kind: 'stale' })}
              disabled={revoke.isPending}
              className="rounded border border-white/20 px-3 py-1.5 text-xs transition hover:border-white/50 disabled:opacity-40"
            >
              Sign out {sweep.ids.length} unused
            </button>
          )}
          {others && (
            <button
              onClick={() => run({ kind: 'others' })}
              disabled={revoke.isPending}
              className="rounded border border-white/20 px-3 py-1.5 text-xs transition hover:border-white/50 disabled:opacity-40"
            >
              Sign out the other {others.ids.length}
            </button>
          )}
          {revoke.isPending && <span className="self-center text-xs text-white/45">Working…</span>}
        </div>
      )}

      {message && <p className="px-4 pb-3 text-xs text-white/60">{message}</p>}

      {devices.isPending && <div className="skeleton mx-4 mb-4 h-24 rounded-lg" />}

      {overview?.groups.map((group) => (
        <Group
          key={group.key}
          group={group}
          expanded={expanded.includes(group.key)}
          onToggle={() =>
            setExpanded((keys) =>
              keys.includes(group.key) ? keys.filter((k) => k !== group.key) : [...keys, group.key],
            )
          }
          onRevoke={(id) => run({ kind: 'one', id })}
          busy={revoke.isPending}
        />
      ))}
    </Wrapper>
  )
}

function Group({
  group,
  expanded,
  onToggle,
  onRevoke,
  busy,
}: {
  group: DeviceGroup
  expanded: boolean
  onToggle: () => void
  onRevoke: (id: string) => void
  busy: boolean
}) {
  const { rows, hidden } = visibleDevices(group, expanded)
  return (
    <div className="border-t border-white/8">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
        <p className="truncate text-xs font-semibold uppercase tracking-wider text-white/40">
          {group.appName}
        </p>
        <p className="shrink-0 text-xs text-white/35">
          {group.devices.length}
          {group.staleCount > 0 && ` · ${group.staleCount} unused`}
        </p>
      </div>
      <ul>
        {rows.map((row) => (
          <Device key={row.id} row={row} onRevoke={() => onRevoke(row.id)} busy={busy} />
        ))}
      </ul>
      {(hidden > 0 || expanded) && (
        <button
          onClick={onToggle}
          className="w-full px-4 pb-3 text-left text-xs text-white/45 transition hover:text-white"
        >
          {hidden > 0 ? `Show ${hidden} more` : 'Show fewer'}
        </button>
      )}
    </div>
  )
}

function Device({ row, onRevoke, busy }: { row: DeviceRow; onRevoke: () => void; busy: boolean }) {
  return (
    <li
      className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 ${
        row.isCurrent ? 'bg-accent/10' : ''
      }`}
    >
      <div className="min-w-0">
        <p className="truncate text-sm">
          {row.name}
          {row.isCurrent && (
            /* Said on the row rather than only in the confirmation, so nobody
               reaches for the button believing it is somebody else's. */
            <span className="ml-2 rounded-full border border-accent/50 bg-accent/15 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider text-white">
              This device
            </span>
          )}
        </p>
        <p className="mt-0.5 truncate text-xs text-white/45">
          {[row.lastUserName, row.appVersion, row.lastActiveLabel].filter(Boolean).join(' · ')}
        </p>
      </div>
      <button
        onClick={onRevoke}
        disabled={busy}
        className={`shrink-0 rounded border px-3 py-1.5 text-xs transition disabled:opacity-40 ${
          row.isCurrent
            ? 'border-red-500/40 text-red-200 hover:border-red-400'
            : 'border-white/20 hover:border-white/50'
        }`}
      >
        {row.isCurrent ? 'Sign out this device' : 'Sign out'}
      </button>
    </li>
  )
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">Devices</h2>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-soft/60">
        {children}
      </div>
    </section>
  )
}
