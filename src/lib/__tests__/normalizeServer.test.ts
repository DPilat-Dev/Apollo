import { describe, expect, it } from 'vitest'
import { mixedContentBlocked, normalizeServer, unreachableMessage } from '../api'

describe('normalizeServer', () => {
  it('keeps a scheme that was typed, and trims', () => {
    expect(normalizeServer('  https://jf.example.com  ', 'https:')).toBe('https://jf.example.com')
    expect(normalizeServer('http://192.168.1.23:8096', 'http:')).toBe('http://192.168.1.23:8096')
  })

  it('drops trailing slashes, which would double up in every url built from it', () => {
    expect(normalizeServer('http://box:8096///', 'http:')).toBe('http://box:8096')
  })

  /*
    The fix this exists for. Apollo served over TLS and a bare `jellyfin.lan`
    produced `http://jellyfin.lan`, which the browser blocks as mixed content
    before the request leaves — reported as "Could not reach that server.
    Check the address…" about an address that was right. The page's own scheme
    is the one that can actually be fetched.
  */
  it('gives a bare hostname the scheme of the page it was typed on', () => {
    expect(normalizeServer('jellyfin.lan', 'https:')).toBe('https://jellyfin.lan')
    expect(normalizeServer('jellyfin.lan', 'http:')).toBe('http://jellyfin.lan')
  })

  // A scheme typed by hand is a decision, not a guess to be corrected. The
  // message explains it instead; rewriting it would hide what the viewer asked
  // for and make the failure impossible to understand.
  it('never rewrites a scheme somebody typed', () => {
    expect(normalizeServer('http://jellyfin.lan', 'https:')).toBe('http://jellyfin.lan')
    expect(normalizeServer('HTTP://jellyfin.lan', 'https:')).toBe('HTTP://jellyfin.lan')
  })

  // Anything other than http/https — a file:// page, or a scheme this code has
  // never heard of — falls back to http rather than building an address no
  // browser can fetch.
  it('falls back to http for a page served from anywhere else', () => {
    expect(normalizeServer('box:8096', 'file:')).toBe('http://box:8096')
  })

  /*
    Called the way the app calls it — with no protocol, so the default reads the
    page's own. Every other case here passes one explicitly, which left the
    defaulted path, the only one that ever runs in the browser, unexercised.
    There is no `location` in node, where the default falls back to http.
  */
  it('reads the page it is on when no scheme is given', () => {
    expect(normalizeServer('jellyfin.lan')).toBe('http://jellyfin.lan')
    expect(unreachableMessage('http://jellyfin.lan')).toContain('Check the address')
  })
})

describe('unreachableMessage', () => {
  // fetch rejects with the same bare TypeError for a dead host and for a
  // blocked request, so the only way to tell them apart is the pair of
  // schemes — and they need different sentences.
  it('names mixed content, which is the failure that is not about the address', () => {
    const message = unreachableMessage('http://jellyfin.lan', 'https:')
    expect(message).toContain('HTTPS')
    expect(message).not.toContain('Check the address')
  })

  it('keeps the general advice for everything else', () => {
    expect(unreachableMessage('https://jellyfin.lan', 'https:')).toContain('Check the address')
    expect(unreachableMessage('http://jellyfin.lan', 'http:')).toContain('Check the address')
  })
})

describe('mixedContentBlocked', () => {
  it('is only about an http target on an https page', () => {
    expect(mixedContentBlocked('http://box:8096', 'https:')).toBe(true)
    expect(mixedContentBlocked('https://box:8096', 'https:')).toBe(false)
    expect(mixedContentBlocked('http://box:8096', 'http:')).toBe(false)
  })
})
