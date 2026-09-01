import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'

/**
 * Marking a whole season or series watched.
 *
 * Jellyfin has no bulk playstate route: `POST /UserPlayedItems/{id}` takes one
 * item, so a 62-episode show is 62 writes. Pointing it at the folder instead
 * relies on the server sweeping the children itself — behaviour this client
 * cannot see, cannot count and cannot report on, which is exactly what went
 * wrong before: the button fired once, said nothing, and left the viewer to
 * guess from the unwatched badge whether anything had happened.
 *
 * So the fan-out happens here, where three things can be true at once: only a
 * handful of requests are ever in flight, the count climbs while it runs, and
 * a run that half-finished says so. Every decision the buttons make lives in
 * this file rather than in the components, because a decision inside a
 * component is a decision nothing tests.
 */

/**
 * How many playstate writes are allowed in flight at once.
 *
 * Small on purpose. Firing all 62 at a home server — often the same box doing
 * the transcoding — is hostile, and the browser would queue them anyway; all
 * an unbounded burst buys is a longer stall before the first result.
 */
export const PLAYED_BATCH_SIZE = 5

/**
 * Everything a change of watched state moves.
 *
 * Shared with the single-item toggle so the two cannot drift apart. `nextUp`
 * belongs here even though `useRemoveFromResume` deliberately omits it:
 * dropping a resume position changes only where you got to, while played state
 * is the very thing Next Up is computed from. `resume` belongs here for a
 * subtler reason — the server's MarkPlayed resets the playback position as a
 * side effect, so Continue Watching empties whether or not that was asked for.
 */
export const PLAYED_QUERY_KEYS = [
  'item',
  'itemsRow',
  'episodes',
  'seasons',
  'resume',
  'nextUp',
  'latest',
  'library',
  'browse',
  'searchByLibrary',
] as const

/**
 * Splits a list into runs of at most `size`.
 *
 * A size of zero would spin forever appending empty runs, and the size arrives
 * here as an argument, so it is floored at one rather than trusted.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += step) out.push(items.slice(i, i + step))
  return out
}

/** Which episode list backs a folder, or null if the item has no children. */
export function episodeQueryFor(
  item: BaseItemDto | undefined,
): { seriesId: string; seasonId: string | undefined } | null {
  if (!item?.Id) return null
  if (item.Type === 'Series') return { seriesId: item.Id, seasonId: undefined }
  // A season without a SeriesId cannot be narrowed, and falling back to "every
  // episode" would quietly mark the whole show from a single season's button.
  if (item.Type === 'Season' && item.SeriesId) {
    return { seriesId: item.SeriesId, seasonId: item.Id }
  }
  return null
}

/** Whether this item's watched button should mark everything inside it. */
export function bulkPlayedTarget(item: BaseItemDto | undefined): boolean {
  return episodeQueryFor(item) !== null
}

/**
 * The episodes that actually need a request.
 *
 * Skipping the ones already in the wanted state is what makes a retry after a
 * partial failure cost only what failed, and what makes the button cheap on a
 * show that is nearly finished. Virtual episodes are left out because there is
 * no file behind them — the server's own recursive sweep skips them too, and
 * marking an unaired episode watched is a lie the unwatched count then repeats.
 */
export function idsNeedingPlayedChange(
  episodes: readonly BaseItemDto[] | undefined,
  played: boolean,
): string[] {
  const seen = new Set<string>()
  for (const ep of episodes ?? []) {
    if (!ep.Id || ep.LocationType === 'Virtual') continue
    if (Boolean(ep.UserData?.Played) === played) continue
    seen.add(ep.Id)
  }
  return [...seen]
}

/** How many of the episodes about to be written are part-watched. */
export function partWatchedCount(
  episodes: readonly BaseItemDto[] | undefined,
  ids: readonly string[],
): number {
  const wanted = new Set(ids)
  return (episodes ?? []).filter(
    (ep) => ep.Id && wanted.has(ep.Id) && (ep.UserData?.PlaybackPositionTicks ?? 0) > 0,
  ).length
}

