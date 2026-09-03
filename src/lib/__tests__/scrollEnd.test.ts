import { describe, expect, it } from 'vitest'
import { atScrollEnd } from '../scrollEnd'

const strip = (scrollLeft: number, clientWidth: number, scrollWidth: number) =>
  ({ scrollLeft, clientWidth, scrollWidth }) as HTMLElement

describe('atScrollEnd', () => {
  it('says yes for a strip that does not scroll at all', () => {
    // The case the browser cannot easily be put in, and the one that matters:
    // a row that fits has no end to be short of, so a fade over it is a lie.
    expect(atScrollEnd(strip(0, 1200, 1200))).toBe(true)
    expect(atScrollEnd(strip(0, 1200, 900))).toBe(true)
  })

  it('says no while there is more to the right', () => {
    expect(atScrollEnd(strip(0, 1264, 1341))).toBe(false)
    expect(atScrollEnd(strip(40, 1264, 1341))).toBe(false)
  })

  it('says yes once the end is reached', () => {
    expect(atScrollEnd(strip(77, 1264, 1341))).toBe(true)
  })

  it('tolerates a fractional layout landing a hair short', () => {
    // Without the slack the fade never quite goes away, which reads as broken.
    expect(atScrollEnd(strip(76.4, 1264, 1341))).toBe(true)
  })

  it('says yes when there is no element yet', () => {
    // Before the first paint, drawing a fade over nothing is the wrong guess.
    expect(atScrollEnd(null)).toBe(true)
  })
})
