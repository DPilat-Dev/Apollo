import { useEffect, useId, useRef } from 'react'
import { FOCUSABLE_SELECTOR, initialFocus, isDismissKey, trapTarget } from './dialogFocus'
import {
  SCROLLBAR_GAP_PROPERTY,
  acquireScrollLock,
  releaseScrollLock,
  scrollbarGap,
} from './scrollLock'

/**
 * Turns a `<div>` covering the screen into a dialog.
 *
 * Escape closes it, Tab cycles inside it instead of walking out into the page
 * behind, assistive technology is told what it is, the page behind it does not
 * scroll, and closing hands focus back to whatever opened it. The decisions are
 * in `dialogFocus.ts` and `scrollLock.ts`, which are tested; this is the part
 * that needs a document.
 *
 * The scroll lock is here rather than in `Modal` — which is where it was
 * reported, from the phone Filters sheet — because `Modal` is six of the ten
 * dialogs in this app and the other four (the trailer, the shortcuts sheet,
 * Add to playlist, Add to collection) build the same overlay around this hook
 * instead. This is the one thing every dialog has in common, and a fix in
 * `Modal` would have left four of them scrolling the page behind the backdrop.
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

  /*
    Nothing behind a dialog moves while it is open. Measured on the phone
    Filters sheet at 390×844: a drag on the dimmed backdrop scrolled the grid
    underneath from 0 to 500px while the sheet stayed put, because `body`
    computed to `overflow: hidden auto` — `index.css` locks the x-axis and
    nothing locked the y. On a handset that is a swipe on the dim area taking
    the list you were reading off the screen while the dialog asking about it
    stays.

    `scrollLock` says why the dialogs are counted rather than flagged, and why
    the width of the vanished scrollbar is handed back as padding.
  */
  useEffect(() => {
    // Already locked by a dialog underneath this one: take a share of the count
    // and leave the page exactly as that dialog left it.
    if (!acquireScrollLock()) {
      return () => {
        releaseScrollLock()
      }
    }

    const { body } = document
    /*
      The inline values, not the computed ones, and restored verbatim. `body`
      carries `overflow-x: hidden` from the stylesheet, so writing a computed
      `hidden auto` back would bake a one-off into the element and quietly take
      that rule out of the stylesheet's hands forever.
    */
    const overflow = body.style.overflow
    const paddingRight = body.style.paddingRight
    const gap = scrollbarGap(window.innerWidth, document.documentElement.clientWidth)

    body.style.overflow = 'hidden'
    if (gap > 0) {
      body.style.paddingRight = `${gap}px`
      // For the fixed chrome, which is laid out against the viewport and so
      // cannot be held still by padding the page. See `scrollLock`.
      document.documentElement.style.setProperty(SCROLLBAR_GAP_PROPERTY, `${gap}px`)
    }

    return () => {
      releaseScrollLock()
      body.style.overflow = overflow
      body.style.paddingRight = paddingRight
      document.documentElement.style.removeProperty(SCROLLBAR_GAP_PROPERTY)
    }
  }, [])

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
