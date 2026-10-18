import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  currentSettings,
  readLastSynced,
  resetSettings,
  writeLastSynced,
} from '../settings'
import { reconcile, syncedPartChanged } from '../settingsSync'

/** A localStorage that exists, since node has none. */
function stubStore(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
  return store
}

afterEach(() => vi.unstubAllGlobals())

/*
  "Reset preferences" is an account-wide act, and Settings says so. The defaults
  reach the other devices through the ordinary push: `useSettingsSync` compares
  the live settings against the state the server last agreed to and sends them
  when the two differ, which after a reset they do in every synced key.

  So the agreed-state snapshot is the one thing the reset must *not* touch. It
  is what makes that push happen again on the next load if this one does not
  land — and with it cleared, `reconcile` has nothing left to call newer, merges
  the server's untouched copy back over the defaults, and the reset quietly
  disappears.
*/
describe('resetSettings', () => {
  const agreed = { ...DEFAULT_SETTINGS, autoplayNext: false, subtitleSize: 180 }

  it('puts this device back to the defaults', () => {
    const store = stubStore()
    writeLastSynced(agreed)

    resetSettings()

    expect(currentSettings()).toEqual(DEFAULT_SETTINGS)
    expect(store.get('apollo.settings')).toBeUndefined()
  })

  /*
    The question the push effect asks, asked the way it asks it: `lastPushed`
    holds whatever the pull agreed to, which is the snapshot on disk. A reset
    that left the two matching would send nothing at all, and the TV would keep
    the old settings for ever.
  */
  it('leaves the synced half owing the server a push', () => {
    stubStore()
    writeLastSynced(agreed)

    resetSettings()

    expect(readLastSynced()).toEqual(agreed)
    expect(syncedPartChanged(readLastSynced()!, currentSettings())).toBe(true)
  })

  // The retry, which is the whole reason the key stays. A push that never left
  // — a refused request, or a tab closed inside the 1.5s debounce — has to go
  // out on the next load rather than be talked out of it by the server.
  it('pushes the defaults again on the next load rather than merging the old copy back', () => {
    stubStore()
    writeLastSynced(agreed)
    resetSettings()

    const after = reconcile({
      local: currentSettings(),
      remote: { autoplayNext: false, subtitleSize: 180 },
      lastSynced: readLastSynced(),
    })

    expect(after.push).toBe(true)
    expect(after.settings.autoplayNext).toBe(DEFAULT_SETTINGS.autoplayNext)
    expect(after.settings.subtitleSize).toBe(DEFAULT_SETTINGS.subtitleSize)
  })

  // And once it has landed, nothing is owed: a reset must not turn into a push
  // on every load from then on.
  it('stops asking once the server has the defaults', () => {
    stubStore()
    writeLastSynced(agreed)
    resetSettings()
    writeLastSynced(currentSettings())

    expect(syncedPartChanged(readLastSynced()!, currentSettings())).toBe(false)
    const after = reconcile({
      local: currentSettings(),
      remote: { autoplayNext: DEFAULT_SETTINGS.autoplayNext },
      lastSynced: readLastSynced(),
    })
    expect(after.push).toBe(false)
    expect(after.settings).toEqual(DEFAULT_SETTINGS)
  })
})
