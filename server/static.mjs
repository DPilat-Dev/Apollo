import path from 'node:path'

/**
 * Should a request that matched no file fall through to index.html?
 *
 * Only navigations should. A build asset that has gone missing — which happens
 * to every device still holding the previous index.html the moment a new build
 * replaces dist — must 404 rather than be answered with the page.
 *
 * Answering it with the page is silent and severe. The browser refuses HTML as
 * a module script, so the entry chunk never evaluates, React never mounts, and
 * the user gets an empty black screen with nothing to report. Worse, the reply
 * is a 200, so a caching proxy stores that HTML under the .js URL and keeps
 * serving it long after the deploy — reloading does not clear it.
 *
 * Module and asset requests send `Accept: *​/*`; navigations ask for text/html.
 * Anything carrying a file extension is a file request whatever it claims.
 */
export function wantsSpaFallback(accept, urlPath) {
  if (path.extname(urlPath) !== '') return false
  return (accept ?? '').includes('text/html')
}
