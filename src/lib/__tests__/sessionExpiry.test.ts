import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  onSessionExpired,
  reportSessionExpired,
  resetSessionExpiry,
  sessionExpiryIsLatched,
  takeSessionExpiredNotice,
} from '../sessionExpiry'
import { ApiError, errorText } from '../api'

beforeEach(() => {
  resetSessionExpiry()
})

describe('a token the server has stopped accepting', () => {
  it('tells whoever is listening', () => {
    const heard = vi.fn()
    onSessionExpired(heard)
    reportSessionExpired()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('tells them once, however many requests were refused', () => {
    /*
      The refusal arrives many times at once because the page asks for many
      things at once — eleven queries on Home, measured. Running the sign-out
      teardown once per 401 would have it fighting itself.
    */
    const heard = vi.fn()
    onSessionExpired(heard)
    for (let i = 0; i < 22; i++) reportSessionExpired()
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it('reaches every listener even if one of them throws', () => {
    // This is the path out of a broken session. A listener failing must not
    // strand the rest, which is how someone ends up stuck on the dead page.
    const after = vi.fn()
    onSessionExpired(() => {
      throw new Error('nope')
    })
    onSessionExpired(after)
    expect(() => reportSessionExpired()).not.toThrow()
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('stops talking to a listener that unsubscribed', () => {
    const heard = vi.fn()
    onSessionExpired(heard)()
    reportSessionExpired()
    expect(heard).not.toHaveBeenCalled()
  })

  it('arms again once somebody signs in', () => {
    const heard = vi.fn()
    onSessionExpired(heard)
    reportSessionExpired()
    expect(sessionExpiryIsLatched()).toBe(true)
    resetSessionExpiry()
    expect(sessionExpiryIsLatched()).toBe(false)
    reportSessionExpired()
    expect(heard).toHaveBeenCalledTimes(2)
  })
})

describe('the notice on the sign-in screen', () => {
  it('is owed after a session dies', () => {
    reportSessionExpired()
    expect(takeSessionExpiredNotice()).toBe(true)
  })

  it('is not owed to somebody who simply opened the app', () => {
    expect(takeSessionExpiredNotice()).toBe(false)
  })

  it('is paid exactly once', () => {
    // Otherwise it greets someone who later signed out on purpose and came
    // back, telling them their session died when they ended it themselves.
    reportSessionExpired()
    expect(takeSessionExpiredNotice()).toBe(true)
    expect(takeSessionExpiredNotice()).toBe(false)
  })

  it('is cleared by signing in, not just by being read', () => {
    reportSessionExpired()
    resetSessionExpiry()
    expect(takeSessionExpiredNotice()).toBe(false)
  })
})

describe('what a failure says to the person reading it', () => {
  const transport = () =>
    new ApiError('GET /UserItems/Resume failed (401)', 401, '', true)

  it('uses the screen’s own sentence instead of the method and path', () => {
    /*
      Measured before this existed: a revoked token put `GET /Items failed
      (401)` on every row of Home, beside a Retry button that could not work.
      The good sentence was already written at each call site and unreachable,
      because an ApiError is an Error and the ternary never reached its
      fallback.
    */
    expect(errorText(transport(), "This row couldn't load.")).toBe("This row couldn't load.")
  })

  it('keeps a message that was written for a person', () => {
    expect(errorText(new ApiError('Incorrect username or password.', 401), 'Sign-in failed.')).toBe(
      'Incorrect username or password.',
    )
  })

  it('keeps an ordinary error’s message, which is usually the real reason', () => {
    expect(errorText(new Error('Load failed'), 'Could not load.')).toBe('Load failed')
  })

  it('falls back for anything that is not an error at all', () => {
    for (const thrown of [null, undefined, 'a string', 42, {}, new Error('')]) {
      expect(errorText(thrown, 'Could not load.')).toBe('Could not load.')
    }
  })

  it('still carries the technical text for the places that want it', () => {
    // The player shows the server's actual reason on a failed PlaybackInfo,
    // and the dashboard shows it on a failed save. Marking a message as
    // technical hides it from viewers; it must not destroy it.
    const err = transport()
    expect(err.message).toContain('/UserItems/Resume')
    expect(err.status).toBe(401)
  })
})
