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

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  // Browsers ignore a manifest served as anything else, which silently costs
  // installability with nothing in the console to explain it.
  '.webmanifest': 'application/manifest+json',
  /*
    WebAssembly is refused outright when it is not served as this. The browser
    will not instantiate a streaming module with the wrong content type, so
    libass simply never started in production while working perfectly under
    the dev server, which sets the header itself.

    It was the only extension in a real build the map did not know.
  */
  '.wasm': 'application/wasm',
  // Fonts a build could emit that this map had no answer for either. A font
  // served as octet-stream mostly works and is not worth finding out about.
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * The content type for a file this server is about to send.
 *
 * Lives here rather than beside the handler so it can be tested. It was a bare
 * object in index.mjs with no export and no test, and it was missing `.wasm` —
 * which a browser refuses to instantiate WebAssembly from, so libass never
 * started in production while working perfectly under the dev server.
 *
 * Anything unknown falls back to octet-stream, which is right for a download
 * and wrong for anything the browser has rules about.
 */
export function contentTypeFor(filePath) {
  const at = String(filePath).lastIndexOf('.')
  const ext = at === -1 ? '' : String(filePath).slice(at).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

/** The extensions this server can name, for a test that walks a real build. */
export const KNOWN_EXTENSIONS = Object.keys(MIME)
