import { useEffect, useRef } from 'react'
import { dehydrate, hydrate, useQueryClient } from '@tanstack/react-query'
import { idbDelete, idbGet, idbSet } from './idb'
import {
  isUsable,
  PERSIST_VERSION,
  persistKey,
  shouldPersistQuery,
  type StoredCache,
} from './queryPersistence'

/**
 * How long to wait after the cache changes before writing it.
 *
 * Opening a page fires several queries in quick succession, and each one
 * settling is a change. One write a few seconds later covers all of them.
 */
const WRITE_DELAY_MS = 4000

/**
 * Restores the query cache on boot and keeps it written down.
 *
 * `dehydrate` and `hydrate` are React Query's own, so nothing here has to
 * understand the cache's shape — only which queries belong in it and when it
 * has gone stale, both of which live in `queryPersistence.ts` and are tested.
 *
 * Every failure is swallowed. A cache is an optimisation; a browser in private
 * mode, a blocked database or a quota refusal should cost a viewer a moment's
 * wait, not an error.
 */
export function useQueryPersistence(server: string | undefined, userId: string | undefined) {
  const client = useQueryClient()
  const key = persistKey({ server, userId })
  /*
    Writing is held back until the restore has finished. A write that lands
    first would save this session's empty cache over the stored one, which is
    the one bug in this that a user would actually notice.
  */
  const restored = useRef(false)

  useEffect(() => {
    if (!key) return
    restored.current = false
    let cancelled = false

    idbGet<StoredCache>(key)
      .then((stored) => {
        if (cancelled) return
        if (isUsable(stored)) hydrate(client, stored!.state)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) restored.current = true
      })

    return () => {
      cancelled = true
    }
  }, [client, key])

  useEffect(() => {
    if (!key) return
    let timer: number | undefined

    const write = () => {
      if (!restored.current) return
      const state = dehydrate(client, {
        shouldDehydrateQuery: (query) =>
          // Successful only: persisting a failure would serve an error from
          // disk on the next launch, when the server may be perfectly fine.
          query.state.status === 'success' && shouldPersistQuery(query.queryKey),
      })
      const record: StoredCache = { savedAt: Date.now(), version: PERSIST_VERSION, state }
      void idbSet(key, record).catch(() => {})
    }

    const unsubscribe = client.getQueryCache().subscribe(() => {
      if (timer) clearTimeout(timer)
      timer = window.setTimeout(write, WRITE_DELAY_MS)
    })

    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [client, key])
}

/**
 * Removes the stored cache for one account.
 *
 * Called when someone signs out or hands the device over. Emptying the
 * in-memory cache is not enough: the copy on disk outlives the tab, and a
 * shared computer would keep describing the library of whoever left.
 */
export function clearPersistedCache(server: string | undefined, userId: string | undefined) {
  const key = persistKey({ server, userId })
  if (!key) return Promise.resolve()
  return idbDelete(key).catch(() => {})
}
