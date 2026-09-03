import { useEffect, useRef, useState } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { itemActions, type ItemActionId } from '../../lib/itemActions'
import { useCanManageCollections, useIsAdmin } from '../../lib/queries'
import { MoreIcon } from '../icons'

/**
 * The three-dot button on an item.
 *
 * Identify and the artwork picker used to be a section inside the metadata
 * form, which meant opening a form you did not want in order to reach the two
 * things you did. This is where hands already go, because it is where
 * Jellyfin's own client puts them.
 *
 * Renders nothing at all for a viewer who has no actions, rather than an
 * enabled button that opens an empty menu.
 */
export function ItemActionsMenu({
  item,
  onSelect,
  compact = false,
  align = 'left',
  className = '',
}: {
  item: BaseItemDto
  onSelect: (action: ItemActionId) => void
  /** For an episode row, where a full-size transport button would tower. */
  compact?: boolean
  /*
    Which edge the panel hangs from. It is wider than its button, so the side
    it opens towards has to be the side with room — right-aligned under the
    hero button, which sits near the left margin, put half the menu off-screen.
  */
  align?: 'left' | 'right'
  className?: string
}) {
  const isAdmin = useIsAdmin()
  const canManageCollections = useCanManageCollections()
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const actions = itemActions({ isAdmin, canManageCollections, item })

  /*
    Close on Escape and on a click elsewhere. `pointerdown` rather than
    `click`, so a press that starts outside the menu dismisses it before the
    thing underneath receives the release — otherwise dismissing the menu also
    activates whatever happened to be behind it.
  */
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (actions.length === 0) return null

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          compact
            ? 'flex size-7 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white'
            : 'flex size-11 items-center justify-center rounded-full border-2 border-white/40 bg-black/40 text-white transition hover:border-white'
        }
      >
        <MoreIcon className={compact ? 'size-4' : 'size-5'} />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-30 mt-2 w-64 overflow-hidden rounded-lg border border-white/10 bg-black/95 py-1.5 text-left shadow-2xl backdrop-blur ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {actions.map((action) => (
            <button
              key={action.id}
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onSelect(action.id)
              }}
              className="block w-full px-3 py-2 text-left transition hover:bg-white/10"
            >
              <span className="block text-sm">{action.label}</span>
              {action.hint && (
                <span className="mt-0.5 block text-[11px] leading-snug text-white/45">
                  {action.hint}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
