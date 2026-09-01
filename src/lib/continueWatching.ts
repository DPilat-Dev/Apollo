import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'

/**
 * Dismissing a card from Continue Watching, decided before the server hears
 * about it.
 *
 * The row has to empty the moment the × is pressed — waiting for a round trip
 * and a refetch is long enough that the card is still sitting there when the
 * pointer leaves, which reads as the button having done nothing. That means
 * the cache is edited first and repaired if the request fails, so both the
 * optimistic list and the exact list to restore have to be worked out
 * together, from the same snapshot.
 */
export interface ResumeRemoval {
  /** What the row shows the instant the × is pressed. */
  next: BaseItemDto[]
  /** The snapshot to write back if the server refuses. */
  rollback: BaseItemDto[]
  /**
   * Whether anything actually came out. Nothing should be written to the cache
   * when it did not: there is no state to restore later, and a needless write
   * still re-renders every card in the row.
   */
  changed: boolean
}

export function planResumeRemoval(
  cached: readonly BaseItemDto[] | undefined,
  itemId: string | undefined,
): ResumeRemoval {
  // The query may not have resolved yet, and TanStack hands back undefined for
  // a key it has never filled.
  const list = Array.isArray(cached) ? cached : []
  const rollback = [...list]

  // Id is optional on BaseItemDto, so a missing id must match nothing rather
  // than every card that also happens to have none.
  if (!itemId) return { next: [...list], rollback, changed: false }

  const next = list.filter((i) => i.Id !== itemId)
  return { next, rollback, changed: next.length !== list.length }
}
