import { useState } from 'react'
import { useAuth } from '../lib/auth'
import {
  useJellyseerrSession,
  useJellyseerrSignIn,
  useJellyseerrSignOut,
} from '../lib/queries'

/**
 * Connects this browser to Jellyseerr.
 *
 * Jellyseerr authenticates against the same Jellyfin server, so people sign in
 * as themselves and their own request limits and approval rules apply. Its
 * `/auth/jellyfin` route takes a username and password and calls Jellyfin's
 * login — it has no path for reusing an existing access token, so the password
 * has to be entered once here. Apollo never stores it: the reply is a
 * `connect.sid` session cookie held by the browser.
 */
export function JellyseerrSection() {
  const { session: jellyfin } = useAuth()
  const session = useJellyseerrSession()
  const signIn = useJellyseerrSignIn()
  const signOut = useJellyseerrSignOut()

  const [username, setUsername] = useState(jellyfin?.userName ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Nothing forwarding /jellyseerr — say so rather than showing a dead form.
  if (session.isLoading) return null
  if (!session.data?.reachable) {
    return (
      <Wrapper>
        <div className="px-4 py-4">
          <p className="text-sm text-white/70">Not reachable from this app.</p>
          <p className="mt-1 text-xs text-white/45">
            Jellyseerr sends no CORS headers, so the browser cannot call it directly. Whatever
            serves Apollo has to forward <code className="text-white/70">/jellyseerr</code> to it —
            see the README.
          </p>
        </div>
      </Wrapper>
    )
  }

  const wrongAccount = session.data.wrongAccount
  const autoError = session.data.autoError
  const user = session.data.user
  if (user) {
    return (
      <Wrapper>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">
              Requesting as{' '}
              <span className="text-emerald-300">{user.displayName ?? 'your account'}</span>
            </p>
            <p className="mt-0.5 text-xs text-white/45">
              Linked to {jellyfin?.userName}
              {typeof user.requestCount === 'number' ? ` · ${user.requestCount} requests` : ''}
            </p>
          </div>
          <button
            onClick={() => signOut.mutate()}
            disabled={signOut.isPending}
            className="rounded border border-white/20 px-4 py-2 text-sm transition hover:border-white/50 disabled:opacity-40"
          >
            Disconnect
          </button>
        </div>
      </Wrapper>
    )
  }

  return (
    <Wrapper>
      <form
        className="space-y-3 px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          signIn.mutate(
            { username, password },
            {
              onSuccess: () => setPassword(''),
              onError: (err) =>
                setError(err instanceof Error ? err.message : 'Could not sign in to Jellyseerr.'),
            },
          )
        }}
      >
        {wrongAccount ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            This browser held a Jellyseerr session for a different account, so it was signed out.
            Sign in below to request as {jellyfin?.userName}.
          </p>
        ) : autoError ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            Signing in automatically didn't work: {autoError}
          </p>
        ) : (
          <p className="text-xs text-white/45">
            Sign in with the same Jellyfin account you use here. Requests are then made as you, so
            your own limits and approvals apply.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
            />
          </label>
        </div>
        {error && <p className="text-xs text-red-300">{error}</p>}
        <button
          type="submit"
          disabled={!username || signIn.isPending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
        >
          {signIn.isPending ? 'Connecting…' : 'Connect Jellyseerr'}
        </button>
      </form>
    </Wrapper>
  )
}

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">
        Jellyseerr
      </h2>
      <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-soft/60">
        {children}
      </div>
    </section>
  )
}
