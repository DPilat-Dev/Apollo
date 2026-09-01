/**
 * The keyboard map, as data.
 *
 * Kept in one place so the help sheet and the handlers cannot drift apart —
 * a documented shortcut that does nothing is worse than an undocumented one.
 */

export interface Shortcut {
  keys: string[]
  description: string
}

export interface ShortcutGroup {
  title: string
  shortcuts: Shortcut[]
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    shortcuts: [
      { keys: ['?'], description: 'Show this list' },
      { keys: ['/'], description: 'Search' },
      { keys: ['Esc'], description: 'Close what is open, or go back' },
    ],
  },
  {
    title: 'Playback',
    shortcuts: [
      { keys: ['Space', 'K'], description: 'Play or pause' },
      { keys: ['J', '←'], description: 'Back 10 seconds' },
      { keys: ['L', '→'], description: 'Forward 10 seconds' },
      { keys: ['Shift', '←/→'], description: 'Jump a minute' },
      { keys: ['0–9'], description: 'Jump to a point in the title' },
      { keys: ['S'], description: 'Take the offered skip' },
      { keys: ['Shift', 'C'], description: 'Chapters, where a title has them' },
      { keys: [',', '.'], description: 'Slower or faster' },
    ],
  },
  {
    title: 'Sound and picture',
    shortcuts: [
      { keys: ['↑', '↓'], description: 'Volume' },
      { keys: ['M'], description: 'Mute' },
      { keys: ['F'], description: 'Fullscreen' },
      { keys: ['Shift', 'P'], description: 'Picture in picture' },
      { keys: ['C'], description: 'Subtitles on or off' },
    ],
  },
  {
    title: 'Episodes',
    shortcuts: [
      { keys: ['N'], description: 'Next episode' },
      { keys: ['P'], description: 'Previous episode' },
      { keys: ['I'], description: 'Playback info' },
    ],
  },
]

/**
 * Whether a keypress belongs to whatever the user is typing in.
 *
 * A global handler that swallows keys inside a text field makes search
 * unusable, and this is the single most common way to get that wrong.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable
}
