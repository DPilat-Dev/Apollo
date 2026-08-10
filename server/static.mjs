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
 * The file extension is what decides. Everything the build emits has one, so
 * refusing to fall back for extensioned paths fixes the case above without
 * touching routes.
 *
 * Requiring `Accept: text/html` as well was too strict and 404'd the site for
 * anything that does not send it — curl, health checks, link unfurlers, and
 * any client whose Accept header is rewritten in transit. A route is a route
 * whoever is asking, so only the extension is consulted.
 */
export function wantsSpaFallback(urlPath) {
  return path.extname(urlPath) === ''
}
