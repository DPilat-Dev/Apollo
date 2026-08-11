import { describe, expect, it } from 'vitest'
import { clampSubtitleSize, safeColor, subtitleCss } from '../subtitleStyle'

const base = { subtitleSize: 100, subtitleColor: '#ffffff', subtitleBackground: 'subtle' as const }

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

  it('cannot be made to emit anything but a single rule', () => {
    const css = subtitleCss({
      subtitleSize: 999,
      subtitleColor: '#fff; } * { display:none } video::cue {',
      subtitleBackground: 'subtle',
    })
    expect(css.match(/\{/g)).toHaveLength(1)
    expect(css).toContain('color: #ffffff')
  })
})
