import { describe, expect, it } from 'vitest'
import { BUILT_IN_SERVER, defaultServer, usableServer } from '../defaultServer'

describe('usableServer', () => {
  it('accepts an http or https origin', () => {
    expect(usableServer('http://192.168.1.23:8096')).toBe('http://192.168.1.23:8096')
    expect(usableServer('https://jellyfin.example.com')).toBe('https://jellyfin.example.com')
  })

  it('trims what someone pasted', () => {
    expect(usableServer('  http://box:8096  ')).toBe('http://box:8096')
  })

  it('refuses anything that is not an address', () => {
    // This value is put in a field and then fetched from.
    for (const v of ['', '   ', 'box:8096', 'javascript:alert(1)', 'file:///etc/passwd', null, undefined, 42]) {
      expect(usableServer(v)).toBe('')
    }
  })
})

describe('defaultServer', () => {
  it('uses what this browser has signed in to before', () => {
    // They have already answered this question, possibly with a different
    // address than the install suggests. Being moved off it is worse than
    // being asked.
    expect(
      defaultServer({
        remembered: 'http://remembered:8096',
        fromRuntime: 'http://runtime:8096',
        builtIn: 'http://built-in:8096',
      }),
    ).toBe('http://remembered:8096')
  })

  it('falls back to what the install was configured with', () => {
    // The private-window case: no memory, and since releases ship a prebuilt
    // client, nothing compiled in either.
    expect(defaultServer({ fromRuntime: 'http://runtime:8096', builtIn: '' })).toBe(
      'http://runtime:8096',
    )
  })

  it('falls back to a compiled-in address for a self-built deployment', () => {
    expect(defaultServer({ builtIn: 'http://built-in:8096' })).toBe('http://built-in:8096')
  })

  it('prefers the install over the build, since the build may be someone else’s', () => {
    expect(
      defaultServer({ fromRuntime: 'http://runtime:8096', builtIn: 'http://built-in:8096' }),
    ).toBe('http://runtime:8096')
  })

  it('leaves the field empty rather than filling it with rubbish', () => {
    expect(defaultServer({ remembered: 'not-an-address', fromRuntime: '', builtIn: '' })).toBe('')
  })

  it('falls back to the compiled-in address when none is passed', () => {
    // Omitting `builtIn` is not the same as passing an empty one — it means
    // "whatever this bundle was built with", which is how a self-built
    // deployment has always worked.
    expect(defaultServer({})).toBe(BUILT_IN_SERVER)
  })

  /*
    An install with no VITE_JELLYFIN_SERVER set gets an empty string from
    /__apollo/config, and that must stay empty rather than becoming something
    the sign-in screen tries to connect to. The screen only auto-connects to a
    non-empty answer, so this is the guard that keeps a deployment that has not
    configured an address from reaching for one.
  */
  it('reports nothing when the install has no address configured', () => {
    expect(usableServer('')).toBe('')
    expect(defaultServer({ fromRuntime: '', builtIn: '' })).toBe('')
    expect(defaultServer({ remembered: null, fromRuntime: undefined, builtIn: '' })).toBe('')
  })

  it('skips a remembered value that is not usable', () => {
    expect(defaultServer({ remembered: 'nonsense', fromRuntime: 'http://runtime:8096' })).toBe(
      'http://runtime:8096',
    )
  })
})
