import { useEffect, useRef } from 'react'
import { isDismissKey } from './dialogFocus'

/**
 * Escape for things that are dismissible but not modal — the player's menus,
 * the queue panel.
 *
 * No focus trap and no `role`: a popover is not modal, the page behind it is
 * still live, and pretending otherwise would trap a keyboard in a menu that a
 * click anywhere dismisses.
 */
export function useDismissOnEscape(onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isDismissKey(e.key)) closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [])
}
