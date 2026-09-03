import { describe, expect, it } from 'vitest'
import { version as packageVersion } from '../../../package.json'
import { authHeader, CLIENT_VERSION } from '../api'

/**
 * Regression: the version was typed out by hand and stayed at 1.0.0 from the
 * 1.0.0 release through 1.4.0. Jellyfin stores it against the session, so the
 * admin dashboard's Active Sessions and the Devices list attributed every
 * Apollo session — for four releases — to a client that no longer existed.
 *
 * Nothing self-corrects a literal, so the check has to live somewhere a
 * release runs. These assertions are the contract: one source of truth, and
 * neither of the two ways it has failed before.
 */
describe('the version Apollo reports', () => {
  it('is package.json’s, so cutting a release is the only edit', () => {
    expect(CLIENT_VERSION).toBe(packageVersion)
  })

  it('is never the stale 1.0.0 again', () => {
    expect(CLIENT_VERSION).not.toBe('1.0.0')
  })

  /**
   * The other failure this guards is a build-time define that never reaches
   * the test run: the constant would be undefined and `Version="undefined"`
   * would go to the server, which is worse than a stale number because it
   * looks like a client bug rather than a wrong label.
   */
  it('is a real version string, not undefined or the fallback', () => {
    expect(CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+/)
    expect(CLIENT_VERSION).not.toContain('undefined')
    expect(CLIENT_VERSION).not.toBe('0.0.0-unknown')
  })

  it('reaches the auth header the server actually reads', () => {
    expect(authHeader('tok')).toContain(`Version="${packageVersion}"`)
  })
})