export interface BulkPlayedProgress {
  done: number
  total: number
}

export interface BulkPlayedOutcome {
  /** How many episodes the run set out to write. */
  total: number
  succeeded: number
  /** The ids that failed, so a retry can be reasoned about. */
  failed: string[]
  /** True when the run stopped early because nothing was getting through. */
  abandoned: boolean
  played: boolean
  /** True when the viewer declined the confirmation, so nothing was sent. */
  cancelled?: boolean
}

/** The outcome of a run the viewer called off, so nothing was sent. */
export function bulkPlayedCancelled(total: number, played: boolean): BulkPlayedOutcome {
  return { total, succeeded: 0, failed: [], abandoned: false, played, cancelled: true }
}

/** What to call the thing in a confirmation, with the show named where it helps. */
export function bulkPlayedName(item: BaseItemDto | undefined): string | null {
  if (!item) return null
  // "Season 2" alone is meaningless in a modal dialog that could have come from
  // any tab; "Breaking Bad Season 2" is not.
  if (item.Type === 'Season' && item.SeriesName && item.Name) {
    return `${item.SeriesName} ${item.Name}`
  }
  return item.Name ?? null
}

/**
 * Writes played state for every id, a few at a time.
 *
 * Partial failure is the ordinary case, not the edge case: one 500 in the
 * middle of sixty writes must not abandon the rest, so failures are collected
 * and the run continues. The exception is a first batch that fails outright —
 * an expired token or a server that has gone away fails everything, and sixty
 * more doomed requests only make the wait longer before the same bad news.
 */
export async function markAllPlayed(input: {
  ids: readonly string[]
  played: boolean
  mark: (id: string, played: boolean) => Promise<unknown>
  onProgress?: (progress: BulkPlayedProgress) => void
  batchSize?: number
}): Promise<BulkPlayedOutcome> {
  const { ids, played, mark, onProgress, batchSize = PLAYED_BATCH_SIZE } = input
  const total = ids.length
  const failed: string[] = []
  let succeeded = 0
  let attempted = 0
  let abandoned = false

  for (const batch of chunk(ids, batchSize)) {
    const results = await Promise.allSettled(batch.map((id) => mark(id, played)))
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') succeeded += 1
      else failed.push(batch[i])
    })
    attempted += batch.length
    onProgress?.({ done: attempted, total })

    if (succeeded === 0 && attempted < total) {
      abandoned = true
      break
    }
  }

  return { total, succeeded, failed, abandoned, played }
}

/**
 * The whole run, from a folder to an outcome.
 *
 * Everything the server does is injected, so the sequence itself — which
 * episode list to ask for, what to skip, when to stop and ask, when to start
 * reporting progress — is testable without a server or a rendered component.
 * That sequence used to be the part nothing covered, and the season case is
 * where it hurts: reading the series' episodes instead of the season's marks a
 * whole show watched from one poster.
 */
export async function runBulkPlayed(input: {
  item: BaseItemDto
  played: boolean
  listEpisodes: (seriesId: string, seasonId: string | undefined) => Promise<BaseItemDto[]>
  mark: (id: string, played: boolean) => Promise<unknown>
  confirm: (message: string) => boolean
  onProgress?: (progress: BulkPlayedProgress) => void
  batchSize?: number
}): Promise<BulkPlayedOutcome> {
  const { item, played, listEpisodes, mark, confirm, onProgress, batchSize } = input

  const target = episodeQueryFor(item)
  if (!target) throw new Error('Only a season or a series can be marked in bulk')

  const episodes = await listEpisodes(target.seriesId, target.seasonId)
  const ids = idsNeedingPlayedChange(episodes, played)

  const prompt = bulkPlayedConfirmation({
    name: bulkPlayedName(item),
    count: ids.length,
    played,
    resumingCount: partWatchedCount(episodes, ids),
  })
  if (prompt && !confirm(prompt)) return bulkPlayedCancelled(ids.length, played)

  // Reported before the first request rather than after the first batch, so
  // the button says what it is doing the instant it is pressed.
  onProgress?.({ done: 0, total: ids.length })

  return markAllPlayed({ ids, played, mark, onProgress, batchSize })
}

