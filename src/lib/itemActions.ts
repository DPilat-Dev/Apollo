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
export type ItemActionId = 'playlist' | 'remote' | 'edit' | 'identify' | 'artwork' | 'refresh'

export interface ItemAction {
  id: ItemActionId
  label: string
  /** Shown under the label where the action needs a caveat. */
  hint?: string
}

export function itemActions(input: {
  isAdmin: boolean
  item: BaseItemDto | undefined
}): ItemAction[] {
  const { isAdmin, item } = input
  if (!item?.Id) return []

  /*
    Everyone's actions first. These moved off the hero row because that row is
    for the things you came to the page to do — play it, shuffle it, mark it —
    and a row that keeps growing stops reading as a row of choices.
  */
  const actions: ItemAction[] = [
    { id: 'playlist', label: 'Add to playlist' },
    {
      id: 'remote',
      label: 'Play on another device',
      hint: 'Send this to a TV or phone that is signed in',
    },
  ]

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
export function hasItemActions(input: { isAdmin: boolean; item: BaseItemDto | undefined }): boolean {
  return itemActions(input).length > 0
}
