/**
 * A play queue for shuffled series playback.
 *
 * Kept in sessionStorage rather than React state because playback navigates
 * between routes — each episode is its own `/watch/:id` — so anything held in
 * memory dies on the first advance. Session scope also means the queue is gone
 * when the tab closes, which is the right lifetime for "shuffle this show".
 */

const KEY = 'apollo.playQueue'

export interface PlayQueue {
  /** The series this queue belongs to; a queue never crosses shows. */
  seriesId: string
  ids: string[]
  index: number
  shuffled: boolean
}

function read(): PlayQueue | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PlayQueue
    return Array.isArray(parsed.ids) && parsed.ids.length > 0 ? parsed : null
  } catch {
    return null
  }
}

function write(queue: PlayQueue | null) {
  try {
    if (queue) sessionStorage.setItem(KEY, JSON.stringify(queue))
    else sessionStorage.removeItem(KEY)
  } catch {
    /* private mode — shuffle just won't survive navigation */
  }
}

/** Fisher–Yates. Optionally pins one id to the front. */
export function shuffleIds(ids: string[], startWith?: string): string[] {
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  if (startWith) {
    const at = out.indexOf(startWith)
    if (at > 0) {
      out.splice(at, 1)
      out.unshift(startWith)
    }
  }
  return out
}

export function startShuffle(seriesId: string, episodeIds: string[]): PlayQueue | null {
  const ids = episodeIds.filter(Boolean)
  if (ids.length === 0) return null
  const queue: PlayQueue = { seriesId, ids: shuffleIds(ids), index: 0, shuffled: true }
  write(queue)
  return queue
}

export function clearQueue() {
  write(null)
}

/**
 * The active queue, but only if it applies to the episode being played.
 *
 * Re-syncs the index when someone navigates by hand — clicking a different
 * episode mid-shuffle should continue from there rather than snapping back.
 */
export function queueFor(itemId?: string): PlayQueue | null {
  const queue = read()
  if (!queue || !itemId) return null
  const at = queue.ids.indexOf(itemId)
  if (at === -1) return null
  if (at !== queue.index) {
    const synced = { ...queue, index: at }
    write(synced)
    return synced
  }
  return queue
}

export function nextInQueue(itemId?: string): string | null {
  const queue = queueFor(itemId)
  if (!queue) return null
  return queue.ids[queue.index + 1] ?? null
}

export function previousInQueue(itemId?: string): string | null {
  const queue = queueFor(itemId)
  if (!queue) return null
  return queue.index > 0 ? queue.ids[queue.index - 1] : null
}

/** Position for display, 1-based. */
export function queuePosition(itemId?: string): { position: number; total: number } | null {
  const queue = queueFor(itemId)
  if (!queue) return null
  return { position: queue.index + 1, total: queue.ids.length }
}
