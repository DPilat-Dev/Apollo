import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  GROUP_PREVIEW,
  STALE_AFTER_DAYS,
  deviceActivityAt,
  deviceScopes,
  devicesRequest,
  revokeMessage,
  revokePlan,
  runDeviceRevoke,
  summariseDevices,
  visibleDevices,
  type DeviceInfo,
} from '../devices'

const NOW = Date.parse('2026-08-19T12:00:00Z')
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString()

const device = (partial: Partial<DeviceInfo>): DeviceInfo => ({
  Id: 'id',
  Name: 'Chrome',
  AppName: 'Jellyfin Web',
  DateLastActivity: daysAgo(1),
  ...partial,
})

const summarise = (devices: DeviceInfo[], currentDeviceId = 'this-one') =>
  summariseDevices({ devices, currentDeviceId, now: NOW })

describe('deviceActivityAt', () => {
  it('reads an ISO instant', () => {
    expect(deviceActivityAt('2026-08-19T12:00:00Z')).toBe(NOW)
  })

  it('reads a stamp that carries no zone as UTC', () => {
    // Jellyfin serialises these from UTC and sometimes omits the Z. Handing
    // that to Date() makes it *local* time, which on a UK evening dates the
    // session an hour into the future and sorts it above the phone in hand.
    expect(deviceActivityAt('2026-08-19T12:00:00')).toBe(NOW)
    expect(deviceActivityAt('2026-08-19T12:00:00.1234567')).toBe(NOW + 123)
  })

  it('gives nothing back for a missing or unreadable stamp', () => {
    for (const value of [undefined, null, '', '   ', 'never', '0001-01-01T00:00:00']) {
      expect(deviceActivityAt(value)).toBeNull()
    }
  })
})

