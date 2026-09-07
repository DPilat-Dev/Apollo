/**
 * Keeping the query cache across reloads.
 *
 * Navigating inside a session is already instant — the cache holds everything
 * asked for. Reloading throws all of it away, so the home page comes back to
 * skeletons and a round trip to the server for shelves that have not changed.
 * That is the moment this exists for: opening Apollo shows content, then
 * refreshes it, instead of showing nothing until the server answers.
 *
 * ── What must not be kept ──────────────────────────────────────────────────
 *
 * Most of it. A cache written to disk outlives the tab, the sign-in and, on a
 * shared computer, the person — so the rule is that a query is persisted only
 * if it is worth the wait it saves *and* is harmless a day later.
 *
 * Excluded, and why:
 *
 *   - Anything administrative. Logs, sessions, devices, API keys, plugins and
 *     scheduled tasks are a live view of a server, and a stale one is worse
 *     than none — an administrator acting on yesterday's session list is being
 *     actively misled.
 *   - Anything about right now. `resume`, `nextUp` and `segments` change as a
 *     direct result of watching something, which is the one thing a viewer
 *     will notice being wrong.
 *   - Anything from another service. Jellyseerr has its own session.
 */

/** Bumped when the shape of anything stored here changes. */
export const PERSIST_VERSION = 1

/**
 * How long a stored cache may be used for.
 *
 * A day. Long enough that opening Apollo each evening is instant, short enough
 * that a library reorganised in the morning is not still being described from
 * memory that night.
 */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * The queries worth keeping — named individually rather than filtered by
 * exclusion, so a new query is not persisted by accident. Anything absent from
 * this list simply refetches, which is what it does today.
 */
export const PERSISTED_QUERIES = new Set([
  'views',
  'itemsRow',
  'item',
  'seasons',
  'episodes',
  'latest',
  'boxSets',
  'playlists',
  'playlistItems',
  'similar',
  'itemCounts',
  'me',
])

export function shouldPersistQuery(key: readonly unknown[]): boolean {
  const head = key[0]
  return typeof head === 'string' && PERSISTED_QUERIES.has(head)
}

/**
 * The storage key, which is also the isolation boundary.
 *
 * Per server and per user, because a cache is a description of one account's
 * library. Two people sharing a browser must never be shown each other's
 * shelves from disk, and a signed-out cache must not be readable by whoever
 * signs in next.
 *
 * The version is in the key rather than checked after loading, so an upgrade
 * cannot half-read an older shape.
 */
export function persistKey(input: {
  server?: string | null
  userId?: string | null
}): string | null {
  const { server, userId } = input
  if (!server || !userId) return null
  return `apollo.cache.v${PERSIST_VERSION}.${server}.${userId}`
}

export interface StoredCache {
  savedAt: number
  version: number
  state: unknown
}

/** Whether a stored cache may still be used. */
export function isUsable(stored: StoredCache | null | undefined, now = Date.now()): boolean {
  if (!stored || stored.version !== PERSIST_VERSION) return false
  if (typeof stored.savedAt !== 'number' || !Number.isFinite(stored.savedAt)) return false
  // A clock that has gone backwards — a device correcting its time, a restored
  // backup — should discard rather than trust an age it cannot compute.
  const age = now - stored.savedAt
  return age >= 0 && age <= PERSIST_MAX_AGE_MS
}