const plural = (n: number) => (n === 1 ? 'episode' : 'episodes')
const state = (played: boolean) => (played ? 'watched' : 'unwatched')

/**
 * What to tell the viewer afterwards.
 *
 * A partial write never reads as success. Showing "done" over a half-marked
 * show is the worst outcome available here: the counts stay wrong, Next Up
 * still points at an episode already seen, and nothing suggests trying again.
 */
export function bulkPlayedMessage(outcome: BulkPlayedOutcome): string | null {
  if (outcome.cancelled) return null
  if (outcome.total === 0) return `Already ${state(outcome.played)}.`

  if (outcome.succeeded === 0 && (outcome.abandoned || outcome.failed.length > 0)) {
    return "Couldn't reach the server — nothing was marked."
  }

  if (outcome.failed.length > 0) {
    return (
      `Marked ${outcome.succeeded} of ${outcome.total} episodes ${state(outcome.played)}. ` +
      `${outcome.failed.length} failed — try again to finish the rest.`
    )
  }

  return `Marked ${outcome.succeeded} ${plural(outcome.succeeded)} ${state(outcome.played)}.`
}

/**
 * The label while it runs. Several seconds of a disabled button with no
 * changing text is indistinguishable from a frozen page, so this counts.
 */
export function bulkPlayedProgressLabel(
  progress: BulkPlayedProgress | null | undefined,
  played: boolean,
): string | null {
  if (!progress) return null
  return `Marking ${state(played)}… ${progress.done}/${progress.total}`
}

/**
 * Whether to stop and ask first, and what to ask.
 *
 * There is no undo. Unwatching a show discards watched state, play counts and
 * dates for every episode in it, and a mis-click on a season poster is enough
 * to do it — so that always asks. Marking watched is the everyday action and
 * must not nag, with one exception: the server resets the playback position as
 * it goes, so a part-watched episode loses where the viewer had got to. That is
 * the only thing a later "mark unwatched" cannot give back.
 */
export function bulkPlayedConfirmation(input: {
  name?: string | null
  count: number
  played: boolean
  resumingCount: number
}): string | null {
  if (input.count <= 1) return null

  const what = input.name
    ? `all ${input.count} episodes of ${input.name}`
    : `all ${input.count} episodes`

  if (!input.played) {
    return (
      `Mark ${what} unwatched? This clears watched state and play counts for ` +
      `every one of them, and cannot be undone.`
    )
  }

  if (input.resumingCount > 0) {
    const n = input.resumingCount
    return (
      `Mark ${what} watched? ${n} ${plural(n)} ${n === 1 ? 'is' : 'are'} part-watched and ` +
      `will lose ${n === 1 ? 'its' : 'their'} position.`
    )
  }

  return null
}

/**
 * Whether the outcome has to be spelled out, or whether the badges that just
 * refreshed already say it.
 *
 * A clean run needs no notice on a crowded season poster — the unwatched count
 * disappearing is the confirmation. A run that failed does, every time.
 */
export function bulkPlayedNeedsAttention(outcome: BulkPlayedOutcome | undefined): boolean {
  if (!outcome || outcome.cancelled) return false
  return outcome.abandoned || outcome.failed.length > 0
}

/**
 * Whether the caches need refetching.
 *
 * Nothing written means nothing to refetch, and invalidating anyway re-renders
 * every row in the app to show the state it already had. An outright throw is
 * the one case that must refetch regardless: the run got far enough to fail,
 * and there is no telling what landed before it did.
 */
export function shouldInvalidateAfter(outcome: BulkPlayedOutcome | undefined): boolean {
  if (!outcome) return true
  return outcome.succeeded > 0
}
