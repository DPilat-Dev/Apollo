import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../settings'
import {
  decodeSettings,
  encodeSettings,
  LOCAL_KEYS,
  mergeFromServer,
  SETTINGS_BAG_KEY,
  SYNCED_KEYS,
  syncedPartChanged,
} from '../settingsSync'

describe('the split between what travels and what stays', () => {
  it('classifies every setting, so a new one cannot be forgotten', () => {
    // The point of this test. Add a setting without deciding whether it
    // describes the person or the machine and this fails immediately, rather
    // than the setting silently never syncing.
    const classified = new Set<string>([...SYNCED_KEYS, ...LOCAL_KEYS])
    const all = Object.keys(DEFAULT_SETTINGS)
    expect([...all].filter((k) => !classified.has(k))).toEqual([])
  })

  it('never puts a setting in both lists', () => {
    const both = SYNCED_KEYS.filter((k) => (LOCAL_KEYS as readonly string[]).includes(k))
    expect(both).toEqual([])
  })

  it('keeps the device-shaped ones at home', () => {
    // A bitrate cap chosen for a phone on mobile data is the wrong ceiling for
    // a desktop, and libass being off is usually a rescue for one device.
    expect(LOCAL_KEYS).toContain('maxBitrate')
    expect(LOCAL_KEYS).toContain('assTypesetting')
    expect(LOCAL_KEYS).toContain('rotateToLandscape')
  })
})

describe('encodeSettings', () => {
  it('carries the travelling half and nothing else', () => {
    const bag = encodeSettings({ ...DEFAULT_SETTINGS, subtitleSize: 150, maxBitrate: 20_000_000 })
    const carried = JSON.parse(bag[SETTINGS_BAG_KEY])
    expect(carried.subtitleSize).toBe(150)
    expect(carried).not.toHaveProperty('maxBitrate')
  })

  it('produces strings, which is all CustomPrefs holds', () => {
    for (const v of Object.values(encodeSettings(DEFAULT_SETTINGS))) {
      expect(typeof v).toBe('string')
    }
  })
})

describe('decodeSettings', () => {
  const round = (over: Partial<Settings>) =>
    decodeSettings(encodeSettings({ ...DEFAULT_SETTINGS, ...over }))

  it('reads back what it wrote', () => {
    expect(round({ subtitleSize: 175, subtitleFont: 'serif' })).toMatchObject({
      subtitleSize: 175,
      subtitleFont: 'serif',
    })
  })

  it('says nothing when the server has nothing', () => {
    expect(decodeSettings(null)).toBeNull()
    expect(decodeSettings({})).toBeNull()
    expect(decodeSettings({ [SETTINGS_BAG_KEY]: null })).toBeNull()
  })

  it('survives a bag that is not JSON', () => {
    // CustomPrefs is writable by other clients and by hand.
    expect(decodeSettings({ [SETTINGS_BAG_KEY]: 'not json {' })).toBeNull()
    expect(decodeSettings({ [SETTINGS_BAG_KEY]: '"a string"' })).toBeNull()
    expect(decodeSettings({ [SETTINGS_BAG_KEY]: 'null' })).toBeNull()
  })

  it('drops values of the wrong type rather than trusting them', () => {
    // A subtitle size of "huge" would reach clampSubtitleSize as NaN and be
    // applied to every screen this account touches.
    const got = decodeSettings({ [SETTINGS_BAG_KEY]: JSON.stringify({ subtitleSize: 'huge', autoplayNext: false }) })
    expect(got).toEqual({ autoplayNext: false })
  })

  it('ignores keys that are not synced, however they got there', () => {
    const got = decodeSettings({ [SETTINGS_BAG_KEY]: JSON.stringify({ maxBitrate: 1, subtitleSize: 120 }) })
    expect(got).toEqual({ subtitleSize: 120 })
  })
})

describe('mergeFromServer', () => {
  const local: Settings = { ...DEFAULT_SETTINGS, subtitleSize: 100, maxBitrate: 4_000_000 }

  it('lets the server decide what it knows about', () => {
    expect(mergeFromServer(local, { subtitleSize: 200 }).subtitleSize).toBe(200)
  })

  it('never touches a device setting, whatever arrives', () => {
    const merged = mergeFromServer(local, { maxBitrate: 999 } as Partial<Settings>)
    expect(merged.maxBitrate).toBe(4_000_000)
  })

  it('leaves a key the server has never heard of alone', () => {
    // Adding a setting must not reset it for everyone at their next sign-in.
    expect(mergeFromServer(local, { subtitleSize: 120 }).autoSkipIntros).toBe(local.autoSkipIntros)
  })

  it('changes nothing when the server has nothing to say', () => {
    expect(mergeFromServer(local, null)).toBe(local)
  })
})

describe('syncedPartChanged', () => {
  it('notices a change worth sending', () => {
    expect(syncedPartChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, subtitleSize: 120 })).toBe(true)
  })

  it('stays quiet for a device-only change', () => {
    // Changing the bitrate cap should not cost a request, on any device.
    expect(syncedPartChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, maxBitrate: 999 })).toBe(false)
  })

  it('stays quiet when nothing moved', () => {
    expect(syncedPartChanged(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS })).toBe(false)
  })
})

describe('sharing the bag with other clients', () => {
  it('claims a namespaced key, because the bag is not ours alone', () => {
    // Reading this record on a real server returns jellyfin-web's own entries
    // — chromecastVersion, skipForwardLength, dashboardTheme — alongside ours,
    // despite the `client` parameter. A key called `settings` would collide.
    expect(SETTINGS_BAG_KEY).toBe('apollo.settings')
    expect(SETTINGS_BAG_KEY).toContain('.')
  })

  it('writes exactly one key, so nothing else in the bag is disturbed', () => {
    expect(Object.keys(encodeSettings(DEFAULT_SETTINGS))).toEqual([SETTINGS_BAG_KEY])
  })

  it('reads past another client\'s entries without tripping on them', () => {
    const bag = {
      chromecastVersion: 'stable',
      skipForwardLength: '30000',
      dashboardTheme: '',
      ...encodeSettings({ ...DEFAULT_SETTINGS, subtitleSize: 145 }),
    }
    expect(decodeSettings(bag)).toMatchObject({ subtitleSize: 145 })
  })

  it('is quiet when the bag holds only other clients\' keys', () => {
    expect(decodeSettings({ chromecastVersion: 'stable', tvhome: '' })).toBeNull()
  })
})
