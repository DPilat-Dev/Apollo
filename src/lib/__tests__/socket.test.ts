import { describe, expect, it } from 'vitest'
import { reconnectDelayMs, socketUrl } from '../socket'

describe('socketUrl', () => {
  const session = { token: 'tok', server: 'https://jf.example.com' }

  it('upgrades the scheme to wss for an https server', () => {
    expect(socketUrl(session)).toMatch(/^wss:\/\/jf\.example\.com\/socket\?/)
  })

  it('uses ws for a plain-http server', () => {
    expect(socketUrl({ ...session, server: 'http://192.168.1.23:8096' })).toMatch(
      /^ws:\/\/192\.168\.1\.23:8096\/socket\?/,
    )
  })

  it('carries the token, since a browser cannot set socket headers', () => {
    expect(new URL(socketUrl(session)).searchParams.get('api_key')).toBe('tok')
    expect(new URL(socketUrl(session)).searchParams.get('deviceId')).toBeTruthy()
  })

  it('does not mangle a server URL that already has a trailing slash', () => {
    expect(socketUrl({ ...session, server: 'https://jf.example.com/' })).toMatch(
      /^wss:\/\/jf\.example\.com\/socket\?/,
    )
  })
})

/**
 * Uncapped doubling would leave a device that dropped out overnight waiting
 * hours to rejoin; a fixed short delay would hammer a server that is down.
 */
describe('reconnectDelayMs', () => {
  it('backs off by doubling', () => {
    expect(reconnectDelayMs(0)).toBe(1000)
    expect(reconnectDelayMs(1)).toBe(2000)
    expect(reconnectDelayMs(3)).toBe(8000)
  })

  it('caps so reconnection stays possible', () => {
    expect(reconnectDelayMs(99)).toBe(30_000)
  })

  it('treats a negative attempt as the first', () => {
    expect(reconnectDelayMs(-5)).toBe(1000)
  })
})
