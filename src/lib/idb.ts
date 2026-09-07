/**
 * A single-record store in IndexedDB.
 *
 * The whole API this needs is get, put and delete on one key, so this is that
 * and nothing else — a wrapper library would be more code than the thing it
 * wraps.
 *
 * IndexedDB rather than localStorage because the value is a serialised query
 * cache and can reach a megabyte. localStorage caps at around five for the
 * whole origin, is synchronous, and blocks the main thread for every write.
 */

const DB_NAME = 'apollo'
const STORE = 'cache'
const DB_VERSION = 1

let open: Promise<IDBDatabase> | null = null

function db(): Promise<IDBDatabase> {
  if (open) return open
  open = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'))
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB refused to open'))
    /*
      Private browsing in some browsers, and a database blocked by another tab
      running an older version, both hang rather than erroring. A promise that
      never settles would leave the app waiting for a cache forever.
    */
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })
  // Not cached on failure: a later attempt should be allowed to try again
  // rather than inheriting one bad moment for the life of the page.
  open.catch(() => {
    open = null
  })
  return open
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const tx = database.transaction(STORE, mode)
        const request = work(tx.objectStore(STORE))
        request.onsuccess = () => resolve(request.result as T)
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
      }),
  )
}

export function idbGet<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>('readonly', (store) => store.get(key))
}

export function idbSet(key: string, value: unknown): Promise<void> {
  return run<void>('readwrite', (store) => store.put(value, key))
}

export function idbDelete(key: string): Promise<void> {
  return run<void>('readwrite', (store) => store.delete(key))
}
