import { useState, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import type { SessionInfoDto, TaskInfo, UserDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import {
  useActivityLog,
  useAllUsers,
  useCurrentUser,
  useItemCounts,
  useRefreshLibraries,
  useRunTask,
  useScheduledTasks,
  useSessions,
  useSystemInfo,
} from '../lib/queries'
import { formatTimecode, ticksToSeconds } from '../lib/format'
import { NewUserDialog, UserEditor } from '../components/admin/UserEditor'
import { LogsPanel } from '../components/admin/LogsPanel'
import { NetworkPanel } from '../components/admin/NetworkPanel'
import { ConnectionsPanel } from '../components/admin/ConnectionsPanel'
import { GeneralPanel } from '../components/admin/GeneralPanel'
import { PlaybackPanel } from '../components/admin/PlaybackPanel'
import { LibrariesPanel } from '../components/admin/LibrariesPanel'
import {
  ActivityPanel,
  ApiKeysPanel,
  BrandingPanel,
  PluginsPanel,
} from '../components/admin/MiscPanels'

const TABS = [
  'Overview',
  'General',
  'Libraries',
  'Playback',
  'Users',
  'Plugins',
  'Branding',
  'Network',
  'Connections',
  'API Keys',
  'Activity',
  'Logs',
] as const
type Tab = (typeof TABS)[number]

export function Admin() {
  const me = useCurrentUser()

  // Wait for the policy before deciding — redirecting on a pending query would
  // bounce admins out on every hard refresh.
  if (me.isPending) {
    return (
      <div className="px-4 pt-28 sm:px-8">
        <div className="skeleton h-40 rounded-xl" />
      </div>
    )
  }
  if (!me.data?.Policy?.IsAdministrator) return <Navigate to="/" replace />

  return <Dashboard />
}

function Dashboard() {
  const [tab, setTab] = useState<Tab>('Overview')
  const info = useSystemInfo()
  const counts = useItemCounts()
  const sessions = useSessions()
  const users = useAllUsers()
  const tasks = useScheduledTasks()
  const activity = useActivityLog(15)
  const runTask = useRunTask()
  const refresh = useRefreshLibraries()

  const me = useCurrentUser()
  const [editing, setEditing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const active = (sessions.data ?? []).filter((s) => s.NowPlayingItem)
  const editingUser = (users.data ?? []).find((u) => u.Id === editing)

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-8 sm:pt-28">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold sm:text-4xl">Dashboard</h1>
          <p className="mt-1 text-sm text-white/45">
            {info.data ? `${info.data.ServerName} · Jellyfin ${info.data.Version}` : 'Loading…'}
          </p>
        </div>
        <button
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          className="rounded bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-50"
        >
          {refresh.isPending ? 'Starting…' : 'Scan all libraries'}
        </button>
      </div>

      {info.data?.HasPendingRestart && (
        <p className="mb-6 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          This server has a pending restart.
        </p>
      )}

      <div className="scrollbar-none mb-6 flex gap-1 overflow-x-auto border-b border-white/10">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm transition ${
              tab === t
                ? 'border-accent font-semibold text-white'
                : 'border-transparent text-white/50 hover:text-white'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'General' && <GeneralPanel />}
      {tab === 'Libraries' && <LibrariesPanel />}
      {tab === 'Playback' && <PlaybackPanel />}
      {tab === 'Plugins' && <PluginsPanel />}
      {tab === 'Branding' && <BrandingPanel />}
      {tab === 'API Keys' && <ApiKeysPanel />}
      {tab === 'Activity' && <ActivityPanel />}
      {tab === 'Logs' && <LogsPanel />}
      {tab === 'Network' && <NetworkPanel />}
      {tab === 'Connections' && <ConnectionsPanel />}

      {tab === 'Users' && (
        <UsersTab
          users={users.data ?? []}
          loading={users.isLoading}
          onEdit={setEditing}
          onCreate={() => setCreating(true)}
        />
      )}

      {tab === 'Overview' && (
      <>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Now playing" value={active.length} accent />
        <Stat label="Movies" value={counts.data?.MovieCount} />
        <Stat label="Series" value={counts.data?.SeriesCount} />
        <Stat label="Episodes" value={counts.data?.EpisodeCount} />
      </div>

      <Panel title="Active sessions" subtitle="Refreshes every 5 seconds">
        {sessions.isLoading && <Skeleton rows={2} />}
        {!sessions.isLoading && active.length === 0 && <Empty>Nobody is streaming right now.</Empty>}
        <div className="space-y-3">
          {active.map((s) => (
            <SessionCard key={s.Id} session={s} />
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Scheduled tasks">
          {tasks.isLoading && <Skeleton rows={4} />}
          <div className="divide-y divide-white/8">
            {(tasks.data ?? []).map((t) => (
              <TaskRow
                key={t.Id}
                task={t}
                onRun={() => t.Id && runTask.mutate(t.Id)}
                busy={runTask.isPending}
              />
            ))}
          </div>
        </Panel>

        <Panel title="Users" subtitle={`${users.data?.length ?? 0} accounts`}>
          {users.isLoading && <Skeleton rows={4} />}
          <div className="divide-y divide-white/8">
            {(users.data ?? []).map((u) => (
              <div key={u.Id} className="flex items-center gap-3 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
                  {(u.Name ?? '?').charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{u.Name}</p>
                  <p className="text-xs text-white/40">
                    {u.LastActivityDate
                      ? `Active ${relativeTime(u.LastActivityDate)}`
                      : 'Never signed in'}
                  </p>
                </div>
                {u.Policy?.IsAdministrator && (
                  <span className="shrink-0 rounded border border-accent/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                    Admin
                  </span>
                )}
                {u.Policy?.IsDisabled && (
                  <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                    Disabled
                  </span>
                )}
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Recent activity">
        {activity.isLoading && <Skeleton rows={5} />}
        {!activity.isLoading && (activity.data ?? []).length === 0 && (
          <Empty>No activity recorded yet.</Empty>
        )}
        <div className="divide-y divide-white/8">
          {(activity.data ?? []).map((e) => (
            <div key={e.Id} className="flex items-start gap-3 py-2.5">
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
                <p className="truncate text-sm text-white/85">{e.Name}</p>
                {e.ShortOverview && (
                  <p className="truncate text-xs text-white/45">{e.ShortOverview}</p>
                )}
              </div>
              {e.Date && (
                <span className="shrink-0 text-xs text-white/35">{relativeTime(e.Date)}</span>
              )}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Server">
        <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <Detail label="Version" value={info.data?.Version} />
          <Detail label="Operating system" value={info.data?.OperatingSystemDisplayName} />
          <Detail label="Architecture" value={info.data?.SystemArchitecture} />
          <Detail label="Encoder" value={info.data?.EncoderLocation} />
          <Detail label="Local address" value={info.data?.LocalAddress} />
          <Detail label="Transcode path" value={info.data?.TranscodingTempPath} />
        </dl>
      </Panel>
      </>
      )}

      {editingUser && (
        <UserEditor
          user={editingUser}
          currentUserId={me.data?.Id ?? undefined}
          onClose={() => setEditing(null)}
        />
      )}
      {creating && <NewUserDialog onClose={() => setCreating(false)} />}
    </div>
  )
}

/** Full user list with management affordances. */
function UsersTab({
  users,
  loading,
  onEdit,
  onCreate,
}: {
  users: UserDto[]
  loading: boolean
  onEdit: (id: string) => void
  onCreate: () => void
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-white/45">{users.length} accounts</p>
        </div>
        <button
          onClick={onCreate}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot"
        >
          Add user
        </button>
      </div>

      {loading && <Skeleton rows={5} />}

      <div className="divide-y divide-white/8 rounded-xl border border-white/10">
        {users.map((u) => (
          <button
            key={u.Id}
            onClick={() => u.Id && onEdit(u.Id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/4"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm font-bold">
              {(u.Name ?? '?').charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{u.Name}</p>
              <p className="text-xs text-white/40">
                {u.LastActivityDate
                  ? `Active ${relativeTime(u.LastActivityDate)}`
                  : 'Never signed in'}
              </p>
            </div>
            {u.Policy?.IsAdministrator && (
              <span className="shrink-0 rounded border border-accent/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent">
                Admin
              </span>
            )}
            {u.Policy?.IsDisabled && (
              <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                Disabled
              </span>
            )}
            {u.Policy?.IsHidden && (
              <span className="shrink-0 rounded border border-white/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/40">
                Hidden
              </span>
            )}
            <span className="shrink-0 text-white/30">›</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SessionCard({ session }: { session: SessionInfoDto }) {
  const api = useApi()
  const item = session.NowPlayingItem
  const state = session.PlayState
  const art = item ? api.backdropUrl(item, 320) : null

  const positionSeconds = state?.PositionTicks ? ticksToSeconds(state.PositionTicks) : 0
  const totalSeconds = item?.RunTimeTicks ? ticksToSeconds(item.RunTimeTicks) : 0
  const pct = totalSeconds > 0 ? (positionSeconds / totalSeconds) * 100 : 0
  const transcoding = session.TranscodingInfo
  // The SDK generates this flags enum as an empty object, so it types as
  // `never`. The server sends a string array — read it through that shape.
  const reasons = (transcoding?.TranscodeReasons as unknown as string[] | undefined) ?? []

  return (
    <div className="flex gap-4 rounded-lg border border-white/10 bg-ink-soft/60 p-3">
      <div className="aspect-video w-32 shrink-0 overflow-hidden rounded bg-ink-card sm:w-40">
        {art && <img src={art} alt="" className="h-full w-full object-cover" />}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p className="truncate font-medium">{item?.Name}</p>
          {item?.SeriesName && (
            <span className="truncate text-xs text-white/45">{item.SeriesName}</span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-white/50">
          {session.UserName} · {session.Client} on {session.DeviceName}
        </p>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/15">
          <div className="h-full bg-accent" style={{ width: `${Math.min(pct, 100)}%` }} />
        </div>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-white/45">
          <span className="tabular-nums">
            {formatTimecode(positionSeconds)} / {formatTimecode(totalSeconds)}
          </span>
          {state?.IsPaused && <span className="text-amber-300">Paused</span>}
          <span
            className={`rounded px-1.5 py-px uppercase tracking-wide ${
              transcoding ? 'bg-amber-500/20 text-amber-200' : 'bg-emerald-500/15 text-emerald-300'
            }`}
          >
            {transcoding ? 'Transcoding' : 'Direct play'}
          </span>
          {transcoding?.Bitrate != null && (
            <span>{(transcoding.Bitrate / 1_000_000).toFixed(1)} Mbps</span>
          )}
          {transcoding?.Framerate != null && <span>{Math.round(transcoding.Framerate)} fps</span>}
        </p>
        {reasons.length > 0 && (
          <p className="mt-1 truncate text-[11px] text-white/35">{reasons.join(', ')}</p>
        )}
      </div>
    </div>
  )
}

function TaskRow({
  task,
  onRun,
  busy,
}: {
  task: TaskInfo
  onRun: () => void
  busy: boolean
}) {
  const running = task.State === 'Running'
  const progress = task.CurrentProgressPercentage ?? 0

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{task.Name}</p>
        {running ? (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full bg-accent transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        ) : (
          <p className="truncate text-xs text-white/40">
            {task.LastExecutionResult?.EndTimeUtc
              ? `Last run ${relativeTime(task.LastExecutionResult.EndTimeUtc)} · ${
                  task.LastExecutionResult.Status ?? 'Unknown'
                }`
              : 'Never run'}
          </p>
        )}
      </div>

      {running ? (
        <span className="shrink-0 text-xs tabular-nums text-white/50">{Math.round(progress)}%</span>
      ) : (
        <button
          onClick={onRun}
          disabled={busy}
          className="shrink-0 rounded border border-white/20 px-3 py-1 text-xs transition hover:border-white/50 disabled:opacity-40"
        >
          Run
        </button>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value?: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-ink-soft/60 px-4 py-3">
      <p className={`text-2xl font-bold tabular-nums ${accent ? 'text-accent' : ''}`}>
        {value != null ? value.toLocaleString() : '—'}
      </p>
      <p className="mt-0.5 text-xs text-white/45">{label}</p>
    </div>
  )
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <span className="text-xs text-white/35">{subtitle}</span>}
      </div>
      {children}
    </section>
  )
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex gap-2 border-b border-white/8 py-1.5">
      <dt className="shrink-0 text-white/40">{label}</dt>
      <dd className="ml-auto truncate text-white/80">{value ?? '—'}</dd>
    </div>
  )
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-10 rounded" />
      ))}
    </div>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-white/35">{children}</p>
}

/** "3m ago" / "2d ago" — enough precision for a dashboard glance. */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString()
}
