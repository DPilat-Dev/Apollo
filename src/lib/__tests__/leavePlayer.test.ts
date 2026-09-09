import { describe, expect, it } from 'vitest'
import { backDestination, canGoBackInApp } from '../leavePlayer'

describe('canGoBackInApp', () => {
  it('is true once the app has a screen behind this one', () => {
    expect(canGoBackInApp({ idx: 1 })).toBe(true)
    expect(canGoBackInApp({ idx: 7 })).toBe(true)
  })

  it('is false on the first entry of the document', () => {
    // Opening a video directly, or refreshing on it. Going back from here
    // loads a new document, and a document being torn down does not run
    // React's cleanups — so the stop report never happens.
    expect(canGoBackInApp({ idx: 0 })).toBe(false)
  })

  it('is false when the router has not numbered anything', () => {
    // A plain history entry the router did not create.
    expect(canGoBackInApp(null)).toBe(false)
    expect(canGoBackInApp(undefined)).toBe(false)
    expect(canGoBackInApp({})).toBe(false)
    expect(canGoBackInApp('nonsense')).toBe(false)
    expect(canGoBackInApp({ idx: 'two' })).toBe(false)
  })
})

describe('backDestination', () => {
  it('pops the previous screen when there is one', () => {
    expect(backDestination({ idx: 3 })).toBe(-1)
  })

  it('goes home rather than out of the app', () => {
    // The whole point: home is a client-side navigation, so the player
    // unmounts properly and reports where the viewer had reached.
    expect(backDestination({ idx: 0 })).toBe('/')
    expect(backDestination(null)).toBe('/')
  })
})
