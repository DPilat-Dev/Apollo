import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs with no type declarations
import { wantsSpaFallback } from '../static.mjs'

const NAV = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
const MODULE = '*/*'

/**
 * Regression: every path that missed fell through to index.html, so a build
 * asset deleted by a deploy was answered with the page, at 200, under a .js
 * URL. Browsers reject HTML as a module script, so the entry chunk never ran
 * and the app rendered an empty black screen — and a caching proxy in front
 * kept serving that HTML for hours, so reloading did not help.
 */
describe('wantsSpaFallback', () => {
  it('serves the app for a deep link', () => {
    expect(wantsSpaFallback(NAV, '/item/abc123')).toBe(true)
    expect(wantsSpaFallback(NAV, '/settings')).toBe(true)
    expect(wantsSpaFallback(NAV, '/')).toBe(true)
  })

  it('refuses to answer a missing script with the page', () => {
    expect(wantsSpaFallback(MODULE, '/assets/index-OLDHASH.js')).toBe(false)
    expect(wantsSpaFallback(MODULE, '/assets/Player-OLDHASH.js')).toBe(false)
  })

  it('refuses even when the request claims to accept html', () => {
    // A stylesheet or a prefetch can send a navigation-like Accept; the
    // extension is what settles it.
    expect(wantsSpaFallback(NAV, '/assets/index-OLDHASH.js')).toBe(false)
    expect(wantsSpaFallback(NAV, '/assets/index-OLDHASH.css')).toBe(false)
  })

  it('does not answer non-navigation requests with the page', () => {
    // fetch/XHR for a path that does not exist should 404, not get HTML.
    expect(wantsSpaFallback(MODULE, '/api/nope')).toBe(false)
    expect(wantsSpaFallback(undefined, '/item/abc')).toBe(false)
  })

  it('still 404s missing images and fonts', () => {
    expect(wantsSpaFallback(MODULE, '/icons.svg')).toBe(false)
    expect(wantsSpaFallback(NAV, '/fonts/inter.woff2')).toBe(false)
  })
})
