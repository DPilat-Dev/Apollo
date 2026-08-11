import { describe, expect, it } from 'vitest'
import { segmentAt, shouldAutoSkip, usableSegments, type MediaSegment } from '../segments'

const S = 10_000_000
const seg = (type: string, start: number, end: number, id?: string): MediaSegment =>
  ({ Id: id, Type: type as MediaSegment['Type'], StartTicks: start * S, EndTicks: end * S })

describe('usableSegments', () => {
  it('orders by start time whatever order the server sent', () => {
    const out = usableSegments([seg('Outro', 1200, 1260), seg('Intro', 30, 90)])
    expect(out.map((s) => s.Type)).toEqual(['Intro', 'Outro'])
  })

  /** A one-second "intro" is a detection artefact, and the button costs more. */
  it('drops segments too short to be worth a button', () => {
    expect(usableSegments([seg('Intro', 30, 31)])).toEqual([])
    expect(usableSegments([seg('Intro', 30, 33)])).toHaveLength(1)
  })

  it('drops ranges that are inverted or empty', () => {
    expect(usableSegments([seg('Intro', 90, 30), seg('Intro', 30, 30)])).toEqual([])
    expect(usableSegments(undefined)).toEqual([])
    expect(usableSegments([])).toEqual([])
  })
})

describe('segmentAt', () => {
  const segments = [seg('Intro', 30, 90, 'i1'), seg('Outro', 1200, 1260, 'o1')]

  it('offers the skip for the whole range, not just its first seconds', () => {
    expect(segmentAt(segments, 30)?.label).toBe('Skip Intro')
    expect(segmentAt(segments, 60)?.label).toBe('Skip Intro')
    expect(segmentAt(segments, 89.9)?.label).toBe('Skip Intro')
  })

  it('lands playback at the end of the segment', () => {
    expect(segmentAt(segments, 45)?.skipToSeconds).toBe(90)
  })

  it('offers nothing outside a segment', () => {
    expect(segmentAt(segments, 10)).toBeNull()
    expect(segmentAt(segments, 90)).toBeNull()   // end is exclusive
    expect(segmentAt(segments, 600)).toBeNull()
  })

  it('labels each type in the viewer’s words', () => {
    expect(segmentAt([seg('Outro', 0, 60)], 10)?.label).toBe('Skip Credits')
    expect(segmentAt([seg('Recap', 0, 60)], 10)?.label).toBe('Skip Recap')
    expect(segmentAt([seg('Commercial', 0, 60)], 10)?.label).toBe('Skip Ad')
    expect(segmentAt([seg('Unknown', 0, 60)], 10)?.label).toBe('Skip')
  })

  it('gives a stable key so dismissing one range does not hide the next', () => {
    const intro = segmentAt(segments, 45)!
    const outro = segmentAt(segments, 1230)!
    expect(intro.key).not.toBe(outro.key)
    expect(segmentAt(segments, 50)!.key).toBe(intro.key)
  })

  it('still keys a segment the server gave no id', () => {
    expect(segmentAt([seg('Intro', 30, 90)], 45)!.key).toBe('Intro:30')
  })
})

describe('shouldAutoSkip', () => {
  const target = (type: string) => segmentAt([seg(type, 0, 60)], 10)

  it('auto-skips only what the viewer has already sat through', () => {
    expect(shouldAutoSkip(target('Intro'), true)).toBe(true)
    expect(shouldAutoSkip(target('Recap'), true)).toBe(true)
  })

  /** Credits can carry a post-credits scene; ads are not ours to assume about. */
  it('never auto-skips credits, previews or ads', () => {
    expect(shouldAutoSkip(target('Outro'), true)).toBe(false)
    expect(shouldAutoSkip(target('Preview'), true)).toBe(false)
    expect(shouldAutoSkip(target('Commercial'), true)).toBe(false)
  })

  it('does nothing when the setting is off, or there is no segment', () => {
    expect(shouldAutoSkip(target('Intro'), false)).toBe(false)
    expect(shouldAutoSkip(null, true)).toBe(false)
  })
})
