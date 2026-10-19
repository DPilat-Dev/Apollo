import { beforeEach, describe, expect, it } from 'vitest'
import {
  acquireScrollLock,
  releaseScrollLock,
  resetScrollLock,
  scrollLockDepth,
  scrollbarGap,
} from '../scrollLock'

beforeEach(() => {
  resetScrollLock()
})

describe('the page scroll lock', () => {
  it('is applied by the first dialog and restored by the last', () => {
    expect(acquireScrollLock()).toBe(true)
    expect(releaseScrollLock()).toBe(true)
    expect(scrollLockDepth()).toBe(0)
  })

  /*
    Two dialogs can be open at once — the admin panels open an editor over a
    library, and either can be closed first. Counted, the inner one closing
    leaves the lock in place; not counted, it would hand the page back to a
    viewer who is still looking at a modal over it.
  */
  it('stays on while a second dialog is still open, whichever closes first', () => {
    expect(acquireScrollLock()).toBe(true)
    expect(acquireScrollLock()).toBe(false)
    expect(releaseScrollLock()).toBe(false)
    expect(scrollLockDepth()).toBe(1)
    expect(releaseScrollLock()).toBe(true)
    expect(scrollLockDepth()).toBe(0)
  })

  /*
    React runs an effect's cleanup exactly once per setup, but a cleanup that
    ran without its setup — a remount in Strict Mode, a hot reload — must not
    push the count below zero, or the next dialog would open with the lock
    already "held" and never apply it.
  */
  it('never counts below zero, so the next dialog still locks the page', () => {
    expect(releaseScrollLock()).toBe(false)
    expect(scrollLockDepth()).toBe(0)
    expect(acquireScrollLock()).toBe(true)
  })
})

describe('scrollbarGap', () => {
  /*
    Hiding the page's overflow removes its scrollbar, and the viewport grows by
    exactly that width — so every centred thing on screen slides sideways as the
    dialog opens. The gap is what gets given back as padding instead.
  */
  it('is the width the scrollbar was occupying', () => {
    expect(scrollbarGap(1440, 1425)).toBe(15)
  })

  /* Overlay scrollbars — phones, macOS — take no width, so there is nothing
     to compensate and no padding to add. */
  it('is nothing at all where the scrollbar floats over the page', () => {
    expect(scrollbarGap(390, 390)).toBe(0)
  })

  /* A zoomed or fractionally-scaled window can report a client width wider
     than the inner width. Negative padding is not a thing to apply. */
  it('is never negative', () => {
    expect(scrollbarGap(1279.5, 1280)).toBe(0)
  })
})
