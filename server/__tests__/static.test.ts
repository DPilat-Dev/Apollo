import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs with no type declarations
import { KNOWN_EXTENSIONS, contentTypeFor, wantsSpaFallback } from '../static.mjs'

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

    const unknown = [...new Set(walk('dist').map((f) => extname(f).toLowerCase()))]
      .filter((ext) => ext && !KNOWN_EXTENSIONS.includes(ext))
    expect(unknown, `dist contains extensions the server cannot name: ${unknown.join(', ')}`).toEqual([])
  })
})
