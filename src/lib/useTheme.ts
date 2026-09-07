import { useSyncExternalStore } from 'react'
import { LIGHT_THEME_QUERY, resolveTheme } from './theme'
import { useSettings } from './settings'

let query: MediaQueryList | null = null

function mediaQuery(): MediaQueryList | null {
  if (query) return query
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  query = window.matchMedia(LIGHT_THEME_QUERY)
  return query
}

function subscribe(onChange: () => void) {
  const mq = mediaQuery()
  if (!mq) return () => {}
  if (typeof mq.addEventListener === 'function') {
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }
  mq.addListener(onChange)
  return () => mq.removeListener(onChange)
}

const systemPrefersLight = () => mediaQuery()?.matches ?? false

/** The palette to paint — the setting and the machine, resolved into one. */
export function useTheme(): 'light' | 'dark' {
  const { theme } = useSettings()
  const system = useSyncExternalStore(subscribe, systemPrefersLight, () => false)
  return resolveTheme(theme, system)
}
