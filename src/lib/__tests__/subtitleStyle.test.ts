import { describe, expect, it } from 'vitest'
import {
  SUBTITLE_FONTS,
  SUBTITLE_FONT_LABELS,
  clampSubtitlePosition,
  clampSubtitleSize,
  isSubtitleFont,
  safeColor,
  subtitleCss,
  subtitleLinePercent,
} from '../subtitleStyle'

const base = {
  subtitleSize: 100,
  subtitleColor: '#ffffff',
  subtitleBackground: 'subtle' as const,
  subtitleFont: 'default' as const,
  subtitleOutline: false,
}

describe('clampSubtitleSize', () => {
  it('keeps sane values', () => {
    expect(clampSubtitleSize(150)).toBe(150)
  })

  /** A stored value must never be able to make subtitles unusable. */
  it('clamps beyond the usable range', () => {
    expect(clampSubtitleSize(5)).toBe(50)
    expect(clampSubtitleSize(10_000)).toBe(300)
    expect(clampSubtitleSize(-20)).toBe(50)
  })
})

/**
 * This value is written straight into a stylesheet, so anything that is not a
 * plain hex colour has to be refused rather than escaped.
 */
describe('safeColor', () => {
  it('accepts a six-digit hex colour', () => {
    expect(safeColor('#ff0055')).toBe('#ff0055')
    expect(safeColor('#ABCDEF')).toBe('#ABCDEF')
  })

  it('refuses anything that could carry CSS with it', () => {
    expect(safeColor('red; } body { display: none } ')).toBe('#ffffff')
    expect(safeColor('#fff')).toBe('#ffffff')
    expect(safeColor('url(https://evil.test/x)')).toBe('#ffffff')
    expect(safeColor('')).toBe('#ffffff')
  })
})

describe('subtitleCss', () => {
  it('targets the cue pseudo-element, which is the only thing browsers style', () => {
    expect(subtitleCss(base)).toContain('video::cue')
  })

  it('applies size, colour and background', () => {
    const css = subtitleCss({ ...base, subtitleSize: 175, subtitleColor: '#ffee00' })
    expect(css).toContain('font-size: 175%')
    expect(css).toContain('color: #ffee00')
    expect(css).toContain('background-color: rgba(0, 0, 0, 0.55)')
  })

  it('adds a shadow only when there is no background to sit on', () => {
    expect(subtitleCss({ ...base, subtitleBackground: 'none' })).toContain('text-shadow')
    expect(subtitleCss({ ...base, subtitleBackground: 'solid' })).not.toContain('text-shadow')
    expect(subtitleCss({ ...base, subtitleBackground: 'none' })).toContain('transparent')
  })

  it('names a font only when one was chosen', () => {
    // `font-family: ;` is an invalid declaration and some parsers drop the
    // whole rule over it, taking size and colour with it.
    expect(subtitleCss(base)).not.toContain('font-family')
    expect(subtitleCss({ ...base, subtitleFont: 'serif' })).toContain('font-family: ui-serif')
  })

  it('outlines the glyphs when asked, whatever the background is', () => {
    const css = subtitleCss({ ...base, subtitleOutline: true })
    expect(css).toContain('text-shadow')
    expect(css).toContain('-1px -1px 0 #000')
  })

  it('still softens light text over a bright frame with no box behind it', () => {
    // The case the shadow was added for, and it must survive the outline
    // setting being off.
    expect(subtitleCss({ ...base, subtitleBackground: 'none' })).toContain('text-shadow')
  })

  it('does not shadow text that already has a box behind it', () => {
    expect(subtitleCss({ ...base, subtitleBackground: 'solid' })).not.toContain('text-shadow')
  })

  it('cannot be made to emit anything but a single rule', () => {
    const css = subtitleCss({
      ...base,
      subtitleSize: 999,
      subtitleColor: '#fff; } * { display:none } video::cue {',
      // A font name is written into the stylesheet too, so it is chosen from a
      // fixed list and anything else falls back rather than being emitted.
      subtitleFont: 'Arial"; } * { display: none } video::cue { color: red' as never,
    })
    expect(css.match(/\{/g)).toHaveLength(1)
    expect(css).toContain('color: #ffffff')
    expect(css).not.toContain('display: none')
  })
})

describe('clampSubtitlePosition', () => {
  it('keeps the control inside its range', () => {
    expect(clampSubtitlePosition(-20)).toBe(0)
    expect(clampSubtitlePosition(90)).toBe(30)
    expect(clampSubtitlePosition(12.4)).toBe(12)
  })

  it('falls back to the default rather than storing nonsense', () => {
    expect(clampSubtitlePosition(Number.NaN)).toBe(10)
    expect(clampSubtitlePosition(Number.POSITIVE_INFINITY)).toBe(10)
  })
})

describe('subtitleLinePercent', () => {
  it('reproduces exactly where subtitles already were, at the default', () => {
    // Jellyfin writes `line:90%` onto every cue it converts, so 10 has to come
    // back as 90 or turning this control on would move every subtitle.
    expect(subtitleLinePercent(10)).toBe(90)
  })

  it('measures from the top, because `line` does', () => {
    expect(subtitleLinePercent(0)).toBe(100)
    expect(subtitleLinePercent(30)).toBe(70)
  })

  it('clamps before converting', () => {
    expect(subtitleLinePercent(500)).toBe(70)
  })
})

describe('isSubtitleFont', () => {
  it('accepts the four on offer', () => {
    for (const f of Object.keys(SUBTITLE_FONTS)) expect(isSubtitleFont(f)).toBe(true)
  })

  it('rejects anything else, including CSS', () => {
    expect(isSubtitleFont('Comic Sans')).toBe(false)
    expect(isSubtitleFont('serif; } * { display: none }')).toBe(false)
    expect(isSubtitleFont(null)).toBe(false)
  })

  it('has a label for every font', () => {
    for (const f of Object.keys(SUBTITLE_FONTS)) {
      expect(SUBTITLE_FONT_LABELS[f as keyof typeof SUBTITLE_FONTS]).toBeTruthy()
    }
  })
})
