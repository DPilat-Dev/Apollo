import { useCallback, useSyncExternalStore } from 'react'

export interface Settings {
  /** Ceiling handed to the server, in bits/sec. 0 means "no cap". */
  maxBitrate: number
  autoplayNext: boolean
  /** Turn on the default subtitle track automatically when one exists. */
  subtitlesDefault: boolean
  /** Skip the billboard's crossfade and card hover animations. */
  reduceMotion: boolean
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
  subtitleColor: string
  subtitleBackground: 'none' | 'subtle' | 'solid'
}

export const DEFAULT_SETTINGS: Settings = {
  maxBitrate: 0,
  autoplayNext: true,
  subtitlesDefault: false,
  reduceMotion: false,
  jellyseerrEnabled: true,
  requestAllSeasons: true,
  autoSkipIntros: false,
  rotateToLandscape: true,
  subtitleSize: 100,
  subtitleColor: '#ffffff',
  subtitleBackground: 'subtle',
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
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS
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
