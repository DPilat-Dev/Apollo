import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { canIdentify } from './identify'
import { canEditArtwork } from './artwork'

/**
 * What the overflow menu on an item offers.
 *
 * These used to be one "Edit" button that opened the metadata form, with
 * Identify and the artwork picker buried inside it as a section. That put two
 * of the three things an admin actually comes here for behind a form they did
 * not want to open, and it is not where anyone looks for them — Jellyfin's own
 * client puts the lot behind the three-dot button, so that is where hands
 * already go.
 *
 * The list is computed rather than written out in the component because which
 * entries apply depends on the item's type and on who is asking, and a menu
 * that offers a dead entry is worse than one that is shorter.
 */
export type ItemActionId =
  | 'playlist'
  | 'collection'
  | 'remote'
  | 'edit'
  | 'identify'
  | 'artwork'
  | 'refresh'

export interface ItemAction {
  id: ItemActionId
  label: string
  /** Shown under the label where the action needs a caveat. */
  hint?: string
}

export function itemActions(input: {
  isAdmin: boolean
  /*
    Deliberately its own input rather than something derived from `isAdmin`.
    Collections are governed by their own per-user permission on the server —
    see `canManageCollections` — so the two answers genuinely differ.

    Required, with no default, on purpose: an optional flag would let the
    component that renders the menu forget to pass it and quietly lose the
    entry for everyone, with nothing failing anywhere. Made mandatory, that
    mistake is a type error instead.
  */
  canManageCollections: boolean
  item: BaseItemDto | undefined
}): ItemAction[] {
  const { isAdmin, item } = input
  if (!item?.Id) return []

  /*
    Everyone's actions first. These moved off the hero row because that row is
    for the things you came to the page to do — play it, shuffle it, mark it —
    and a row that keeps growing stops reading as a row of choices.
  */
  const actions: ItemAction[] = [{ id: 'playlist', label: 'Add to playlist' }]

  // Next to the playlist entry, because filing something into a collection is
  // the same gesture and the hand is already there. It is not an admin action,
  // so it belongs above the gate rather than among the elevated entries.
  if (input.canManageCollections) {
    actions.push({
      id: 'collection',
      label: 'Add to collection',
      hint: 'Group this with other titles, or start a new collection',
    })
  }

  actions.push({
    id: 'remote',
    label: 'Play on another device',
    hint: 'Send this to a TV or phone that is signed in',
  })

  /*
    Everything below is an elevated endpoint. The admin entries are gated here
    rather than by whoever renders the menu — a gate that depends on its caller
    is a gate waiting to be moved.
  */
  if (!isAdmin) return actions

  actions.push({ id: 'edit', label: 'Edit metadata' })

  if (canIdentify({ isAdmin, item })) {
    actions.push({
      id: 'identify',
      label: 'Identify',
      hint: 'Match this against a different entry from a provider',
    })
  }
  if (canEditArtwork({ isAdmin, item })) {
    actions.push({ id: 'artwork', label: 'Edit images' })
  }

  actions.push({
    id: 'refresh',
    label: 'Refresh metadata',
    hint: 'Fetch anything missing, keeping what is already there',
  })

  return actions
}

/** Whether the three-dot button is worth drawing at all. */
export function hasItemActions(input: Parameters<typeof itemActions>[0]): boolean {
  return itemActions(input).length > 0
}
