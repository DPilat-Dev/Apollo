import type { QueryClient } from '@tanstack/react-query'
import { signIn, signOut } from './jellyseerr'

/**
 * Connects the browser to Jellyseerr using the credentials just used for
 * Jellyfin, then tells the session query to look again.
 *
 * The refresh is the point. Without it the app renders as signed in the moment
 * Jellyfin returns, `/auth/me` runs while this sequence is still mid-flight —
 * with the old cookie already cleared and the new one not yet issued — and the
 * resulting "not signed in" gets cached, showing a sign-in prompt to someone
 * who is in fact signed in.
 */

const ERROR_KEY = 'apollo.seerrAutoConnectError'
let inFlight: Promise<void> | null = null

/**
 * Why the last automatic attempt failed, for the UI to explain itself.
 * Kept in sessionStorage rather than a module variable so the explanation
 * survives a page reload — the reason someone is being asked to sign in is
 * exactly what gets lost otherwise.
 */
export const autoConnectError = (): string | null => {
  try {
    return sessionStorage.getItem(ERROR_KEY)
  } catch {
    return null
  }
}

function recordError(message: string | null) {
  try {
    if (message) sessionStorage.setItem(ERROR_KEY, message)
    else sessionStorage.removeItem(ERROR_KEY)
  } catch {
    /* private mode — the message is a nicety, not a requirement */
  }
}

/**
 * Resolves once any running attempt finishes. Session reads await this so they
 * cannot observe — and cache — the gap between the old cookie being cleared
 * and the new one arriving. Never rejects.
 */
export const settleConnect = (): Promise<void> => inFlight ?? Promise.resolve()

export function connectJellyseerr(
  username: string,
  password: string,
  queryClient: QueryClient,
): Promise<void> {
  recordError(null)
  inFlight = (async () => {
    try {
      // Clear any session a previous user of this browser left behind, so a
      // failure here cannot leave theirs live.
      await signOut().catch(() => {})
      await signIn(username, password)
    } catch (err) {
      recordError(err instanceof Error ? err.message : 'Automatic sign-in failed.')
    } finally {
      inFlight = null
      await queryClient.invalidateQueries({ queryKey: ['seerrSession'] })
    }
  })()
  return inFlight
}
