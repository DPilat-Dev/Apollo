import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs with no type declarations
import { wantsSpaFallback } from '../static.mjs'

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
