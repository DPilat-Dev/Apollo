import { useCallback, useSyncExternalStore } from 'react'
import { migrateMotion, type MotionPreference } from './motion'
import type { ThemePreference } from './theme'
import type { SubtitleFont } from './subtitleStyle'

export interface Settings {
  /** Ceiling handed to the server, in bits/sec. 0 means "no cap". */
  maxBitrate: number
  autoplayNext: boolean
  /** Turn on the default subtitle track automatically when one exists. */
  subtitlesDefault: boolean
  /**
   * The language to turn on automatically, as an ISO code, or empty for no
   * preference. Setting one implies wanting subtitles — see
   * `subtitleLanguage.ts`.
   */
  subtitleLanguage: string
  /*
    Whether to animate. Three-way rather than a switch so the operating
    system's own reduced-motion preference can be the default — see `motion.ts`.
    Was `reduceMotion: boolean`; existing installs are migrated on read.
  */
  motion: MotionPreference
  /** Light or dark, or whatever the device says. See `theme.ts`. */
  theme: ThemePreference
  /** Show the Jellyseerr request shelf in search. */
  jellyseerrEnabled: boolean
  /** Request every season of a series in one go, rather than season one only. */
  requestAllSeasons: boolean
  /** Jump past intros and recaps without being asked. */
  autoSkipIntros: boolean
  /** On a phone, take the player fullscreen and turn it sideways on play. */
  rotateToLandscape: boolean
  /** Subtitle appearance, applied through ::cue. */
  /** Percent of the player's default. See SUBTITLE_SIZE_RANGE. */
  subtitleSize: number
  /** Draw ASS/SSA with libass, keeping its typesetting. Off falls back to text. */
  assTypesetting: boolean
  subtitleColor: string
  subtitleBackground: 'none' | 'subtle' | 'solid'
  /*
    A face, chosen from a fixed list rather than typed. This string is written
    into a stylesheet, and a free-text font name is a way to write other things
    into one — the same reason `subtitleColor` is validated as a hex triple.
  */
  subtitleFont: SubtitleFont
  /** How far above the bottom of the picture the dialogue sits, in percent. */
  subtitlePosition: number
  /** An outline around each glyph, for light text on a light frame. */
  subtitleOutline: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  maxBitrate: 0,
  autoplayNext: true,
  subtitlesDefault: false,
  subtitleLanguage: '',
  motion: 'system',
  theme: 'dark',
  jellyseerrEnabled: true,
  requestAllSeasons: true,
  autoSkipIntros: false,
  rotateToLandscape: true,
  subtitleSize: 100,
  assTypesetting: true,
  subtitleColor: '#ffffff',
  subtitleBackground: 'subtle',
  subtitleFont: 'default',
  // Matches what Jellyfin already writes onto every converted cue, so the
  // default changes nothing about where subtitles have always appeared.
  subtitlePosition: 10,
  subtitleOutline: false,
}

export const BITRATE_OPTIONS = [
  { label: 'Auto (no limit)', value: 0 },
  { label: '4K — 120 Mbps', value: 120_000_000 },
  { label: '1080p — 20 Mbps', value: 20_000_000 },
  { label: '1080p — 10 Mbps', value: 10_000_000 },
  { label: '720p — 4 Mbps', value: 4_000_000 },
  { label: '480p — 1.5 Mbps', value: 1_500_000 },
] as const

const KEY = 'apollo.settings'

function read(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULT_SETTINGS
    const stored = JSON.parse(raw)
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      // Not a plain merge: this field changed shape, and a stored `reduceMotion`
      // would otherwise sit unread beside a `motion` that never got set.
      motion: migrateMotion(stored),
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

// A snapshot cache is required: useSyncExternalStore compares by identity, so
// parsing fresh JSON on every read would loop forever.
let snapshot = read()
const listeners = new Set<() => void>()

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  snapshot = { ...snapshot, [key]: value }
  localStorage.setItem(KEY, JSON.stringify(snapshot))
  listeners.forEach((fn) => fn())
}

/**
 * Replace the whole snapshot at once.
 *
 * For settings arriving from the server: applying them one `setSetting` at a
 * time would notify every subscriber a dozen times and, worse, each write would
 * look like a local change and be sent straight back.
 */
export function applySettings(next: Settings) {
  snapshot = next
  localStorage.setItem(KEY, JSON.stringify(snapshot))
  listeners.forEach((fn) => fn())
}

/** Read once, outside React — for the sync layer's own comparisons. */
export function currentSettings(): Settings {
  return snapshot
}

export function resetSettings() {
  snapshot = DEFAULT_SETTINGS
  localStorage.removeItem(KEY)
  listeners.forEach((fn) => fn())
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => DEFAULT_SETTINGS,
  )
}

export function useSetSetting() {
  return useCallback(setSetting, [])
}

/**
 * The bounds subtitle size is clamped to, wherever it is changed from.
 *
 * There are two places now — the Settings slider and the player's own menu,
 * which is where anyone actually notices the size is wrong. A range that lives
 * in only one of them is a range the other can walk straight past.
 */
export const SUBTITLE_SIZE_RANGE = { min: 50, max: 300 } as const
export const SUBTITLE_SIZE_STEP = 10
export const DEFAULT_SUBTITLE_SIZE = DEFAULT_SETTINGS.subtitleSize

export function clampSubtitleSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_SUBTITLE_SIZE
  return Math.min(SUBTITLE_SIZE_RANGE.max, Math.max(SUBTITLE_SIZE_RANGE.min, Math.round(size)))
}
