import { describe, expect, it } from 'vitest'
import {
  COMPRESS_FLOOR_BYTES,
  ENCODINGS,
  KNOWN_EXTENSIONS,
  VARIANT_EXTENSIONS,
  acceptedEncodings,
  contentTypeFor,
  isCompressible,
  pickVariant,
  wantsSpaFallback,
  // @ts-expect-error — plain .mjs with no type declarations
} from '../static.mjs'

/**
 * Regression: every path that missed fell through to index.html, so a build
 * asset deleted by a deploy was answered with the page, at 200, under a .js
 * URL. Browsers reject HTML as a module script, so the entry chunk never ran
 * and the app rendered an empty black screen — and a caching proxy in front
 * kept serving that HTML for hours, so reloading did not help.
 */
describe('wantsSpaFallback', () => {
  it('serves the app for a route', () => {
    expect(wantsSpaFallback('/item/abc123')).toBe(true)
    expect(wantsSpaFallback('/settings')).toBe(true)
    expect(wantsSpaFallback('/')).toBe(true)
  })

  it('refuses to answer a missing script with the page', () => {
    expect(wantsSpaFallback('/assets/index-OLDHASH.js')).toBe(false)
    expect(wantsSpaFallback('/assets/Player-OLDHASH.js')).toBe(false)
    expect(wantsSpaFallback('/assets/index-OLDHASH.css')).toBe(false)
  })

  it('still 404s missing images and fonts', () => {
    expect(wantsSpaFallback('/icons.svg')).toBe(false)
    expect(wantsSpaFallback('/fonts/inter.woff2')).toBe(false)
    expect(wantsSpaFallback('/favicon.svg')).toBe(false)
  })

  /**
   * Regression: the rule also required `Accept: text/html`, so the site
   * returned 404 at the root to every client that does not send it.
   */
  it('does not depend on the Accept header', () => {
    expect(wantsSpaFallback('/')).toBe(true)
    expect(wantsSpaFallback('/library/v1')).toBe(true)
  })
})

/*
  The map was a bare object in index.mjs with no export and no test, and it was
  missing `.wasm`. A browser refuses to instantiate a streaming WebAssembly
  module served as anything but application/wasm, so libass never started in
  production — while working perfectly under the dev server, which sets the
  header itself. That gap is exactly the shape a test can close.
*/
describe('contentTypeFor', () => {
  it('names WebAssembly, which a browser will not run without it', () => {
    expect(contentTypeFor('/assets/jassub-worker-modern-D8KyP8li.wasm')).toBe('application/wasm')
  })

  it('names the everyday things', () => {
    expect(contentTypeFor('/index.html')).toMatch(/^text\/html/)
    expect(contentTypeFor('/assets/index-abc.js')).toMatch(/^text\/javascript/)
    expect(contentTypeFor('/assets/index-abc.css')).toMatch(/^text\/css/)
    expect(contentTypeFor('/manifest.webmanifest')).toBe('application/manifest+json')
  })

  it('is not fooled by a dot in a directory name', () => {
    expect(contentTypeFor('/my.assets/thing.wasm')).toBe('application/wasm')
  })

  it('does not care about case', () => {
    expect(contentTypeFor('/A.WASM')).toBe('application/wasm')
  })

  it('falls back for anything it does not know', () => {
    // Right for a download, wrong for anything the browser has rules about —
    // which is why the list has to keep up with what the build emits.
    expect(contentTypeFor('/thing.zzz')).toBe('application/octet-stream')
    expect(contentTypeFor('/no-extension')).toBe('application/octet-stream')
  })

  /*
    The guard that would have caught this before it shipped: every extension a
    real build produces must be one the server can name. Skipped when there is
    no build to look at, so it never fails for the wrong reason.
  */
  it('knows every extension the built app actually contains', async () => {
    const { existsSync, readdirSync, statSync } = await import('node:fs')
    const { join, extname } = await import('node:path')
    if (!existsSync('dist')) return

    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        return statSync(full).isDirectory() ? walk(full) : [full]
      })

    /*
      Precompressed siblings are excluded, not forgotten. `index.js.br` is
      never named by its own extension — the server sends it under the type of
      the file it sits beside, with a Content-Encoding header. Including them
      here would demand a MIME entry for `.br` that must not exist, because
      answering a .js request with `application/brotli` is how a browser is
      told to download the bundle instead of running it.
    */
    const files = walk('dist').filter((f) => !VARIANT_EXTENSIONS.includes(extname(f)))
    const unknown = [...new Set(files.map((f) => extname(f).toLowerCase()))]
      .filter((ext) => ext && !KNOWN_EXTENSIONS.includes(ext))
    expect(unknown, `dist contains extensions the server cannot name: ${unknown.join(', ')}`).toEqual([])
  })
})

