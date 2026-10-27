import { useEffect, useRef } from 'react'
import { FOCUSABLE_SELECTOR, isDismissKey } from './dialogFocus'

/**
 * Escape and click-away for a popup that hangs off its own trigger — the item
 * ⋮ menu, the header's account menu, the phone nav drawer.
 *
 * Not `useDialog`: none of these is modal. The page behind them is still live
 * and a click anywhere dismisses them, so a focus trap would hold a keyboard
 * inside a menu that a pointer can leave freely, and `aria-modal` would be a
 * claim about the rest of the page that is not true.
 *
 * It exists because only one of the three had any of this. The ⋮ menu closed on
 * Escape and on a press elsewhere; the account menu and the nav drawer closed
 * only on an outside *click*, which is to say that a keyboard could open either
 * one and had no way to shut it again — Escape did nothing and Tab walked on
 * through the page with the menu still over it. Each had been written
 * separately, which is how two of them came to be missing the half that
 * `keydown` covers.
 *
 * ── Why pointerdown and not click ─────────────────────────────────────────
 *
 * A press that starts outside the popup dismisses it before whatever is under
 * the pointer receives the release — otherwise dismissing the menu also
 * activates the thing behind it. This is what the ⋮ menu already did, and it
 * replaces the invisible full-screen `<div>` the header's two popups used to
 * catch outside clicks with, which caught the release and so had exactly that
 * problem.
 */
export function usePopupDismiss({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  /** Put on the element wrapping *both* the trigger and the popup. */
  const wrap = useRef<HTMLDivElement | null>(null)

  // Through a ref, because every caller passes an inline arrow: as a dependency
  // it would tear the listeners down and rebuild them on every render of the
  // header, which re-renders on every scroll.
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) closeRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (!isDismissKey(e.key)) return
      const node = wrap.current
      /*
        Focus first, close second. The popup is about to be unmounted, and
        focus inside a removed node is dropped on `<body>` — the top of the
        document, which is where Escape would otherwise leave anyone who had
        tabbed into the menu. The trigger is the first focusable thing in the
        wrapper by construction: it is the element the popup hangs off, and the
        popup is rendered after it.
      */
      if (node?.contains(document.activeElement)) {
        node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus()
      }
      closeRef.current()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return wrap
}
