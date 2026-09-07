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

/**
 * The faces on offer, and the stacks they mean.
 *
 * A fixed list rather than a text box. The chosen value is written into a
 * stylesheet, so a free-text font name is a way to write other things into one
 * — the same reason a colour has to be a hex triple to get through.
 *
 * `default` is the player's own font, which is what subtitles have always used.
 * The rest are the families a subtitle is actually improved by: a humanist sans
 * for most dialogue, a serif for period pieces where it suits the film, and a
 * monospace, which is genuinely easier to read for anyone who finds similar
 * letterforms hard to tell apart.
 */
export const SUBTITLE_FONTS = {
  default: '',
  sans: 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
  serif: 'ui-serif, Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, monospace',
} as const

export type SubtitleFont = keyof typeof SUBTITLE_FONTS

export const SUBTITLE_FONT_LABELS: Record<SubtitleFont, string> = {
  default: 'Player default',
  sans: 'Sans serif',
  serif: 'Serif',
  mono: 'Monospace',
}

export function isSubtitleFont(value: unknown): value is SubtitleFont {
  return typeof value === 'string' && value in SUBTITLE_FONTS
}

/**
 * How far above the bottom of the picture dialogue sits, in percent.
 *
 * The ceiling is deliberately not 50: past about a third of the way up, a
 * subtitle is no longer at the edge of the picture but across the middle of
 * it, which is a different thing to want and not what this control is for.
 */
export const SUBTITLE_POSITION_RANGE = { min: 0, max: 30 } as const

export const clampSubtitlePosition = (percent: number) =>
  Math.min(
    SUBTITLE_POSITION_RANGE.max,
    Math.max(SUBTITLE_POSITION_RANGE.min, Math.round(Number.isFinite(percent) ? percent : 10)),
  )

/**
 * The WebVTT `line` for a given distance above the bottom.
 *
 * `line` is measured from the top with `snapToLines` off, so the two are
 * complements. Jellyfin already writes `line:90%` onto every cue it converts,
 * which is why 10 is the default: it reproduces exactly what was there before
 * this control existed.
 */
export function subtitleLinePercent(positionFromBottom: number): number {
  return 100 - clampSubtitlePosition(positionFromBottom)
}

/*
  A faux outline, drawn with four shadows.

  `-webkit-text-stroke` is the obvious tool and is not portable — Firefox has
  never supported it, and it thins the glyph from the centre rather than
  growing it outward, so text set in it reads lighter at exactly the size
  subtitles are set at. Four offset shadows work everywhere and thicken.
*/
const OUTLINE =
  '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0 0 4px rgba(0,0,0,0.9)'

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
  'subtitleSize' | 'subtitleColor' | 'subtitleBackground' | 'subtitleFont' | 'subtitleOutline'
>): string {
  const size = clampSubtitleSize(settings.subtitleSize)
  const color = safeColor(settings.subtitleColor)
  const background = BACKGROUNDS[settings.subtitleBackground] ?? BACKGROUNDS.subtle

  /*
    An explicit outline wins. Otherwise a softer shadow is added only when
    there is no background box, which is exactly when light text over a bright
    frame is hardest to read — and would be wasted ink behind a solid one.
  */
  const shadow = settings.subtitleOutline
    ? `text-shadow: ${OUTLINE};`
    : settings.subtitleBackground === 'none'
      ? 'text-shadow: 0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.8);'
      : ''

  const family = isSubtitleFont(settings.subtitleFont)
    ? SUBTITLE_FONTS[settings.subtitleFont]
    : ''
  // Omitted rather than set empty: `font-family: ;` is an invalid declaration
  // and takes the whole rule with it in some parsers.
  const fontFamily = family ? `font-family: ${family};` : ''

  return `video::cue {
  font-size: ${size}%;
  color: ${color};
  background-color: ${background};
  ${fontFamily}
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

/**
 * Whether the size control means anything for what is currently on screen.
 *
 * It changes a font size — through `::cue` for text tracks, and by rewriting
 * the script's own sizes for ASS. Neither reaches a picture. PGS and VOBSUB
 * are bitmaps decoded at the size they were authored, so the control was
 * sitting there offering to do something it cannot do, and the − and + buttons
 * simply had no effect.
 *
 * Said rather than hidden, where there is a reason to say it. A control that
 * vanishes leaves someone hunting for it; the same shape as the delay control,
 * which already explains itself when subtitles are burned in.
 */
export type SubtitleSizeStatus =
  | { kind: 'off' }
  | { kind: 'adjustable' }
  | { kind: 'fixed'; reason: string }

export function subtitleSizeStatus({
  textTrackIndex,
  burnedSubIndex,
  pictureTrack,
}: {
  textTrackIndex: number | null
  burnedSubIndex: number | undefined
  /** The chosen track is a bitmap Apollo draws itself, rather than text. */
  pictureTrack: boolean
}): SubtitleSizeStatus {
  if (burnedSubIndex != null) {
    return {
      kind: 'fixed',
      reason: 'Burned into the picture by the server, so its size is fixed.',
    }
  }
  if (textTrackIndex == null) return { kind: 'off' }
  if (pictureTrack) {
    return {
      kind: 'fixed',
      reason: 'These subtitles are pictures rather than text, so their size is fixed.',
    }
  }
  return { kind: 'adjustable' }
}
