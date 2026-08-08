import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { JellyfinApi, clearSession, loadSession, saveSession, type Session } from './api'
import { signOut as jellyseerrSignOut } from './jellyseerr'

interface AuthValue {
  session: Session | null
  api: JellyfinApi | null
  signIn: (session: Session) => void
  signOut: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession())

  const signIn = useCallback((s: Session) => {
    saveSession(s)
    setSession(s)
  }, [])

  const signOut = useCallback(() => {
    // End the Jellyseerr session as well. Its cookie belongs to the browser,
    // not to this account, so leaving it behind would hand the next person to
    // sign in an authenticated Jellyseerr session that isn't theirs.
    void jellyseerrSignOut().catch(() => {})
    clearSession()
    setSession(null)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      api: session ? new JellyfinApi(session) : null,
      signIn,
      signOut,
    }),
    [session, signIn, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** For screens that render only behind the auth gate, where `api` is guaranteed. */
export function useApi(): JellyfinApi {
  const { api } = useAuth()
  if (!api) throw new Error('useApi used outside an authenticated route')
  return api
}
