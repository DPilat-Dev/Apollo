import type { Settings } from './settings'

/**
 * Subtitle appearance.
 *
 * Browsers only expose cue styling through the `::cue` pseudo-element, which
 * cannot be set inline — it has to be a real stylesheet rule. So the rule is
 * generated from settings and swapped into a single managed <style>, the same
 * approach the server's custom CSS uses.
 *
 * Default subtitle sizing is frequently unreadable on a phone held at arm's
 * length, which is the reason this exists at all.
 */

const STYLE_ID = 'apollo-subtitle-css'

const BACKGROUNDS: Record<Settings['subtitleBackground'], string> = {
  none: 'transparent',
  subtle: 'rgba(0, 0, 0, 0.55)',
  solid: 'rgba(0, 0, 0, 0.92)',
}

/** Clamped so a stored value can never make subtitles unusable. */
export const clampSubtitleSize = (percent: number) =>
  Math.min(300, Math.max(50, Math.round(percent)))

/** Only hex colours reach a stylesheet — this text is written into CSS. */
export function safeColor(value: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#ffffff'
}

export function subtitleCss(settings: Pick<
  Settings,
  'subtitleSize' | 'subtitleColor' | 'subtitleBackground'
>): string {
  const size = clampSubtitleSize(settings.subtitleSize)
  const color = safeColor(settings.subtitleColor)
  const background = BACKGROUNDS[settings.subtitleBackground] ?? BACKGROUNDS.subtle
  // A shadow keeps light text legible over a bright frame when the background
  // is off, which is exactly when it is hardest to read.
  const shadow =
    settings.subtitleBackground === 'none'
      ? 'text-shadow: 0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.8);'
      : ''

  return `video::cue {
  font-size: ${size}%;
  color: ${color};
  background-color: ${background};
  ${shadow}
}`
}

/** Installs, replaces or removes the managed stylesheet. */
export function applySubtitleCss(css: string | null) {
  if (typeof document === 'undefined') return
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!css) {
    style?.remove()
    return
  }
  if (!style) {
    style = document.createElement('style')
    style.id = STYLE_ID
    document.head.appendChild(style)
  }
  style.textContent = css
}