/*
  Apollo sent every byte of itself uncompressed for nineteen releases. The
  proxy in front of the author's install hid the half that mattered least:
  nginx's default `gzip_types` is `text/html` alone, so the page arrived
  compressed while the 600 kB entry chunk, the 95 kB stylesheet, hls.js and
  2 MB of libass WebAssembly all arrived raw. Measured on the live site, a
  cold load moved 697 kB where 159 kB would have done.

  These are the two decisions in that fix that can be wrong silently.
*/
describe('acceptedEncodings', () => {
  it('prefers brotli when a browser offers both as equals', () => {
    // What Chrome actually sends. Three codings, all q=1, and the order in
    // the header is not a preference — ours is.
    expect(acceptedEncodings('gzip, deflate, br')).toEqual(['br', 'gzip'])
  })

  it('honours an explicit q ordering', () => {
    expect(acceptedEncodings('gzip;q=1.0, br;q=0.5')).toEqual(['gzip', 'br'])
    expect(acceptedEncodings('br;q=1.0, gzip;q=0.8')).toEqual(['br', 'gzip'])
  })

  /*
    The refusals. `q=0` means "not this one" — a client that lists gzip at
    q=0 and is sent gzip receives a 200 full of bytes it will not unwrap, and
    nothing in the exchange says so.
  */
  it('treats q=0 as a refusal, not a mention', () => {
    expect(acceptedEncodings('gzip;q=0, br')).toEqual(['br'])
    expect(acceptedEncodings('br;q=0, gzip')).toEqual(['gzip'])
    expect(acceptedEncodings('gzip;q=0, br;q=0')).toEqual([])
  })

  it('reads a wildcard, including a wildcard refusal', () => {
    expect(acceptedEncodings('*')).toEqual(['br', 'gzip'])
    // Everything not named explicitly is refused.
    expect(acceptedEncodings('*;q=0, gzip')).toEqual(['gzip'])
    expect(acceptedEncodings('*;q=0')).toEqual([])
  })

  it('sends the original when nothing is on offer', () => {
    expect(acceptedEncodings('identity')).toEqual([])
    expect(acceptedEncodings('deflate')).toEqual([])
    expect(acceptedEncodings('')).toEqual([])
    expect(acceptedEncodings('   ')).toEqual([])
    expect(acceptedEncodings(undefined)).toEqual([])
    expect(acceptedEncodings(null)).toEqual([])
  })

  it('does not care about case or whitespace', () => {
    expect(acceptedEncodings('  GZIP , BR ')).toEqual(['br', 'gzip'])
    expect(acceptedEncodings('  br ; q = 0.5 ,  gzip ')).toEqual(['gzip', 'br'])
  })

  /*
    A coding nobody named is not acceptable — RFC 9110 is explicit, and the
    absence of a wildcard is the whole signal. So `br;q=0` alone leaves
    nothing: br is refused and gzip was never offered.
  */
  it('does not invent a coding the client never offered', () => {
    expect(acceptedEncodings('br ; q = 0')).toEqual([])
    expect(acceptedEncodings('br')).toEqual(['br'])
  })

  it('ignores a malformed q rather than dropping the coding', () => {
    // A header we cannot read a weight from still named the coding, and
    // refusing to serve it over a typo is the worse failure.
    expect(acceptedEncodings('br;q=abc')).toEqual(['br'])
  })
})

