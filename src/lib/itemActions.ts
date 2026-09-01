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
export type ItemActionId = 'edit' | 'identify' | 'artwork' | 'refresh'

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
  // Every entry here is an elevated endpoint. The menu is only rendered for an
  // admin, but the list refuses to name them regardless of who rendered it —
  // a gate that depends on its caller is a gate waiting to be moved.
  if (!isAdmin || !item?.Id) return []

  const actions: ItemAction[] = [{ id: 'edit', label: 'Edit metadata' }]

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
