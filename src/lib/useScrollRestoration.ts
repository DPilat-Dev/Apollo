import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'
import { canRestore, createScrollMemory, scrollTargetFor, type NavKind } from './scrollMemory'

/**
 * How long to keep waiting for a grid to grow tall enough to scroll into.
 *
 * The items come from a query, so the page is one screen tall at the moment
 * the history entry pops. Two seconds covers a cold cache on a slow server;
 * past that the restore is abandoned rather than dropped on someone who has
 * given up waiting and started reading from the top.
 */
const RESTORE_TIMEOUT_MS = 2000
const RESTORE_POLL_MS = 50

/**
 * Puts you back where you were when you press back.
 *
 * The offset of every history entry is recorded as you scroll, and reapplied
 * when that entry is popped — once the page is tall enough to hold it, which
 * is the part the browser's own `scrollRestoration` cannot do here.
 */
export function useScrollRestoration() {
  const { key } = useLocation()
  const kind = useNavigationType() as NavKind
  const memory = useRef(createScrollMemory()).current

  /*
    Read by the scroll listener, which outlives any one location. A ref rather
    than a dependency: re-subscribing to scroll on every navigation would miss
    the events between the render and the effect.
  */
  const keyRef = useRef(key)
  keyRef.current = key

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      // Coalesced to one write a frame. Scroll fires far faster than that, and
      // this runs for the whole session.
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        memory.remember(keyRef.current, window.scrollY)
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [memory])

  useEffect(() => {
    const target = scrollTargetFor({ kind, remembered: memory.recall(key) })
    // Null means a REPLACE — the app rewriting its own entry, where moving the
    // page at all is the bug.
    if (target === null) return
    if (target === 0) {
      window.scrollTo(0, 0)
      return
    }

    let timer = 0
    const started = Date.now()
    const attempt = () => {
      const fits = canRestore({
        target,
        scrollHeight: document.documentElement.scrollHeight,
        viewportHeight: window.innerHeight,
      })
      if (fits) {
        window.scrollTo(0, target)
        return
      }
      if (Date.now() - started > RESTORE_TIMEOUT_MS) return
      timer = window.setTimeout(attempt, RESTORE_POLL_MS)
    }
    attempt()

    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [key, kind, memory])
}