describe('isCompressible', () => {
  it('takes the big text and WebAssembly', () => {
    // The wasm is the single largest thing Apollo ever sends, and the one
    // every ASS subtitle in a cold browser waits for.
    expect(isCompressible('/assets/jassub-worker-modern-D8KyP8li.wasm', 2_082_000)).toBe(true)
    expect(isCompressible('/assets/index-abc.js', 600_000)).toBe(true)
    expect(isCompressible('/assets/index-abc.css', 96_000)).toBe(true)
    expect(isCompressible('/index.html', 1_400)).toBe(true)
    expect(isCompressible('/manifest.webmanifest', 600)).toBe(true)
    expect(isCompressible('/icons.svg', 5_000)).toBe(true)
  })

  it('leaves alone what is already compressed', () => {
    // woff2 came out 141.4 kB from 142.6 kB — a second file on disk and a
    // Vary header for nothing.
    expect(isCompressible('/assets/default-jVcJgvWm.woff2', 142_600)).toBe(false)
    expect(isCompressible('/icon-512.png', 12_600)).toBe(false)
    expect(isCompressible('/poster.jpg', 50_000)).toBe(false)
  })

  it('skips files too small for it to matter', () => {
    expect(isCompressible('/assets/rolldown-runtime-abc.js', 600)).toBe(true)
    expect(isCompressible('/assets/rolldown-runtime-abc.js', 200)).toBe(false)
    expect(COMPRESS_FLOOR_BYTES).toBeGreaterThan(0)
  })

  it('does not compress its own output', () => {
    for (const ext of VARIANT_EXTENSIONS) {
      expect(isCompressible(`/assets/index-abc.js${ext}`, 150_000)).toBe(false)
    }
  })
})

describe('pickVariant', () => {
  const all = () => true
  const none = () => false

  it('sends the variant the client asked for', () => {
    expect(pickVariant('/dist/assets/a.js', 'gzip, deflate, br', all)).toEqual({
      path: '/dist/assets/a.js.br',
      encoding: 'br',
    })
    expect(pickVariant('/dist/assets/a.js', 'gzip', all)).toEqual({
      path: '/dist/assets/a.js.gz',
      encoding: 'gzip',
    })
  })

  /*
    The original is always a correct answer, and the reason this degrades
    rather than breaks: a build that skipped precompression, a file below the
    floor, and a client that wants none of it all land here.
  */
  it('falls back to the original when the variant is not on disk', () => {
    expect(pickVariant('/dist/assets/a.js', 'gzip, br', none)).toEqual({
      path: '/dist/assets/a.js',
      encoding: null,
    })
  })

  it('falls back to the original when nothing is accepted', () => {
    expect(pickVariant('/dist/assets/a.js', 'identity', all)).toEqual({
      path: '/dist/assets/a.js',
      encoding: null,
    })
    expect(pickVariant('/dist/assets/a.js', undefined, all)).toEqual({
      path: '/dist/assets/a.js',
      encoding: null,
    })
  })

  it('skips a missing first choice for a present second', () => {
    const onlyGzip = (p: string) => p.endsWith('.gz')
    expect(pickVariant('/dist/assets/a.js', 'gzip, deflate, br', onlyGzip)).toEqual({
      path: '/dist/assets/a.js.gz',
      encoding: 'gzip',
    })
  })

  it('names an encoding the HTTP header understands', () => {
    // 'br' and 'gzip' are the token values; 'brotli' is not one.
    expect(ENCODINGS.map((e: { name: string }) => e.name)).toEqual(['br', 'gzip'])
  })
})
