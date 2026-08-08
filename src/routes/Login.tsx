import { useEffect, useRef, useState } from 'react'
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models'
import { authenticate, buildUrl, normalizeServer, publicUsers, serverInfo } from '../lib/api'
import { useAuth } from '../lib/auth'
import { useQueryClient } from '@tanstack/react-query'
import { connectJellyseerr } from '../lib/jellyseerrConnect'
import { useBranding } from '../lib/branding'

const DEFAULT_SERVER = import.meta.env.VITE_JELLYFIN_SERVER ?? ''

/**
 * picker — choose a profile (only when the server publishes its user list)
 * person — one profile chosen; password only
 * manual — type both a username and a password
 */
type Mode = 'picker' | 'person' | 'manual'

export function Login() {
  const { signIn } = useAuth()
  const queryClient = useQueryClient()
  const [server, setServer] = useState(DEFAULT_SERVER)
  const [connected, setConnected] = useState<{ name: string; version: string } | null>(null)
  const [users, setUsers] = useState<UserDto[]>([])
  const [mode, setMode] = useState<Mode>('manual')
  const [selected, setSelected] = useState<UserDto | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingServer, setEditingServer] = useState(!DEFAULT_SERVER)
  const passwordRef = useRef<HTMLInputElement>(null)
  // Only fetch branding once the server is known to be real.
  const branding = useBranding(connected ? server : undefined)

  const connect = async (url: string) => {
    setConnecting(true)
    setError(null)
    try {
      const info = await serverInfo(url)
      setConnected({ name: info.ServerName, version: info.Version })
      setEditingServer(false)
      try {
        const list = await publicUsers(url)
        setUsers(list)
        // No published users means there is nothing to pick from.
        setMode(list.length > 0 ? 'picker' : 'manual')
      } catch {
        // Public user list is optional — the server may have it disabled.
        setUsers([])
        setMode('manual')
      }
    } catch (err) {
      // serverInfo distinguishes "unreachable" from "reachable but not Jellyfin".
      setError(
        err instanceof Error
          ? err.message
          : 'Could not reach that server. Check the address and that it is running.',
      )
      setConnected(null)
      setEditingServer(true)
    } finally {
      setConnecting(false)
    }
  }

  const choose = (user: UserDto) => {
    setSelected(user)
    setUsername(user.Name ?? '')
    setPassword('')
    setError(null)
    setMode('person')
  }

  const backToPicker = () => {
    setSelected(null)
    setUsername('')
    setPassword('')
    setError(null)
    setMode('picker')
  }

  // Land in the password field as soon as a profile is chosen.
  useEffect(() => {
    if (mode === 'person') passwordRef.current?.focus()
  }, [mode])

  const avatarUrl = (user: UserDto) =>
    user.PrimaryImageTag && user.Id
      ? buildUrl(normalizeServer(server), '/UserImage', {
          userId: user.Id,
          tag: user.PrimaryImageTag,
        })
      : null

  // Auto-connect to the configured default so the common case is one step.
  useEffect(() => {
    if (DEFAULT_SERVER) void connect(DEFAULT_SERVER)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const session = await authenticate(server, username, password)

      /*
        Jellyseerr accounts here are linked to Jellyfin ones, so the same
        credentials work. Connect while we still have the password — Apollo
        only ever keeps the Jellyfin token, and Jellyseerr replies with its own
        session cookie.

        Not awaited on purpose: not everyone has a Jellyseerr account, and
        Jellyseerr being slow or down must never delay someone reaching their
        media. It refreshes the session query when it lands.
      */
      void connectJellyseerr(username, password, queryClient)

      signIn(session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <Backdrop />

      <div className="relative z-10 w-full max-w-4xl">
        <div className="grid overflow-hidden rounded-2xl border border-white/10 bg-black/45 shadow-2xl shadow-black/60 backdrop-blur-2xl md:grid-cols-[1.05fr_1fr]">
          {/* Brand panel — hidden on small screens where it would just push
              the form below the fold. */}
          <div className="relative hidden flex-col justify-between overflow-hidden border-r border-white/10 p-10 md:flex">
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(229,9,20,0.35),transparent_60%)]" />
            <div className="relative">
              <p className="text-3xl font-black tracking-tight text-accent">APOLLO</p>
              <p className="mt-1 text-xs uppercase tracking-[0.2em] text-white/35">
                for Jellyfin
              </p>
            </div>

            <div className="relative">
              <h2 className="text-3xl font-bold leading-tight text-white">
                Your library,
                <br />
                without the clutter.
              </h2>
              <p className="mt-3 max-w-xs text-sm leading-relaxed text-white/50">
                Everything on your server, arranged the way you actually watch it.
              </p>
            </div>

            <ul className="relative space-y-2.5 text-sm text-white/55">
              {[
                'Picks up wherever you stopped',
                'Direct play when your browser can handle it',
                'Works on the couch and on the phone',
              ].map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          {/* Form panel */}
          <div className="p-7 sm:p-10">
            <div className="mb-7 md:hidden">
              <p className="text-2xl font-black tracking-tight text-accent">APOLLO</p>
            </div>

            <h1 className="text-2xl font-bold text-white">
              {mode === 'picker' ? "Who's watching?" : 'Sign in'}
            </h1>
            <ServerStatus
              connected={connected}
              connecting={connecting}
              onChange={() => setEditingServer(true)}
            />

            <form onSubmit={submit} className="mt-6 space-y-4">
              {(editingServer || !connected) && (
                <Field label="Server address">
                  <div className="flex gap-2">
                    <input
                      value={server}
                      onChange={(e) => setServer(e.target.value)}
                      onKeyDown={(e) => {
                        // Enter should connect, not submit a form we can't fill yet.
                        if (e.key === 'Enter' && !connected) {
                          e.preventDefault()
                          void connect(server)
                        }
                      }}
                      placeholder="jellyfin.example.com:8096"
                      autoFocus
                      className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm outline-none transition placeholder:text-white/25 focus:border-accent/70 focus:bg-white/8"
                    />
                    <button
                      type="button"
                      onClick={() => void connect(server)}
                      disabled={connecting || !server}
                      className={`shrink-0 rounded-lg px-4 text-sm font-medium transition disabled:opacity-40 ${
                        connected
                          ? 'bg-white/10 hover:bg-white/20'
                          : 'bg-accent font-bold hover:bg-accent-hot'
                      }`}
                    >
                      {connecting ? '…' : 'Connect'}
                    </button>
                  </div>
                </Field>
              )}

              {/*
                Nothing to sign into until we know the server is really there —
                asking for a password first would be guesswork on both sides.
              */}
              {!connected && !connecting && !error && (
                <p className="text-xs leading-relaxed text-white/35">
                  Enter your Jellyfin server's address to continue. Include the port if it
                  isn't on 8096.
                </p>
              )}

              {connected && mode === 'picker' && (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {users.map((u) => (
                    <button
                      key={u.Id}
                      type="button"
                      onClick={() => choose(u)}
                      className="group flex flex-col items-center gap-2 rounded-lg p-2 transition hover:bg-white/6"
                    >
                      <Avatar user={u} src={avatarUrl(u)} size="md" />
                      <span className="w-full truncate text-center text-xs text-white/65 transition group-hover:text-white">
                        {u.Name}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {connected && mode === 'person' && selected && (
                <div className="flex flex-col items-center pb-1 pt-2">
                  <Avatar user={selected} src={avatarUrl(selected)} size="lg" />
                  <p className="mt-3 text-lg font-semibold text-white">{selected.Name}</p>
                </div>
              )}

              {connected && mode === 'manual' && (
                <Field label="Username">
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm outline-none transition focus:border-accent/70 focus:bg-white/8"
                  />
                </Field>
              )}

              {connected && mode !== 'picker' && (
                <Field label="Password" hint="Leave blank if your account has none">
                  <input
                    ref={passwordRef}
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-white/15 bg-white/5 px-3.5 py-2.5 text-sm outline-none transition focus:border-accent/70 focus:bg-white/8"
                  />
                </Field>
              )}

              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-accent/30 bg-accent/10 px-3.5 py-2.5 text-xs text-red-200"
                >
                  {error}
                </p>
              )}

              {connected && mode !== 'picker' && (
                <button
                  type="submit"
                  disabled={busy || !username || !server}
                  className="w-full rounded-lg bg-accent py-3 text-sm font-bold tracking-wide transition hover:bg-accent-hot disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {busy ? 'Signing in…' : 'Sign In'}
                </button>
              )}

              {/* Escape hatches between the three modes. */}
              <div className={`pt-1 text-center ${connected ? '' : 'hidden'}`}>
                {mode === 'picker' && (
                  <TextButton onClick={() => setMode('manual')}>
                    Sign in manually
                  </TextButton>
                )}
                {mode === 'person' && (
                  <TextButton onClick={backToPicker}>Not you? Choose another profile</TextButton>
                )}
                {mode === 'manual' && users.length > 0 && (
                  <TextButton onClick={backToPicker}>Back to profiles</TextButton>
                )}
              </div>
            </form>
          </div>
        </div>

        {branding?.LoginDisclaimer && (
          <p className="mt-5 whitespace-pre-line text-center text-xs text-white/45">
            {branding.LoginDisclaimer}
          </p>
        )}

        <p className="mt-3 text-center text-[11px] text-white/25">
          Apollo is a third-party client. Your credentials go straight to your own server.
        </p>
      </div>
    </div>
  )
}

function ServerStatus({
  connected,
  connecting,
  onChange,
}: {
  connected: { name: string; version: string } | null
  connecting: boolean
  onChange: () => void
}) {
  if (connecting) {
    return (
      <p className="mt-1.5 flex items-center gap-2 text-sm text-white/45">
        <span className="size-3.5 animate-spin rounded-full border-2 border-white/20 border-t-white/60" />
        Looking for your server…
      </p>
    )
  }
  if (!connected) {
    return <p className="mt-1.5 text-sm text-white/45">Connect to your Jellyfin server to begin.</p>
  }
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/45">
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        <span className="font-medium text-white/75">{connected.name}</span>
      </span>
      <span className="text-white/30">v{connected.version}</span>
      <button
        type="button"
        onClick={onChange}
        className="text-xs text-white/40 underline underline-offset-2 transition hover:text-white/75"
      >
        change
      </button>
    </p>
  )
}

function Avatar({
  user,
  src,
  size,
}: {
  user: UserDto
  src: string | null
  size: 'md' | 'lg'
}) {
  const dimension = size === 'lg' ? 'size-20 text-2xl' : 'size-14 text-lg'
  return (
    <span
      className={`flex ${dimension} items-center justify-center overflow-hidden rounded-full bg-white/10 font-bold text-white/75 ring-2 ring-transparent transition group-hover:ring-accent`}
    >
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        (user.Name ?? '?').charAt(0).toUpperCase()
      )}
    </span>
  )
}

function TextButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-white/40 underline underline-offset-4 transition hover:text-white/80"
    >
      {children}
    </button>
  )
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-white/55">{label}</span>
        {hint && <span className="text-[10px] text-white/25">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

/**
 * Ambient background. These layers sit at z-auto rather than -z-10: a negative
 * z-index would put them behind body's opaque background.
 */
function Backdrop() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,#4a151b_0%,#160a0c_45%,#0a0a0b_75%)]" />
      <div className="pointer-events-none absolute -left-40 top-1/4 size-[36rem] rounded-full bg-accent/30 blur-[150px]" />
      <div className="pointer-events-none absolute -right-40 bottom-0 size-[32rem] rounded-full bg-indigo-600/25 blur-[150px]" />
      {/* Faint grid, to give the glass panel something to sit against. */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
          maskImage: 'radial-gradient(ellipse at center, #000 0%, transparent 70%)',
        }}
      />
    </>
  )
}
