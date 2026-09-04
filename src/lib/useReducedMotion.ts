import { useSyncExternalStore } from 'react'
import { REDUCED_MOTION_QUERY, resolveMotion } from './motion'
import { useSettings } from './settings'

/*
  Created once, lazily, and kept: a MediaQueryList is cheap but not free, and
  `useSyncExternalStore` compares snapshots by identity — a new list per call
  would mean a new listener per render.
*/
let query: MediaQueryList | null = null

function mediaQuery(): MediaQueryList | null {
  if (query) return query
  // `matchMedia` is missing under the test runner and in any non-browser host.
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  query = window.matchMedia(REDUCED_MOTION_QUERY)
  return query
}

function subscribe(onChange: () => void) {
  const mq = mediaQuery()
  if (!mq) return () => {}
  // `addEventListener` on a MediaQueryList is not universal; Safari only
  // learned it in 14, and the deprecated `addListener` is what it had before.
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }
  mq.addListener(onChange)
  return () => mq.removeListener(onChange)
}

function systemPrefersReduced(): boolean {
  return mediaQuery()?.matches ?? false
}

/**
 * Whether this viewer wants less movement — the setting and the machine,
 * resolved into one answer.
 *
 * Every animated thing in the app reads this rather than the raw setting, so
 * turning the preference on in the operating system is enough on its own.
 */
export function useReducedMotion(): boolean {
  const { motion } = useSettings()
  const system = useSyncExternalStore(subscribe, systemPrefersReduced, () => false)
  return resolveMotion(motion, system)
}
