/*
  Apollo's service worker.

  Its caching rules are shaped by a bug this project already had: a stale
  index.html referencing chunk filenames that a deploy had deleted, which left
  an empty black screen because the entry script never evaluated.

  So the rules are deliberately asymmetric.

    Navigations   network first. The document decides which chunks to load,
                  so a stale one is the dangerous thing to serve. The cache is
                  a fallback for being offline, never a shortcut.

    Hashed assets cache first, safely. Their filenames contain a content hash,
                  so a cached copy can never be the wrong version of anything.

    Everything    left alone. API responses, images and video are the server's
    else          business, and caching them here would fight it.
*/

const VERSION = 'apollo-v1'
const SHELL = `${VERSION}-shell`
const ASSETS = `${VERSION}-assets`
const KEEP = new Set([SHELL, ASSETS])

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      /*
        Fetch the shell now rather than waiting for a navigation to store one.
        The load that installs this worker is not controlled by it, so without
        this the cache stays empty until the second visit — and the first time
        anyone needed it offline, there would be nothing there.
      */
      try {
        const res = await fetch(new Request('./', { cache: 'reload' }))
        if (res.ok) await (await caches.open(SHELL)).put('shell', res)
      } catch {
        // Installed offline; a later navigation will fill this in.
      }
      // Take over as soon as possible; there is no half-updated state to protect.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(names.filter((n) => !KEEP.has(n)).map((n) => caches.delete(n)))
      await self.clients.claim()
    })(),
  )
})

const isAsset = (url) =>
  url.origin === self.location.origin && /\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.(js|css)$/.test(url.pathname)

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Only ever handle this origin. The Jellyfin server is somewhere else and
  // its responses are not ours to store.
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request)
          const cache = await caches.open(SHELL)
          cache.put('shell', fresh.clone())
          return fresh
        } catch {
          // Offline: the last known document is better than a browser error,
          // and its chunks are in the asset cache alongside it.
          const cached = await caches.match('shell')
          return cached ?? Response.error()
        }
      })(),
    )
    return
  }

  if (isAsset(url)) {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request)
        if (cached) return cached
        const fresh = await fetch(request)
        // A 404 here means the deploy moved on; never store that.
        if (fresh.ok) {
          const cache = await caches.open(ASSETS)
          cache.put(request, fresh.clone())
        }
        return fresh
      })(),
    )
  }
})
