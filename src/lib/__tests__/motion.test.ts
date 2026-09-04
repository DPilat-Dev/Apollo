import { describe, expect, it } from 'vitest'
import {
  isMotionPreference,
  MOTION_LABELS,
  MOTION_PREFERENCES,
  migrateMotion,
  motionAttribute,
  resolveMotion,
} from '../motion'

describe('resolveMotion', () => {
  it('follows the machine when told to', () => {
    expect(resolveMotion('system', true)).toBe(true)
    expect(resolveMotion('system', false)).toBe(false)
  })

  it('lets an explicit choice beat the machine, in both directions', () => {
    // "Full" has to win too: someone who turned the system preference on for
    // one badly-behaved app should not have to turn it off to watch a recap.
    expect(resolveMotion('full', true)).toBe(false)
    expect(resolveMotion('reduced', false)).toBe(true)
  })
})

describe('migrateMotion', () => {
  it('keeps a preference already saved in the new shape', () => {
    expect(migrateMotion({ motion: 'full' })).toBe('full')
    expect(migrateMotion({ motion: 'reduced' })).toBe('reduced')
  })

  it('reads the old switch being on as a deliberate choice', () => {
    expect(migrateMotion({ reduceMotion: true })).toBe('reduced')
  })

  it('reads the old switch being off as never having been touched', () => {
    // It was the default, so it says nothing about what the person wants —
    // and reading it as "animate regardless of my machine" would silently
    // opt every existing install out of the fix.
    expect(migrateMotion({ reduceMotion: false })).toBe('system')
  })

  it('follows the system for settings saved before either field existed', () => {
    expect(migrateMotion({})).toBe('system')
  })

  it('ignores a stored value that is not a preference', () => {
    // localStorage is editable by hand and survives across versions.
    expect(migrateMotion({ motion: 'yes' })).toBe('system')
    expect(migrateMotion({ motion: 1 })).toBe('system')
    expect(migrateMotion({ motion: null, reduceMotion: true })).toBe('reduced')
  })
})

describe('isMotionPreference', () => {
  it('accepts exactly the three', () => {
    for (const p of MOTION_PREFERENCES) expect(isMotionPreference(p)).toBe(true)
  })

  it('rejects everything else', () => {
    for (const v of ['', 'SYSTEM', 'none', 0, null, undefined, {}]) {
      expect(isMotionPreference(v)).toBe(false)
    }
  })
})

describe('motionAttribute', () => {
  it('publishes the resolved answer, not the preference', () => {
    // Stylesheets must not re-derive this from the media query, or they would
    // disagree with the app the moment somebody overrides it.
    expect(motionAttribute(true)).toBe('reduced')
    expect(motionAttribute(false)).toBe('full')
  })
})

describe('MOTION_LABELS', () => {
  it('names every preference the settings screen can offer', () => {
    for (const p of MOTION_PREFERENCES) {
      expect(MOTION_LABELS[p].label.length).toBeGreaterThan(0)
      expect(MOTION_LABELS[p].hint.length).toBeGreaterThan(0)
    }
  })
})
