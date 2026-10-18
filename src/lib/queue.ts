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

/**
 * The ids a queue can be walked by: no blanks, no repeats, order kept.
 *
 * An id is the only thing navigation carries between one `/watch/:id` and the
 * next, so every reader below locates the playing item with
 * `ids.indexOf(itemId)` — and `indexOf` answers with the *first* slot holding
 * that id. A list with the same id in it twice therefore has two slots
 * answering to one id and only the earlier one is ever found: queue
 * `[A, B, A, C]` played A → B → A → B → A → B for ever, C was unreachable, and
 * the badge read "1/4" throughout. `queueFor` made it permanent by writing
 * that first index back.
 *
 * Dropping the repeats is the trade, and it is the right way round. A playlist
 * holding the same title twice now plays it once; the alternative is a playlist
 * that never reaches its end. Keeping both slots would mean carrying a slot
 * number through navigation, and the only place to write one is `nextInQueue`
 * — which `Player.tsx` calls during render, so persisting an advance there
 * would write to sessionStorage on every frame of playback.
 *
 * Series shuffles are deduplicated too, where episode ids are unique anyway:
 * one rule for both is cheaper to hold in the head than two.
 */
function queueableIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))]
}

export function startShuffle(seriesId: string, episodeIds: string[]): PlayQueue | null {
  const ids = queueableIds(episodeIds)
  if (ids.length === 0) return null
  const queue: PlayQueue = { seriesId, ids: shuffleIds(ids), index: 0, shuffled: true }
  write(queue)
  return queue
}

/**
 * The same queue, in the order it was given.
 *
 * For a playlist, which is a list someone put in an order on purpose. Play on
 * one used to be `navigate('/watch/' + first.Id)` and nothing else, so the
 * queue was never written and the player fell back to what it does for a bare
 * item: a film played alone and stopped, and an episode handed over to the
 * *series'* next episode — which is not in the playlist, and is very likely
 * one already watched.
 *
 * `queueFor` and `nextInQueue` never cared about the order, only about
 * position, so nothing else has to change to support this. `shuffled: false`
 * is the one thing that distinguishes it, and it is there so the player can
 * say "Playlist 3/12" rather than claiming to be shuffling something.
 *
 * `startWith` is for the play button on a row: the queue keeps its order and
 * simply opens at that item, rather than being rotated to begin with it.
 *
 * A playlist is the one list that can hold the same title twice, which is what
 * `queueableIds` is about: the repeats are dropped so the queue can be walked
 * to its end at all.
 */
export function startQueue(
  seriesId: string,
  itemIds: string[],
  startWith?: string,
): PlayQueue | null {
  const ids = queueableIds(itemIds)
  if (ids.length === 0) return null
  const at = startWith ? ids.indexOf(startWith) : 0
  const queue: PlayQueue = { seriesId, ids, index: at === -1 ? 0 : at, shuffled: false }
  write(queue)
  return queue
}

/** The id a freshly started queue should play first. */
export function queueHead(queue: PlayQueue | null): string | null {
  return queue ? (queue.ids[queue.index] ?? null) : null
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

// ------------------------------------------------------------------ editing

/**
 * What an edit did: the queue as it now stands, and where playback belongs.
 *
 * `playTo` is null for the overwhelming majority of edits, because shuffling a
 * list around underneath someone is not a reason to change the picture. It is
 * only set when the edit removed the ground the viewer was standing on, or
 * when they asked to be taken somewhere.
 */
export interface QueueEdit {
  queue: PlayQueue | null
  playTo: string | null
}

/**
 * Re-point `index` at the episode that is actually on screen.
 *
 * Every edit here treats `index` as a reference to an *episode*, never to a
 * slot. Move something from below the playhead to above it and all the numbers
 * shift by one while the picture does not change; keeping the old number would
 * silently skip an episode the moment "next" is pressed. The fallback only
 * matters if the playing item somehow vanished without going through
 * `removeQueueItem`, and clamping beats an undefined id.
 */
function settle(queue: PlayQueue, ids: string[], playing: string): PlayQueue {
  const at = ids.indexOf(playing)
  return { ...queue, ids, index: at === -1 ? Math.min(queue.index, ids.length - 1) : at }
}

/**
 * Shift one item up (-1) or down (+1) the queue.
 *
 * Spreading the old queue rather than rebuilding one is what keeps `shuffled`
 * and `seriesId` intact: a reorder must not quietly end the shuffle, or the
 * player would go back to walking the series in order at the next episode
 * boundary and undo the whole thing.
 */
export function moveQueueItem(queue: PlayQueue, id: string, delta: number): QueueEdit {
  const from = queue.ids.indexOf(id)
  const to = from + delta
  // Off either end, or an id that has since been removed — both are ordinary
  // presses of a button the viewer can see, so neither is an error.
  if (from === -1 || to < 0 || to >= queue.ids.length) return { queue, playTo: null }
  const playing = queue.ids[queue.index]
  const ids = [...queue.ids]
  ids.splice(from, 1)
  ids.splice(to, 0, id)
  return { queue: settle(queue, ids, playing), playTo: null }
}

/**
 * Drop one item from the queue.
 *
 * Removing the episode currently playing is the case worth spelling out. The
 * answer is whatever slid into the vacated slot — the episode that was "next"
 * — because that is what pressing next a moment later would have done, and it
 * is the only choice that neither stops playback dead nor throws the viewer
 * back to the top of the queue. At the very end of the queue there is no such
 * episode, so it steps backwards onto the new last one instead.
 *
 * Removing the only item is different again: there is nowhere to go, so the
 * queue ends and playback is left exactly where it is. Yanking someone off the
 * episode they are watching is not what a remove button means.
 */
export function removeQueueItem(queue: PlayQueue, id: string): QueueEdit {
  const at = queue.ids.indexOf(id)
  if (at === -1) return { queue, playTo: null }
  const ids = queue.ids.filter((_, i) => i !== at)
  if (ids.length === 0) return { queue: null, playTo: null }
  const playing = queue.ids[queue.index]
  if (id !== playing) return { queue: settle(queue, ids, playing), playTo: null }
  const landing = Math.min(at, ids.length - 1)
  return { queue: { ...queue, ids, index: landing }, playTo: ids[landing] }
}

/**
 * Play a queued item now.
 *
 * `queueFor` would re-sync the index on arrival anyway, but moving it here
 * means the queue is already correct while the next episode loads, so a
 * mid-flight render cannot briefly offer the old "next".
 */
export function jumpToQueueItem(queue: PlayQueue, id: string): QueueEdit {
  const at = queue.ids.indexOf(id)
  if (at === -1) return { queue, playTo: null }
  return { queue: { ...queue, index: at }, playTo: id }
}

/*
  The stored counterparts. Each resolves the queue for the episode on screen,
  applies the pure edit and persists it, then hands back the id playback should
  move to — null meaning "stay put", which is almost always the answer.
*/

function edit(
  itemId: string | undefined,
  apply: (queue: PlayQueue) => QueueEdit,
): string | null {
  const queue = queueFor(itemId)
  if (!queue) return null
  const result = apply(queue)
  write(result.queue)
  return result.playTo
}

export function moveInQueue(itemId: string | undefined, id: string, delta: number): string | null {
  return edit(itemId, (queue) => moveQueueItem(queue, id, delta))
}

export function removeFromQueue(itemId: string | undefined, id: string): string | null {
  return edit(itemId, (queue) => removeQueueItem(queue, id))
}

export function jumpInQueue(itemId: string | undefined, id: string): string | null {
  return edit(itemId, (queue) => jumpToQueueItem(queue, id))
}
