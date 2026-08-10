import { lazy, type ComponentType } from 'react'

const RELOAD_KEY = 'apollo.chunkReload'

// Private browsing can make sessionStorage throw on access, and losing the
// guard is not worth losing the recovery.
const flag = {
  get: () => {
    try {
      return sessionStorage.getItem(RELOAD_KEY) !== null
    } catch {
      return false
    }
  },
  set: () => {
    try {
      sessionStorage.setItem(RELOAD_KEY, '1')
    } catch {
      /* ignore */
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(RELOAD_KEY)
    } catch {
      /* ignore */
    }
  },
}

/**
 * `React.lazy`, but it survives a deployment.
 *
 * Chunk filenames carry a content hash, so publishing a new build deletes the
 * ones a already-open tab is still holding references to. The next lazy route
 * that tab visits requests a file that no longer exists.
 *
 * The document itself is the stale part, so the repair is to fetch it again.
 * Reload once — guarded, because a chunk that is genuinely unreachable (a
 * dead network, a truly broken deploy) must surface as an error rather than
 * spin in a reload loop.
 */
export function lazyWithReload<
  // Mirrors React.lazy's own constraint; narrowing it rejects valid components.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends ComponentType<any>,
>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await load()
      // Getting here means the chunk resolved, so any earlier reload worked.
      flag.clear()
      return mod
    } catch (err) {
      if (flag.get()) throw err
      flag.set()
      window.location.reload()
      // Leave the import pending; the reload replaces this document.
      return new Promise<{ default: T }>(() => {})
    }
  })
}
