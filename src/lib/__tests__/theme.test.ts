import { describe, expect, it } from 'vitest'
import { isThemePreference, resolveTheme, THEME_LABELS, THEME_PREFERENCES } from '../theme'

describe('resolveTheme', () => {
  it('honours an explicit choice, whatever the machine says', () => {
    expect(resolveTheme('light', false)).toBe('light')
    expect(resolveTheme('dark', true)).toBe('dark')
  })

  it('follows the machine when asked to', () => {
    expect(resolveTheme('system', true)).toBe('light')
    expect(resolveTheme('system', false)).toBe('dark')
  })

  it('defaults to dark, which is what this client is', () => {
    // `prefers-color-scheme` reports `light` for a machine with no preference
    // as well as one that asked for it, so the default is dark rather than
    // `system` — otherwise every existing install would silently turn light.
    expect(resolveTheme('dark', true)).toBe('dark')
  })
})

describe('isThemePreference', () => {
  it('accepts the three', () => {
    for (const t of THEME_PREFERENCES) expect(isThemePreference(t)).toBe(true)
  })

  it('rejects everything else', () => {
    for (const v of ['Light', '', null, 0, {}]) expect(isThemePreference(v)).toBe(false)
  })
})

describe('THEME_LABELS', () => {
  it('names every choice the settings screen offers', () => {
    for (const t of THEME_PREFERENCES) {
      expect(THEME_LABELS[t].label).toBeTruthy()
      expect(THEME_LABELS[t].hint).toBeTruthy()
    }
  })
})
