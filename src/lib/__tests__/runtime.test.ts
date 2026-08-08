import { describe, expect, it } from 'vitest'
import { normalizeTarget } from '../../../server/runtime.mjs'

/**
 * Regression: prefixing "http://" onto a value that already declared a scheme
 * turned file:///etc/passwd into http://file — a rejected scheme laundered
 * into a valid-looking proxy target.
 */
describe('normalizeTarget', () => {
  it('accepts a bare host and port', () => {
    expect(normalizeTarget('10.0.0.5:5055')).toBe('http://10.0.0.5:5055')
  })

  it('keeps https and strips any path', () => {
    expect(normalizeTarget('https://seerr.example/anything')).toBe('https://seerr.example')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeTarget('  http://ok:1  ')).toBe('http://ok:1')
  })

  it('refuses every scheme that is not http or https', () => {
    for (const value of [
      'file:///etc/passwd',
      'ftp://host/x',
      'gopher://host',
      'javascript:alert(1)',
      'data:text/html,<script>',
    ]) {
      expect(normalizeTarget(value)).toBeNull()
    }
  })

  it('refuses junk', () => {
    for (const value of ['', '   ', 'not a url', null, undefined, 42, {}]) {
      expect(normalizeTarget(value)).toBeNull()
    }
  })
})

/**
 * Regression: crypto.randomUUID is only defined in a secure context. Served
 * over plain HTTP on a LAN address it is undefined, and because deviceId() is
 * called from authHeader(), it threw before any authenticated request was
 * sent — so sign-in was impossible while unauthenticated calls still worked.
 */
describe('deviceId without a secure context', () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

  const withCrypto = async (impl: object | undefined, fn: () => void) => {
    const globals = globalThis as Record<string, unknown>
    const originalCrypto = globals.crypto
    const originalStorage = globals.localStorage
    const store = new Map<string, string>()
    globals.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    }
    // globalThis.crypto is a getter-only accessor in Node, so it has to be
    // redefined rather than assigned.
    Object.defineProperty(globalThis, 'crypto', {
      value: impl,
      configurable: true,
      writable: true,
    })
    try {
      fn()
    } finally {
      Object.defineProperty(globalThis, 'crypto', {
        value: originalCrypto,
        configurable: true,
        writable: true,
      })
      globals.localStorage = originalStorage
    }
  }

  it('produces a valid v4 uuid when randomUUID is missing', async () => {
    const { deviceId } = await import('../api')
    await withCrypto({ getRandomValues: (a: Uint8Array) => a.map(() => 7) }, () => {
      expect(deviceId()).toMatch(uuid)
    })
  })

  it('still produces one when crypto is absent entirely', async () => {
    const { deviceId } = await import('../api')
    await withCrypto(undefined, () => {
      expect(deviceId()).toMatch(uuid)
    })
  })
})
