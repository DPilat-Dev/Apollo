import { useEffect, useId, useRef } from 'react'
import { FOCUSABLE_SELECTOR, initialFocus, isDismissKey, trapTarget } from './dialogFocus'

/**
 * Turns a `<div>` covering the screen into a dialog.
 *
 * Escape closes it, Tab cycles inside it instead of walking out into the page
 * behind, assistive technology is told what it is, and closing hands focus back
 * to whatever opened it. The decisions are in `dialogFocus.ts`, which is tested;
 * this is the part that needs a document.
 *
 * The listener lives on the dialog element rather than on `document` so nesting
 * works: an Escape inside an inner dialog closes the inner one and stops there,
 * where two document-level handlers would both fire and close both.
 */
export function useDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const titleId = useId()

  /*
    Through a ref, because callers pass an inline arrow. As a dependency it
    would tear this effect down on every render of the parent, and the setup
    moves focus — so the dialog would snap back to its first field each time
    anything above it re-rendered.
  */
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const node = ref.current
    if (!node) return

    // Captured before focus is moved, so it is the control that opened this.
    const opener = document.activeElement

    initialFocus(focusablesIn(node), node).focus()

    return () => {
      // Back to the opener, if it is still on the page — a dialog that deleted
      // the thing that opened it leaves nothing to return to, and focusing a
      // detached node silently sends focus to the body instead.
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isDismissKey(e.key)) {
      e.stopPropagation()
      closeRef.current()
      return
    }
    if (e.key !== 'Tab' || !ref.current) return

    const target = trapTarget({
      items: focusablesIn(ref.current),
      active: document.activeElement instanceof HTMLElement ? document.activeElement : null,
      backwards: e.shiftKey,
    })
    // Null is the usual answer: the browser's own Tab order is correct in the
    // middle of the cycle and only the ends need intercepting.
    if (target) {
      e.preventDefault()
      target.focus()
    }
  }

  return {
    titleId,
    /** Spread onto the dialog element. */
    dialogProps: {
      ref,
      role: 'dialog' as const,
      'aria-modal': true,
      'aria-labelledby': titleId,
      // Focusable by script so an empty dialog can still hold focus, but not
      // by Tab — it must not join the cycle it defines.
      tabIndex: -1,
      onKeyDown,
    },
  }
}

function focusablesIn(node: HTMLElement): HTMLElement[] {
  return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    // A control inside a collapsed section is in the DOM and cannot be reached;
    // offsetParent is null for anything `display: none` has taken out of flow.
    (el) => el.offsetParent !== null || el === node,
  )
}
