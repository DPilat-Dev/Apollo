import { DEFAULT_SETTINGS, type Settings } from './settings'

/**
 * Carrying settings between devices.
 *
 * Settings lived in `localStorage` and nowhere else, so every browser and every
 * phone was configured from scratch — set your subtitle size on the sofa and
 * the tablet in the kitchen still had none of it.
 *
 * Jellyfin already stores per-user client preferences: `/DisplayPreferences`
 * has a `CustomPrefs` bag of strings, keyed by a client name of our choosing.
 * That is where these go, so they follow the account rather than the browser.
 *
 * ── Not everything should follow you ───────────────────────────────────────
 *
 * A setting is only worth syncing if it is about the person. Some of these are
 * about the machine in front of them, and carrying those across would actively
 * do harm: a bitrate cap chosen for a phone on mobile data is the wrong ceiling
 * for a desktop on ethernet, and turning libass on for a device that struggles
 * with it would undo the switch that exists to rescue exactly that device.
 *
 * So the split is deliberate and is the whole design.
 */

/** Settings that describe the viewer, and travel with them. */
export const SYNCED_KEYS = [
  'autoplayNext',
  'subtitlesDefault',
  'subtitleLanguage',
  'autoSkipIntros',
  'jellyseerrEnabled',
  'requestAllSeasons',
  'motion',
  // 'system' already adapts per device, so an explicit light or dark is a
  // decision about the person rather than the machine.
  'theme',
  'subtitleSize',
  'subtitleColor',
  'subtitleBackground',
  'subtitleFont',
  'subtitlePosition',
  'subtitleOutline',
] as const satisfies readonly (keyof Settings)[]

/**
 * Settings that describe this device, and stay on it.
 *
 * Listed rather than inferred, so a new setting has to be classified by
 * whoever adds it — `settingsSync.test.ts` fails until it appears in one list
 * or the other, which is the only way this stays correct as settings are added.
 */
export const LOCAL_KEYS = [
  'maxBitrate',
  'rotateToLandscape',
  'assTypesetting',
] as const satisfies readonly (keyof Settings)[]

export type SyncedKey = (typeof SYNCED_KEYS)[number]

/** The name this client's preferences are filed under on the server. */
export const SYNC_CLIENT = 'apollo'
export const SYNC_PREFERENCES_ID = 'apollo'

/**
 * One key rather than twelve: these are written and read as a set.
 *
 * Namespaced, because the bag turned out to be shared. Reading it back on a
 * real server returned jellyfin-web's own entries — `chromecastVersion`,
 * `skipForwardLength`, `dashboardTheme` — alongside ours, despite the `client`
 * parameter. A key called `settings` in a bag several clients write to is a
 * collision waiting to happen.
 *
 * Every write is a read-modify-write for the same reason: the other clients'
 * keys have to survive ours.
 */
export const SETTINGS_BAG_KEY = 'apollo.settings'

/** The travelling half of the settings, as the server will hold it. */
export function encodeSettings(settings: Settings): Record<string, string> {
  const carried: Partial<Settings> = {}
  for (const key of SYNCED_KEYS) {
    // The cast is safe by construction: every key is a key of Settings, and
    // the value is read from the same object.
    ;(carried as Record<string, unknown>)[key] = settings[key]
  }
  return { [SETTINGS_BAG_KEY]: JSON.stringify(carried) }
}

/**
 * What the server has to say about the travelling half, or null if nothing.
 *
 * Every value is validated against the defaults' own types rather than trusted.
 * `CustomPrefs` is a bag of strings a user can write to, and a subtitle size of
 * `"huge"` reaching `clampSubtitleSize` would be `NaN` on every screen.
 */
export function decodeSettings(prefs: Record<string, string | null> | null | undefined): Partial<Settings> | null {
  const raw = prefs?.[SETTINGS_BAG_KEY]
  if (!raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const out: Partial<Settings> = {}
  const source = parsed as Record<string, unknown>
  for (const key of SYNCED_KEYS) {
    const value = source[key]
    if (value === undefined) continue
    // Same shape as the default, or it does not come in.
    if (typeof value !== typeof DEFAULT_SETTINGS[key]) continue
    ;(out as Record<string, unknown>)[key] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * What this device should hold after hearing from the server.
 *
 * The server wins for everything it carries, and only for what it carries: a
 * key it has never been told about leaves the local value alone, so adding a
 * setting does not reset it for everyone on their next sign-in. Device-local
 * settings are never touched, whatever arrives.
 */
export function mergeFromServer(local: Settings, remote: Partial<Settings> | null): Settings {
  if (!remote) return local
  const merged = { ...local }
  for (const key of SYNCED_KEYS) {
    if (remote[key] === undefined) continue
    ;(merged as Record<string, unknown>)[key] = remote[key]
  }
  return merged
}

/** Whether a change is worth a request. */
export function syncedPartChanged(a: Settings, b: Settings): boolean {
  return SYNCED_KEYS.some((key) => a[key] !== b[key])
}

/**
 * What this device should do when it hears from the server.
 *
 * The naive rule — the server always wins on load — loses work. Change a
 * setting and reload within the debounce and the change is not merely
 * unsent: the pull applies the older copy over it, so it is actively undone.
 *
 * Fixed by remembering the last state both sides agreed on. If the local
 * settings have moved since then, they are newer than anything the server can
 * offer and are pushed instead. Only when local has not moved does the remote
 * copy apply — which is the case this whole feature exists for, arriving at a
 * second device.
 *
 * A tab closed before the push simply pushes on the next load, so nothing has
 * to survive the page going away.
 */
export function reconcile({
  local,
  remote,
  lastSynced,
}: {
  local: Settings
  remote: Partial<Settings> | null
  /** The state both sides last agreed on, or null on a first run. */
  lastSynced: Settings | null
}): { settings: Settings; push: boolean } {
  const localHasChanges = lastSynced != null && syncedPartChanged(lastSynced, local)
  if (localHasChanges) return { settings: local, push: true }

  const merged = mergeFromServer(local, remote)
  /*
    Nothing stored yet: this device's settings become the account's, which is
    what makes the first sign-in on a second device inherit rather than reset.
  */
  if (!remote) return { settings: merged, push: true }
  return { settings: merged, push: false }
}

const SYNCED_SNAPSHOT_KEY = 'apollo.settings.synced'

/** The last state the server and this device agreed on. */
export function readLastSynced(): Settings | null {
  try {
    const raw = localStorage.getItem(SYNCED_SNAPSHOT_KEY)
    return raw ? (JSON.parse(raw) as Settings) : null
  } catch {
    return null
  }
}

export function writeLastSynced(settings: Settings) {
  try {
    localStorage.setItem(SYNCED_SNAPSHOT_KEY, JSON.stringify(settings))
  } catch {
    // A full or unavailable store costs correctness on the next reload only,
    // and there is nothing useful to do about it here.
  }
}
