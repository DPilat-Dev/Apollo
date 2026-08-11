/**
 * Registers the service worker, scoped to wherever the app is served from.
 *
 * Deliberately not registered on the hosted demo: that page is a shop window
 * people visit once, and leaving a worker installed on github.io would keep
 * serving them a cached Apollo long after they had finished looking.
 */
export function registerServiceWorker() {
  if (import.meta.env.DEV || import.meta.env.VITE_DEMO) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() => {
        // Not being able to register costs offline support and nothing else.
      })
  })
}
