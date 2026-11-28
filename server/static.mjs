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

/*
  ── Compression ───────────────────────────────────────────────────────────

  Apollo shipped for nineteen releases sending every byte of itself
  uncompressed. The reverse proxy in front of the author's own install hid
  half of it and made the other half worse: nginx's default `gzip_types` is
  `text/html` alone, so index.html arrived compressed and the 600 kB entry
  chunk, the 95 kB stylesheet, hls.js and the 2 MB of libass WebAssembly all
  arrived raw. Measured against the live deployment, a cold load moved 697 kB
  where 159 kB would have done.

  Compressed here rather than at the proxy for two reasons. The default
  install has no proxy at all — it is this file and nothing else — and a
  proxy that does compress has to do it per request, on a container sized at
  one core, for files that never change between deploys.

  So the build writes `.br` and `.gz` beside every compressible file once,
  at brotli 11, and this serves whichever one the browser asked for. The
  request-time cost is a `statSync` and the original `createReadStream`.
*/

/**
 * The encodings we can serve, in our order of preference.
 *
 * Brotli first because it is meaningfully smaller on this payload: the entry
 * chunk is 144 kB brotli against 172 kB gzip, and the libass module 668 kB
 * against 863 kB.
 */
export const ENCODINGS = [
  { name: 'br', ext: '.br' },
  { name: 'gzip', ext: '.gz' },
]

/**
 * Which files are worth compressing.
 *
 * By extension, deliberately: it is the same thing `contentTypeFor` keys on,
 * and the build has no other reliable signal. `.woff2` and the images are
 * absent because they are already compressed — woff2 came out 141.4 kB from
 * 142.6 kB, which is a second file on disk and a `Vary` for nothing.
 *
 * `.wasm` is here and matters most: it is the single largest thing Apollo
 * ever sends and it compresses 3.1×.
 */
const COMPRESSIBLE = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.webmanifest',
  '.svg',
  '.wasm',
  '.txt',
  '.map',
])

/**
 * Below this many bytes, don't bother.
 *
 * A gzip member carries 18 bytes of header and trailer and brotli a little
 * less, so the smallest files come out larger than they went in — and even
 * when they shrink, a file that fits in one packet either way is not made to
 * arrive sooner by being smaller. 512 is where the saving starts being more
 * than a rounding error on a single segment.
 */
export const COMPRESS_FLOOR_BYTES = 512

export function isCompressible(filePath, sizeBytes = Infinity) {
  const at = String(filePath).lastIndexOf('.')
  const ext = at === -1 ? '' : String(filePath).slice(at).toLowerCase()
  return COMPRESSIBLE.has(ext) && sizeBytes >= COMPRESS_FLOOR_BYTES
}

/** The precompressed siblings the build writes, for tests and tooling. */
export const VARIANT_EXTENSIONS = ENCODINGS.map((e) => e.ext)

/**
 * The encodings a client will accept, best first, filtered to ones we have.
 *
 * Hand-parsed rather than taken on trust, because the two cases that matter
 * are both refusals and both silent if ignored: `gzip;q=0` means a client
 * that lists gzip does not want it, and `*;q=0` means nothing beyond what is
 * named explicitly. Sending brotli to either one is a download of garbage
 * with a 200 on it.
 *
 * Ties are broken by our own preference above, not by the order the header
 * happens to be written in — `gzip, deflate, br` from Chrome is three equal
 * q=1 codings and brotli is the one to send.
 */
export function acceptedEncodings(header) {
  if (typeof header !== 'string' || !header.trim()) return []

  /** @type {Map<string, number>} */
  const q = new Map()
  for (const part of header.split(',')) {
    const [raw, ...params] = part.trim().split(';')
    const name = raw.trim().toLowerCase()
    if (!name) continue
    let weight = 1
    for (const p of params) {
      const m = /^\s*q\s*=\s*([0-9.]+)\s*$/i.exec(p)
      if (m) weight = Number.parseFloat(m[1])
    }
    q.set(name, Number.isFinite(weight) ? weight : 1)
  }

  const wildcard = q.get('*')
  const weightFor = (name) => {
    const explicit = q.get(name)
    if (explicit !== undefined) return explicit
    return wildcard ?? 0
  }

  return ENCODINGS.map((e) => ({ ...e, q: weightFor(e.name) }))
    .filter((e) => e.q > 0)
    .sort((a, b) => b.q - a.q || ENCODINGS.findIndex((e) => e.name === a.name) - ENCODINGS.findIndex((e) => e.name === b.name))
    .map((e) => e.name)
}

/**
 * The file to actually send, given what the client accepts.
 *
 * `exists` is injected so this is testable without a filesystem, and so the
 * server can hand it the same `existsSync` it uses everywhere else. A variant
 * that is missing is simply skipped: the build may not have written one, and
 * the original is always a correct answer.
 */
export function pickVariant(filePath, acceptHeader, exists) {
  for (const name of acceptedEncodings(acceptHeader)) {
    const { ext } = ENCODINGS.find((e) => e.name === name)
    const candidate = `${filePath}${ext}`
    if (exists(candidate)) return { path: candidate, encoding: name }
  }
  return { path: filePath, encoding: null }
}
