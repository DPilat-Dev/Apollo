import { describe, expect, it } from 'vitest'
import { FOCUSABLE_SELECTOR, initialFocus, isDismissKey, trapTarget } from '../dialogFocus'

describe('isDismissKey', () => {
  it('is Escape', () => {
    expect(isDismissKey('Escape')).toBe(true)
  })

  it('is also the name older browsers report', () => {
    expect(isDismissKey('Esc')).toBe(true)
  })

  it('is nothing else', () => {
    for (const k of ['Enter', 'Tab', 'e', 'escape', ' ']) expect(isDismissKey(k)).toBe(false)
  })
})

describe('trapTarget', () => {
  const items = ['a', 'b', 'c'] as const

  it('lets the browser handle the middle of the cycle', () => {
    // The important answer. A trap that intercepts every Tab has to
    // reimplement document order, and gets it wrong for whatever it forgot.
    expect(trapTarget({ items, active: 'b' })).toBeNull()
    expect(trapTarget({ items, active: 'b', backwards: true })).toBeNull()
  })

  it('wraps forward off the end', () => {
    expect(trapTarget({ items, active: 'c' })).toBe('a')
  })

  it('wraps backward off the start', () => {
    expect(trapTarget({ items, active: 'a', backwards: true })).toBe('c')
  })

  it('does not wrap forward at the start', () => {
    expect(trapTarget({ items, active: 'a' })).toBeNull()
  })

  it('does not wrap backward at the end', () => {
    expect(trapTarget({ items, active: 'c', backwards: true })).toBeNull()
  })

  it('pulls focus back when it has escaped the dialog', () => {
    // Happens for real: the address bar takes focus and hands it back to the
    // document, outside the dialog that is still covering the screen.
    expect(trapTarget({ items, active: 'elsewhere' })).toBe('a')
    expect(trapTarget({ items, active: null })).toBe('a')
    expect(trapTarget({ items, active: undefined, backwards: true })).toBe('c')
  })

  it('has nothing to say about an empty dialog', () => {
    expect(trapTarget({ items: [], active: null })).toBeNull()
  })

  it('sends a single element back to itself', () => {
    // One button, and Tab must not leave it.
    expect(trapTarget({ items: ['only'], active: 'only' })).toBe('only')
    expect(trapTarget({ items: ['only'], active: 'only', backwards: true })).toBe('only')
  })
})

describe('initialFocus', () => {
  it('starts on the first focusable thing', () => {
    expect(initialFocus(['a', 'b'], 'container')).toBe('a')
  })

  it('falls back to the dialog itself when it holds nothing focusable', () => {
    // Focus has to land somewhere; leaving it on the opener means Escape and
    // Tab both apply to the page behind the dialog.
    expect(initialFocus([], 'container')).toBe('container')
  })
})

describe('FOCUSABLE_SELECTOR', () => {
  it('excludes tabindex -1, which is what the container uses', () => {
    // The dialog takes focus on open without joining the cycle it defines.
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])')
  })

  it('skips disabled controls', () => {
    for (const tag of ['button', 'input', 'select', 'textarea']) {
      expect(FOCUSABLE_SELECTOR).toContain(`${tag}:not([disabled])`)
    }
  })
})
