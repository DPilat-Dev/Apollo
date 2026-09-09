/**
 * Whether going back would leave the app entirely.
 *
 * React Router numbers its history entries, and the number says how many of
 * them belong to this session: at zero, the entry the player is on is the
 * first this document has, so there is nothing of ours behind it.
 *
 * It matters because `navigate(-1)` from there loads a whole new document —
 * and a document being torn down does not run React's cleanups, so the player
 * never gets to say where the viewer had reached. Opening a video by clicking
 * inside the app puts an entry behind it and everything works; opening one
 * directly, or refreshing on it, does not, and the position was lost every
 * time. It looked like "only saves when I pause", because the pause is what
 * kept the ten-second heartbeat reporting.
 */
export function canGoBackInApp(historyState: unknown): boolean {
  if (!historyState || typeof historyState !== 'object') return false
  const idx = (historyState as { idx?: unknown }).idx
  return typeof idx === 'number' && idx > 0
}

/** Where the back arrow should go: the previous screen, or the home page. */
export function backDestination(historyState: unknown): -1 | '/' {
  return canGoBackInApp(historyState) ? -1 : '/'
}
