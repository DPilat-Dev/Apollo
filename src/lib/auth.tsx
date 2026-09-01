import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { JellyfinApi, clearSession, loadSession, saveSession, type Session } from './api'
import { signOut as jellyseerrSignOut } from './jellyseerr'
import { forgetSignIn, purgeDeviceState, rememberSignIn } from './accounts'
import { resetSettings } from './settings'

interface AuthValue {
  session: Session | null
  api: JellyfinApi | null
  /** `avatarTag` is Jellyfin's PrimaryImageTag, kept so the picker has a face. */
  signIn: (session: Session, avatarTag?: string | null) => void
  /** Done with this device: the session ends and the profile is forgotten. */
  signOut: () => void
  /** Handing the device over: same clean slate, but the profile is kept. */
  switchUser: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => loadSession())
  const queryClient = useQueryClient()

  const signIn = useCallback((s: Session, avatarTag?: string | null) => {
    saveSession(s)
    // Identity only — see the note at the top of accounts.ts for why the token
    // that just came back is not part of what gets remembered.
    rememberSignIn({
      server: s.server,
      userId: s.userId,
      userName: s.userName,
      avatarTag: avatarTag ?? null,
    })
    setSession(s)
  }, [])

  /**
   * Everything the outgoing person leaves behind, in one place.
   *
   * The cache clear is the part that matters. Most query keys carry
   * `api.userId`, which is enough to stop a *stale* row rendering — but plenty
   * do not (segments, server info, the Jellyseerr session), and even the keyed
   * ones sit in memory for the whole gcTime window. Signing straight back in
   * as someone else on the same tab is exactly the case where that shows: the
   * next person sees the last person's Continue Watching. Nothing here is
   * expensive enough to be worth being clever about, so the cache goes whole.
   */
  const endSession = useCallback(
    (forgetProfile: boolean) => {
      // End the Jellyseerr session as well. Its cookie belongs to the browser,
      // not to this account, so leaving it behind would hand the next person to
      // sign in an authenticated Jellyseerr session that isn't theirs.
      void jellyseerrSignOut().catch(() => {})
      if (forgetProfile && session) forgetSignIn(session.server, session.userId)
      clearSession()
      purgeDeviceState()
      // The storage purge takes apollo.settings with it, but settings.ts holds
      // a snapshot in module scope that outlives it — without this the next
      // person inherits the last one's subtitle size until a reload.
      resetSettings()
      queryClient.clear()
      setSession(null)
    },
    [queryClient, session],
  )

  /*
    Two intents that look alike and are not. "Sign out" is someone leaving —
    their profile comes off the device, so the picker stops suggesting them.
    "Switch user" is someone handing over — the profile stays, which is the
    whole point of the picker. Both wipe the session state identically.
  */
  const signOut = useCallback(() => endSession(true), [endSession])
  const switchUser = useCallback(() => endSession(false), [endSession])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      api: session ? new JellyfinApi(session) : null,
      signIn,
      signOut,
      switchUser,
    }),
    [session, signIn, signOut, switchUser],
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
