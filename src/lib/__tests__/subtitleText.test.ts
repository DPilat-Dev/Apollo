import { describe, expect, it } from 'vitest'
import { cleanCues, cleanSubtitleText, cuePlacement, needsCleaning, placeCues } from '../subtitleText'

describe('cleanSubtitleText', () => {
  it('takes the typesetting out of a real line', () => {
    // Reported verbatim from a library: the whole block is instructions.
    const line =
      '{\\fad(1020,1)\\blur1.2\\3a&H33&\\bord2\\fnTimes New Roman\\c&H1B1B1B&\\3c&HFEFEFE&\\pos(688.521,214.285)}Fifth Epoch, the Iron Age September 9th, 1349'
    expect(cleanSubtitleText(line)).toBe('Fifth Epoch, the Iron Age September 9th, 1349')
  })

  it('keeps italics, which carry meaning', () => {
    // The commonest tag by far, and it is the difference between a thought and
    // a line spoken aloud — dropping it silently loses that.
    expect(cleanSubtitleText('{\\i1}We all experienced a major war{\\i0}.')).toBe(
      '<i>We all experienced a major war</i>.',
    )
  })

  it('keeps bold and underline too', () => {
    expect(cleanSubtitleText('{\\b1}Loud{\\b0} and {\\u1}marked{\\u0}')).toBe(
      '<b>Loud</b> and <u>marked</u>',
    )
  })

  it('leaves dialogue braces alone', () => {
    // "{laughs}" is a real subtitle line. Only a brace group beginning with a
    // backslash is an override block, and ASS guarantees that.
    expect(cleanSubtitleText('{laughs} I see.')).toBe('{laughs} I see.')
    expect(cleanSubtitleText('He said {something}.')).toBe('He said {something}.')
  })

  it('drops drawing commands entirely, coordinates and all', () => {
    // The "text" inside a drawing is vector data. Stripping only the tags
    // around it would print the numbers.
    expect(cleanSubtitleText('{\\p1}m 0 0 l 100 0 100 100 0 100{\\p0}Caption')).toBe('Caption')
  })

  it('drops an unterminated drawing rather than printing it', () => {
    expect(cleanSubtitleText('{\\p1}m 0 0 l 50 50')).toBe('')
  })

  it('turns ASS escapes into what they mean', () => {
    expect(cleanSubtitleText('First line\\NSecond line')).toBe('First line\nSecond line')
    // `\h` is a *hard* space, so it becomes U+00A0 and not an ordinary one —
    // written as an escape here because the two are indistinguishable on screen
    // and a failure between them reads as "expected 'Wide gap' to be 'Wide gap'".
    expect(cleanSubtitleText('Wide\\hgap')).toBe('Wide\u00A0gap')
  })

  it('handles several blocks in one line', () => {
    expect(cleanSubtitleText('{\\an8}{\\fs20}Top{\\r} and bottom')).toBe('Top and bottom')
  })

  it('leaves a plain line untouched', () => {
    expect(cleanSubtitleText('Just dialogue.')).toBe('Just dialogue.')
    expect(cleanSubtitleText('')).toBe('')
  })
})

describe('needsCleaning', () => {
  it('is false for text that would not change', () => {
    expect(needsCleaning('Just dialogue.')).toBe(false)
    expect(needsCleaning('{laughs}')).toBe(false)
  })

  it('is true for anything carrying an override', () => {
    expect(needsCleaning('{\\i1}Hello{\\i0}')).toBe(true)
  })
})

describe('cleanCues', () => {
  const cue = (text: string) => ({ text })

  it('rewrites only the cues that need it, and says how many', () => {
    const cues = [cue('{\\i1}One{\\i0}'), cue('Two'), cue('{\\pos(1,2)}Three')]
    expect(cleanCues(cues)).toBe(2)
    expect(cues.map((c) => c.text)).toEqual(['<i>One</i>', 'Two', 'Three'])
  })

  it('copes with no cues at all', () => {
    // `track.cues` is empty, not null, until the file has loaded — and null
    // when the track was swapped out from under us.
    expect(cleanCues(null)).toBe(0)
    expect(cleanCues([])).toBe(0)
  })

  it('skips anything that is not a cue with text', () => {
    const cues = [{ text: 42 } as unknown as { text: string }, cue('{\\i1}ok{\\i0}')]
    expect(cleanCues(cues)).toBe(1)
  })
})

describe('cuePlacement', () => {
  const at = (n: number) => cuePlacement(`{\\an${n}}Some line`)

  it('reads the keypad layout', () => {
    // 7 8 9 across the top, 4 5 6 middle, 1 2 3 bottom.
    expect(at(1)).toEqual({ align: 'start', linePercent: null })
    expect(at(2)).toEqual({ align: 'center', linePercent: null })
    expect(at(3)).toEqual({ align: 'end', linePercent: null })
    expect(at(4)?.align).toBe('start')
    expect(at(5)?.align).toBe('center')
    expect(at(6)?.align).toBe('end')
    expect(at(7)?.align).toBe('start')
    expect(at(8)?.align).toBe('center')
    expect(at(9)?.align).toBe('end')
  })

  it('sends the top row up and the middle row to the middle', () => {
    expect(at(8)!.linePercent!).toBeLessThan(at(5)!.linePercent!)
    // The bottom row already sits where a cue goes, so it is left alone.
    expect(at(2)!.linePercent).toBeNull()
  })

  it('has nothing to say about a line with no alignment tag', () => {
    expect(cuePlacement('Just dialogue.')).toBeNull()
    expect(cuePlacement('{\\i1}Italic, but unplaced{\\i0}')).toBeNull()
  })

  it('takes the last alignment, as a renderer does', () => {
    expect(cuePlacement('{\\an8}{\\an2}Moved back down')).toEqual({
      align: 'center',
      linePercent: null,
    })
  })

  it('ignores \\pos, which it cannot honestly place', () => {
    // \pos is in the script's own coordinates and the WebVTT has dropped the
    // header saying what those are — the files here range from 1280x720 to
    // 3840x2160, so a percentage from it would be a guess.
    expect(cuePlacement('{\\pos(688.521,214.285)}Fifth Epoch')).toBeNull()
  })

  it('is not fooled by a number that is not an alignment', () => {
    expect(cuePlacement('{\\an0}x')).toBeNull()
    expect(cuePlacement('{\\fs36}x')).toBeNull()
  })
})

describe('placeCues', () => {
  const cue = (text: string) => ({ text, align: 'center', line: 'auto' as number | 'auto', snapToLines: true })

  it('moves only the cues that ask to be moved', () => {
    const cues = [cue('{\\an8}Sign'), cue('Dialogue'), cue('{\\an1}Corner')]
    expect(placeCues(cues)).toBe(2)
    expect(cues[1].line).toBe('auto')
  })

  it('turns snapToLines off, or the number would not be a percentage', () => {
    // Left on, `line` counts lines of text from the top and 10 lands the cue
    // somewhere entirely different.
    const cues = [cue('{\\an8}Top')]
    placeCues(cues)
    expect(cues[0].snapToLines).toBe(false)
    expect(cues[0].line).toBeLessThan(50)
  })

  it('leaves a bottom-row cue where it already sits', () => {
    const cues = [cue('{\\an2}Bottom centre')]
    placeCues(cues)
    expect(cues[0].snapToLines).toBe(true)
    expect(cues[0].line).toBe('auto')
    expect(cues[0].align).toBe('center')
  })

  it('copes with nothing to place', () => {
    expect(placeCues(null)).toBe(0)
    expect(placeCues([])).toBe(0)
  })
})
