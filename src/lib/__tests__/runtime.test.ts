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
