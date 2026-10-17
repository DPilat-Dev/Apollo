/**
 * The moment a stored token stops being accepted.
 *
 * Apollo keeps a session in localStorage and trusts it until a request says
 * otherwise. Nothing used to listen for that refusal, and the result was the
 * worst version of a failure: every row on Home rendered `GET /Items failed
 * (401)` beside a Retry button that could never succeed, with nothing on
 * screen suggesting signing in again. Measured on a revoked token: eleven
 * queries, twenty-two 401s, and no way out but knowing to walk to Settings.
 *
 * A token dies for ordinary reasons, not exotic ones — an admin revoking the
 * device (which Apollo's own dashboard can do), a password change, some server
 * upgrades. So this is a condition to handle, not an edge case to tolerate.
 *
 * ── Why a latch ───────────────────────────────────────────────────────────
 *
 * The refusal arrives many times at once, because the page asks for many
 * things at once. Signing out once per 401 would run the teardown twenty times
 * and fight itself. So the first one wins and the rest are swallowed until
 * someone signs in again and `resetSessionExpiry` re-arms it.
 *
 * ── Why 401 only ──────────────────────────────────────────────────────────
 *
 * 403 is a different sentence: the token is fine and this account may not do
 * that. An ordinary viewer opening an admin endpoint gets one, and signing
 * them out over it would be a bug with the same shape as the one this fixes.
 * Sign-in itself is also exempt by construction — `authenticate` does not go
 * through `request`, so a wrong password never reaches here.
 */

type Listener = () => void

const listeners = new Set<Listener>()

/** Latched by the first refusal, cleared when somebody signs in again. */
let expired = false

/**
 * Whether the sign-in screen still owes somebody an explanation.
 *
 * Separate from `expired` because they end at different moments: the latch
 * lasts until the next sign-in, the notice until it has been read once.
 */
let noticePending = false

/** A request was refused for a token the server no longer accepts. */
export function reportSessionExpired(): void {
  if (expired) return
  expired = true
  noticePending = true
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch {
      // One listener throwing must not cost the others their notification —
      // this is the path out of a broken session, and it has to run.
    }
  }
}

export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Whether to explain why the sign-in screen is showing. Reading it clears it,
 * so the explanation belongs to one trip through that screen rather than
 * greeting someone who came back later and signed out on purpose.
 */
export function takeSessionExpiredNotice(): boolean {
  const pending = noticePending
  noticePending = false
  return pending
}

/** A new session: arm the latch again. */
export function resetSessionExpiry(): void {
  expired = false
  noticePending = false
}

/** Test seam — the module state is deliberately not exported directly. */
export function sessionExpiryIsLatched(): boolean {
  return expired
}
