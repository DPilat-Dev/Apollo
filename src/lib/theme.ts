/**
 * Light and dark.
 *
 * Apollo has only ever been dark. That is right for a room with a film on and
 * wrong for looking something up at a desk at eleven in the morning, which is
 * most of what a library page is for.
 *
 * ── How it is done, and why not the obvious way ────────────────────────────
 *
 * There are over a thousand hardcoded `text-white/60`, `bg-white/5` and
 * `border-white/10` in this codebase across 55 files. Rewriting them all into
 * semantic tokens is the textbook answer and would be a thousand chances to
 * get one wrong.
 *
 * Tailwind resolves every one of them through `var(--color-white)`, so
 * redefining that single variable turns the whole palette over at once. What
 * reads as "white at 60%" on a dark ground becomes "near-black at 60%" on a
 * light one, which is what those declarations meant all along — a foreground,
 * stated as a colour.
 *
 * ── What must stay dark ────────────────────────────────────────────────────
 *
 * Anything drawn over a picture. The hero's title sits on a backdrop, a card's
 * badges sit on a poster, and the player's controls sit on the film itself. A
 * light theme cannot reach those without making them unreadable, and no viewer
 * asked for a light player anyway — they asked for a light library.
 *
 * So the theme applies to the chrome, and `on-media` pins a subtree back to
 * the dark palette. That is a real distinction, not an escape hatch: those
 * surfaces have a picture behind them rather than a background.
 */

export type ThemePreference = 'system' | 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

/** The media query the OS preference is read from. */
export const LIGHT_THEME_QUERY = '(prefers-color-scheme: light)'

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === 'string' && (THEME_PREFERENCES as readonly string[]).includes(value)
}

/** Which palette to paint, given the preference and the machine. */
export function resolveTheme(preference: ThemePreference, systemPrefersLight: boolean): 'light' | 'dark' {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  /*
    Dark is the default when the machine says nothing. `prefers-color-scheme`
    reports `light` for a machine with no preference set as well as for one
    that asked for light, so following it blindly would flip Apollo to light
    for everyone who never chose anything — a change nobody asked for, on a
    client whose whole look is dark.
  */
  return systemPrefersLight ? 'light' : 'dark'
}

export const THEME_LABELS: Record<ThemePreference, { label: string; hint: string }> = {
  system: { label: 'Match my system', hint: 'Follows the light or dark setting on this device.' },
  dark: { label: 'Dark', hint: 'The default. Best with the lights off.' },
  light: { label: 'Light', hint: 'For browsing in daylight. The player stays dark.' },
}
