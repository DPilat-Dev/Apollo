import { describe, expect, it } from 'vitest'
import {
  SCRUBBER_PAGE_SECONDS,
  SCRUBBER_STEP_SECONDS,
  durationKnown,
  scrubberKeySeek,
} from '../scrubber'

const film = { current: 600, duration: 7200 }

describe('scrubberKeySeek', () => {
  it('sends Home to the beginning and End to the end', () => {
    expect(scrubberKeySeek('Home', film)).toBe(0)
    expect(scrubberKeySeek('End', film)).toBe(7200)
  })

  it('pages by a minute, the way Shift and an arrow do', () => {
    expect(scrubberKeySeek('PageUp', film)).toBe(600 + SCRUBBER_PAGE_SECONDS)
    expect(scrubberKeySeek('PageDown', film)).toBe(600 - SCRUBBER_PAGE_SECONDS)
  })

  // Paging near either end must land on the end rather than outside the title:
  // a negative currentTime throws, and one past the duration is silently
  // ignored by some browsers and clamped by others.
  it('never pages off either end', () => {
    expect(scrubberKeySeek('PageDown', { current: 12, duration: 7200 })).toBe(0)
    expect(scrubberKeySeek('PageUp', { current: 7190, duration: 7200 })).toBe(7200)
  })

  /*
    Left and Right belong to the player's global shortcut handler, which seeks
    ten seconds and sixty with Shift wherever focus is. Claiming them here too
    would move the film twice for one press.
  */
  it('leaves the horizontal arrows to the shortcut handler', () => {
    expect(scrubberKeySeek('ArrowLeft', film)).toBeNull()
    expect(scrubberKeySeek('ArrowRight', film)).toBeNull()
    expect(scrubberKeySeek('k', film)).toBeNull()
  })

  /*
    Up and Down it does have to answer. The window handler reads them as the
    volume, so on a control announced as a slider they moved the sound instead
    of the film — half the arrow keys the role promises, silently doing
    something else. The bar stops these two reaching the window, which is why
    the Shift step has to be applied here as well.
  */
  it('seeks on the vertical arrows, by the same step as the horizontal ones', () => {
    expect(scrubberKeySeek('ArrowUp', film)).toBe(600 + SCRUBBER_STEP_SECONDS)
    expect(scrubberKeySeek('ArrowDown', film)).toBe(600 - SCRUBBER_STEP_SECONDS)
    expect(scrubberKeySeek('ArrowUp', film, { shift: true })).toBe(600 + SCRUBBER_PAGE_SECONDS)
    expect(scrubberKeySeek('ArrowDown', film, { shift: true })).toBe(600 - SCRUBBER_PAGE_SECONDS)
  })

  it('never steps off either end either', () => {
    expect(scrubberKeySeek('ArrowDown', { current: 4, duration: 7200 })).toBe(0)
    expect(scrubberKeySeek('ArrowUp', { current: 7195, duration: 7200 })).toBe(7200)
  })

  // Live, or a stream whose duration has not arrived: there is no position to
  // seek to yet, and NaN reaches video.currentTime as an exception.
  it('does nothing until the duration is known', () => {
    expect(scrubberKeySeek('Home', { current: 0, duration: 0 })).toBeNull()
    expect(scrubberKeySeek('End', { current: 0, duration: Number.NaN })).toBeNull()
    expect(scrubberKeySeek('End', { current: 0, duration: Number.POSITIVE_INFINITY })).toBeNull()
  })
})

/*
  One rule in one place. The component asks this to decide whether to announce a
  position at all, and `scrubberKeySeek` asks it before answering a key — the
  two used to carry the same condition written in opposite directions, in
  different files.
*/
describe('durationKnown', () => {
  it('accepts a title whose length the server has given', () => {
    expect(durationKnown(7200)).toBe(true)
  })

  it('rejects the lengths that make a position meaningless', () => {
    // Zero is a stream that has not said yet; infinity is live. A seek into
    // either is a seek to nowhere, and NaN reaches currentTime as an exception.
    expect(durationKnown(0)).toBe(false)
    expect(durationKnown(Number.POSITIVE_INFINITY)).toBe(false)
    expect(durationKnown(Number.NaN)).toBe(false)
    expect(durationKnown(-5)).toBe(false)
  })
})
