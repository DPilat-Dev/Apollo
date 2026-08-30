import { describe, expect, it } from 'vitest'
import { orientationLockTarget, shouldEnterFullscreen, type OrientationEnv } from '../orientation'

const env = (over: Partial<OrientationEnv> = {}): OrientationEnv => ({
  supported: true,
  coarsePointer: true,
  fullscreen: true,
  enabled: true,
  ...over,
})

describe('orientationLockTarget', () => {
  it('turns a phone sideways once it is fullscreen', () => {
    expect(orientationLockTarget(env())).toBe('landscape')
  })

  it('does nothing outside fullscreen', () => {
    // The API rejects a lock that is not fullscreen, so asking is not free —
    // it is an unhandled rejection on every player that opens.
    expect(orientationLockTarget(env({ fullscreen: false }))).toBeNull()
  })

  it('does nothing where the browser has no lock at all', () => {
    // iOS Safari, and desktop Firefox.
    expect(orientationLockTarget(env({ supported: false }))).toBeNull()
  })

  it('leaves a desktop alone', () => {
    // A monitor does not rotate. Locking one is at best meaningless and at
    // worst pins a laptop's display the wrong way round.
    expect(orientationLockTarget(env({ coarsePointer: false }))).toBeNull()
  })

  it('respects the setting being off', () => {
    expect(orientationLockTarget(env({ enabled: false }))).toBeNull()
  })
})

describe('shouldEnterFullscreen', () => {
  const fs = (over = {}) => shouldEnterFullscreen({
    enabled: true, coarsePointer: true, playing: true, alreadyFullscreen: false, alreadyTried: false, ...over,
  })

  it('goes fullscreen when a phone starts playing', () => {
    expect(fs()).toBe(true)
  })

  it('never does it on a desktop', () => {
    // Hijacking the whole screen because a video started is not acceptable
    // behaviour on a machine with a window manager.
    expect(fs({ coarsePointer: false })).toBe(false)
  })

  it('waits until something is actually playing', () => {
    expect(fs({ playing: false })).toBe(false)
  })

  it('does not fight someone who left fullscreen', () => {
    // The whole point of the once-only guard: without it, pressing Escape
    // puts you straight back in, and the player becomes impossible to leave.
    expect(fs({ alreadyTried: true })).toBe(false)
  })

  it('does nothing when already fullscreen', () => {
    expect(fs({ alreadyFullscreen: true })).toBe(false)
  })

  it('respects the setting being off', () => {
    expect(fs({ enabled: false })).toBe(false)
  })
})