describe('summariseDevices', () => {
  it('survives a server with no devices at all', () => {
    const overview = summarise([])
    expect(overview.rows).toEqual([])
    expect(overview.groups).toEqual([])
    expect(overview.current).toBeNull()
    expect(overview.total).toBe(0)
    expect(overview.staleCount).toBe(0)
  })

  it('finds the device in hand wherever the server happened to list it', () => {
    // The server orders by nothing in particular, so the current device is as
    // likely to be 140th as first. Missing it is what silently signs someone
    // out of the browser they are sitting in.
    const overview = summarise([
      device({ Id: 'a', DateLastActivity: daysAgo(2) }),
      device({ Id: 'b', DateLastActivity: daysAgo(3) }),
      device({ Id: 'this-one', Name: 'Firefox', DateLastActivity: daysAgo(400) }),
      device({ Id: 'c', DateLastActivity: daysAgo(4) }),
    ])
    expect(overview.current?.id).toBe('this-one')
    expect(overview.rows[0].id).toBe('this-one')
    expect(overview.rows[0].isCurrent).toBe(true)
    expect(overview.rows.filter((r) => r.isCurrent)).toHaveLength(1)
  })

  it('leads with whatever was used most recently', () => {
    const overview = summarise([
      device({ Id: 'old', DateLastActivity: daysAgo(9) }),
      device({ Id: 'new', DateLastActivity: daysAgo(1) }),
      device({ Id: 'middle', DateLastActivity: daysAgo(4) }),
    ])
    expect(overview.rows.map((r) => r.id)).toEqual(['new', 'middle', 'old'])
  })

  it('sinks devices whose last activity is missing or unreadable', () => {
    // Unparseable used to fall out as NaN, which compares false against
    // everything and left the sort order down to the input.
    const overview = summarise([
      device({ Id: 'unknown', DateLastActivity: 'not a date' }),
      device({ Id: 'missing', DateLastActivity: undefined }),
      device({ Id: 'ancient', DateLastActivity: daysAgo(900) }),
    ])
    expect(overview.rows.map((r) => r.id)).toEqual(['ancient', 'unknown', 'missing'])
    expect(overview.rows[1].lastActive).toBeNull()
    expect(overview.rows[1].lastActiveLabel).toMatch(/unknown/i)
  })

  it(`calls a device stale after ${STALE_AFTER_DAYS} days, and counts the never-seen with them`, () => {
    const overview = summarise([
      device({ Id: 'fresh', DateLastActivity: daysAgo(STALE_AFTER_DAYS - 1) }),
      device({ Id: 'stale', DateLastActivity: daysAgo(STALE_AFTER_DAYS + 1) }),
      device({ Id: 'never', DateLastActivity: undefined }),
    ])
    const stale = Object.fromEntries(overview.rows.map((r) => [r.id, r.stale]))
    expect(stale).toEqual({ fresh: false, stale: true, never: true })
    expect(overview.staleCount).toBe(2)
  })

  it('never calls the device in hand stale', () => {
    // It is in use by definition, and a sweep that counted it would offer to
    // sign the viewer out as housekeeping.
    const overview = summarise([
      device({ Id: 'this-one', DateLastActivity: daysAgo(900) }),
      device({ Id: 'other', DateLastActivity: daysAgo(900) }),
    ])
    expect(overview.current?.stale).toBe(false)
    expect(overview.staleCount).toBe(1)
  })

  it('reads a clock that runs ahead of ours as "now" rather than the future', () => {
    const overview = summarise([
      device({ Id: 'ahead', DateLastActivity: new Date(NOW + 3_600_000).toISOString() }),
    ])
    expect(overview.rows[0].stale).toBe(false)
    expect(overview.rows[0].lastActiveLabel).toMatch(/now/i)
  })

  it('drops entries with no id, since nothing could be revoked', () => {
    const overview = summarise([device({ Id: undefined }), device({ Id: 'real' })])
    expect(overview.rows.map((r) => r.id)).toEqual(['real'])
    expect(overview.total).toBe(1)
  })

  it('collapses a list where every entry is the same app into one group', () => {
    const overview = summarise([
      device({ Id: 'a', AppName: 'Jellyfin Web' }),
      device({ Id: 'b', AppName: 'jellyfin web' }),
      device({ Id: 'c', AppName: 'Jellyfin Web' }),
    ])
    expect(overview.groups).toHaveLength(1)
    expect(overview.groups[0].appName).toBe('Jellyfin Web')
    expect(overview.groups[0].devices.map((d) => d.id)).toEqual(['a', 'b', 'c'])
  })

  it('puts the group holding this device first, then the most recently used', () => {
    const overview = summarise([
      device({ Id: 'x', AppName: 'Findroid', DateLastActivity: daysAgo(1) }),
      device({ Id: 'y', AppName: 'Infuse', DateLastActivity: daysAgo(30) }),
      device({ Id: 'this-one', AppName: 'Apollo', DateLastActivity: daysAgo(200) }),
    ])
    expect(overview.groups.map((g) => g.appName)).toEqual(['Apollo', 'Findroid', 'Infuse'])
    expect(overview.groups[0].containsCurrent).toBe(true)
  })

  it('still orders the groups when not one of them has a usable date', () => {
    // Two nulls subtracted from each other is NaN, and a comparator that
    // returns NaN leaves the order to the engine.
    const overview = summarise([
      device({ Id: 'a', AppName: 'Zed', DateLastActivity: undefined }),
      device({ Id: 'b', AppName: 'Alpha', DateLastActivity: 'junk' }),
    ])
    expect(overview.groups.map((g) => g.appName)).toEqual(['Alpha', 'Zed'])
  })

  it('names the nameless rather than showing a blank row', () => {
    const overview = summarise([device({ Id: 'a', Name: '', AppName: undefined })])
    expect(overview.rows[0].name).toBeTruthy()
    expect(overview.rows[0].appName).toBeTruthy()
    expect(overview.groups[0].staleCount).toBe(0)
  })
})

describe('devicesRequest', () => {
  it('filters an admin to their own devices when they ask for theirs', () => {
    expect(devicesRequest({ isAdmin: true, scope: 'mine', userId: 'u1' })).toEqual({ userId: 'u1' })
  })

  it('omits the filter only for an admin asking for the whole server', () => {
    expect(devicesRequest({ isAdmin: true, scope: 'everyone', userId: 'u1' })).toEqual({})
  })

  it('refuses to ask at all on behalf of a non-admin', () => {
    // /Devices is an elevated route on the server, so a non-admin's request
    // comes back 403 whatever userId it carries. Not asking is the difference
    // between a hidden section and an error box on everyone's settings page.
    expect(devicesRequest({ isAdmin: false, scope: 'everyone', userId: 'u1' })).toBeNull()
    expect(devicesRequest({ isAdmin: false, scope: 'mine', userId: 'u1' })).toBeNull()
  })
})

describe('deviceScopes', () => {
  it('offers an admin both views', () => {
    expect(deviceScopes(true)).toEqual(['mine', 'everyone'])
  })

  it('offers a non-admin nothing, so the section never renders', () => {
    expect(deviceScopes(false)).toEqual([])
  })
})

describe('revokePlan', () => {
  const overview = summarise([
    device({ Id: 'this-one', Name: 'Firefox', AppName: 'Apollo' }),
    device({ Id: 'fresh', Name: 'Chrome', DateLastActivity: daysAgo(2) }),
    device({ Id: 'old-1', DateLastActivity: daysAgo(120) }),
    device({ Id: 'old-2', DateLastActivity: undefined }),
  ])

  it('names the device and who last used it when signing out one', () => {
    const plan = revokePlan(overview.rows, { kind: 'one', id: 'fresh' })
    expect(plan?.ids).toEqual(['fresh'])
    expect(plan?.currentId).toBeNull()
    expect(plan?.prompt).toContain('Chrome')
  })

  it('spells out the consequence when the target is the device in hand', () => {
    const plan = revokePlan(overview.rows, { kind: 'one', id: 'this-one' })
    expect(plan?.ids).toEqual(['this-one'])
    expect(plan?.currentId).toBe('this-one')
    expect(plan?.prompt).toMatch(/using right now/i)
    expect(plan?.prompt).toMatch(/sign in again|password/i)
  })

  it('keeps this device out of "everything else"', () => {
    const plan = revokePlan(overview.rows, { kind: 'others' })
    expect(plan?.ids.sort()).toEqual(['fresh', 'old-1', 'old-2'])
    expect(plan?.currentId).toBeNull()
    expect(plan?.prompt).toContain('3')
  })

  it('sweeps only the stale ones', () => {
    const plan = revokePlan(overview.rows, { kind: 'stale' })
    expect(plan?.ids.sort()).toEqual(['old-1', 'old-2'])
    expect(plan?.currentId).toBeNull()
  })

  it('has nothing to plan for an empty list, an unknown id, or a clean server', () => {
    expect(revokePlan([], { kind: 'others' })).toBeNull()
    expect(revokePlan([], { kind: 'stale' })).toBeNull()
    expect(revokePlan(overview.rows, { kind: 'one', id: 'gone' })).toBeNull()
    const onlyMine = summarise([device({ Id: 'this-one' })])
    expect(revokePlan(onlyMine.rows, { kind: 'others' })).toBeNull()
    expect(revokePlan(onlyMine.rows, { kind: 'stale' })).toBeNull()
  })
})

describe('runDeviceRevoke', () => {
  const plan = (ids: string[], currentId: string | null = null) => ({
    ids,
    currentId,
    prompt: 'sure?',
  })

  it('asks before deleting anything', async () => {
    const revoke = vi.fn(() => Promise.resolve())
    const outcome = await runDeviceRevoke({
      plan: plan(['a', 'b']),
      revoke,
      confirm: () => false,
    })
    expect(revoke).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ cancelled: true, succeeded: 0, endedSession: false })
  })

  it('revokes every id it was given', async () => {
    const seen: string[] = []
    const outcome = await runDeviceRevoke({
      plan: plan(['a', 'b', 'c']),
      revoke: (id) => {
        seen.push(id)
        return Promise.resolve()
      },
      confirm: () => true,
    })
    expect(seen.sort()).toEqual(['a', 'b', 'c'])
    expect(outcome).toMatchObject({ requested: 3, succeeded: 3, failed: 0, cancelled: false })
  })

  it('keeps going when one refuses, and says how many did not go', async () => {
    const outcome = await runDeviceRevoke({
      plan: plan(['a', 'bad', 'c']),
      revoke: (id) => (id === 'bad' ? Promise.reject(new Error('403')) : Promise.resolve()),
      confirm: () => true,
    })
    expect(outcome).toMatchObject({ requested: 3, succeeded: 2, failed: 1 })
  })

  it('ends the local session only once this device has actually gone', async () => {
    const ended = await runDeviceRevoke({
      plan: plan(['mine'], 'mine'),
      revoke: () => Promise.resolve(),
      confirm: () => true,
    })
    expect(ended.endedSession).toBe(true)

    // The opposite matters more: dropping to the sign-in screen after a failed
    // delete would look exactly like a successful revoke of the wrong device.
    const kept = await runDeviceRevoke({
      plan: plan(['mine'], 'mine'),
      revoke: () => Promise.reject(new Error('500')),
      confirm: () => true,
    })
    expect(kept.endedSession).toBe(false)
  })

  it('leaves this device until last so its token can carry the others', async () => {
    // Revoking the token in use first makes every delete after it a 401.
    const seen: string[] = []
    await runDeviceRevoke({
      plan: plan(['mine', 'a', 'b'], 'mine'),
      revoke: (id) => {
        seen.push(id)
        return Promise.resolve()
      },
      confirm: () => true,
    })
    expect(seen.at(-1)).toBe('mine')
  })
})

describe('revokeMessage', () => {
  const outcome = (over: Partial<ReturnType<typeof base>> = {}) => ({ ...base(), ...over })
  function base() {
    return { requested: 0, succeeded: 0, failed: 0, cancelled: false, endedSession: false }
  }

  it('says nothing when the viewer backed out', () => {
    expect(revokeMessage(outcome({ cancelled: true }))).toBeNull()
  })

  it('counts what went', () => {
    expect(revokeMessage(outcome({ requested: 1, succeeded: 1 }))).toMatch(/1 device/)
    expect(revokeMessage(outcome({ requested: 12, succeeded: 12 }))).toMatch(/12 devices/)
  })

  it('never reads as success when part of it failed', () => {
    const message = revokeMessage(outcome({ requested: 12, succeeded: 9, failed: 3 }))
    expect(message).toContain('9')
    expect(message).toContain('12')
    const none = revokeMessage(outcome({ requested: 4, succeeded: 0, failed: 4 }))
    expect(none).toMatch(/nothing|none/i)
  })
})

describe('visibleDevices', () => {
  const group = (count: number) => ({
    key: 'g',
    appName: 'Jellyfin Web',
    devices: Array.from({ length: count }, (_, i) => ({ id: `d${i}` }) as never),
    staleCount: 0,
    containsCurrent: false,
    lastActive: null,
  })

  it('shows a short group whole', () => {
    expect(visibleDevices(group(GROUP_PREVIEW), false)).toMatchObject({ hidden: 0 })
  })

  it('holds the tail of a long group back until it is asked for', () => {
    // The real server has 168 of these; rendering them all is the reason a
    // list like this goes unused.
    const folded = visibleDevices(group(168), false)
    expect(folded.rows).toHaveLength(GROUP_PREVIEW)
    expect(folded.hidden).toBe(168 - GROUP_PREVIEW)
    expect(visibleDevices(group(168), true)).toMatchObject({ hidden: 0 })
  })
})

// ------------------------------------------------------------ api wiring

/**
 * The gate and the current-device flag are only worth anything if the method
 * that talks to the server actually uses them, so these go through the api
 * rather than the pure functions.
 */
describe('api.devices', () => {
  afterEach(() => vi.unstubAllGlobals())

  function stub(devices: DeviceInfo[] = []) {
    const urls: { url: string; method: string }[] = []
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k === 'apollo.deviceId' ? 'this-one' : null),
      setItem: () => {},
    })
    vi.stubGlobal('navigator', { userAgent: 'Chrome/1' })
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      urls.push({ url: String(url), method: init?.method ?? 'GET' })
      return Promise.resolve(
        new Response(JSON.stringify({ Items: devices }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    return urls
  }

  const makeApi = async () => {
    const { JellyfinApi } = await import('../api')
    return new JellyfinApi({ server: 'http://s', userId: 'u1', userName: 'D', token: 't' })
  }

  it('never asks the server on behalf of a non-admin', async () => {
    const urls = stub([device({ Id: 'a' })])
    const api = await makeApi()
    const overview = await api.devices({ isAdmin: false, scope: 'mine' })
    expect(urls).toEqual([])
    expect(overview.rows).toEqual([])
  })

  it('filters to the signed-in user by default', async () => {
    const urls = stub()
    const api = await makeApi()
    await api.devices({ isAdmin: true, scope: 'mine' })
    expect(new URL(urls[0].url).searchParams.get('userId')).toBe('u1')
  })

  it('asks for the whole server only when an admin asked for it', async () => {
    const urls = stub()
    const api = await makeApi()
    await api.devices({ isAdmin: true, scope: 'everyone' })
    expect(new URL(urls[0].url).searchParams.has('userId')).toBe(false)
  })

  it('flags the row that matches the id this browser stored', async () => {
    stub([device({ Id: 'other' }), device({ Id: 'this-one' })])
    const api = await makeApi()
    const overview = await api.devices({ isAdmin: true, scope: 'everyone' })
    expect(overview.current?.id).toBe('this-one')
  })

  it('revokes by query parameter, which is what the route requires', async () => {
    const urls = stub()
    const api = await makeApi()
    await api.revokeDevice('gone')
    expect(urls[0].method).toBe('DELETE')
    expect(new URL(urls[0].url).searchParams.get('id')).toBe('gone')
  })
})
