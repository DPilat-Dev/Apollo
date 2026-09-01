import { beforeEach, describe, expect, it } from 'vitest'
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models'
import {
  KEPT_KEYS,
  MAX_REMEMBERED,
  accountsToOffer,
  forgetAccount,
  forgetSignIn,
  keysToPurgeOnSwitch,
  lastUsedServer,
  loadAccounts,
  parseAccounts,
  purgeDeviceState,
  rememberAccount,
  rememberSignIn,
  type StoredAccount,
} from '../accounts'

const SERVER = 'http://tv.local:8096'

function stored(over: Partial<StoredAccount> = {}): StoredAccount {
  return {
    server: SERVER,
    userId: 'ada',
    userName: 'Ada',
    avatarTag: null,
    lastUsed: 1_000,
    ...over,
  }
}

const user = (Id: string, Name: string, PrimaryImageTag?: string): UserDto => ({
  Id,
  Name,
  ...(PrimaryImageTag ? { PrimaryImageTag } : {}),
})

describe('parseAccounts', () => {
  it('treats nothing, junk and non-arrays as no remembered accounts', () => {
    expect(parseAccounts(null)).toEqual([])
    expect(parseAccounts('')).toEqual([])
    expect(parseAccounts('{not json')).toEqual([])
    expect(parseAccounts('{"server":"x"}')).toEqual([])
  })

  it('drops entries with nothing to identify an account by', () => {
    const raw = JSON.stringify([
      { server: SERVER, userId: 'ada', userName: 'Ada', avatarTag: null, lastUsed: 5 },
      { server: SERVER, userName: 'No id' },
      { userId: 'no-server', userName: 'Grace' },
      'nonsense',
      null,
    ])
    expect(parseAccounts(raw).map((a) => a.userId)).toEqual(['ada'])
  })

  it('refuses to carry a credential back out of storage', () => {
    const raw = JSON.stringify([
      { server: SERVER, userId: 'ada', userName: 'Ada', token: 'stolen', password: 'hunter2' },
    ])
    const [account] = parseAccounts(raw)
    expect(Object.keys(account).sort()).toEqual(
      ['avatarTag', 'lastUsed', 'server', 'userId', 'userName'].sort(),
    )
  })
})

describe('rememberAccount', () => {
  it('remembers the first account signed in on a fresh device', () => {
    expect(rememberAccount([], stored())).toEqual([stored()])
  })

  it('never writes a token or a password, whatever it is handed', () => {
    const smuggled = { ...stored(), token: 'abc123', password: 'hunter2' } as StoredAccount
    const [account] = rememberAccount([], smuggled)
    expect(JSON.stringify(account)).not.toContain('abc123')
    expect(JSON.stringify(account)).not.toContain('hunter2')
  })

  it('keeps one entry per account rather than one per sign-in', () => {
    let list = rememberAccount([], stored({ lastUsed: 1 }))
    list = rememberAccount(list, stored({ lastUsed: 2 }))
    list = rememberAccount(list, stored({ lastUsed: 3, userName: 'Ada L' }))
    expect(list).toHaveLength(1)
    expect(list[0].userName).toBe('Ada L')
    expect(list[0].lastUsed).toBe(3)
  })

  it('collapses a list that already accumulated duplicates', () => {
    const dupes = [
      stored({ lastUsed: 1 }),
      stored({ lastUsed: 2, userName: 'Ada again' }),
      stored({ userId: 'grace', userName: 'Grace', lastUsed: 3 }),
      stored({ lastUsed: 4, avatarTag: 'tag' }),
    ]
    const list = rememberAccount(dupes, stored({ userId: 'grace', userName: 'Grace', lastUsed: 9 }))
    expect(list.map((a) => a.userId)).toEqual(['grace', 'ada'])
    expect(list[1].avatarTag).toBe('tag')
  })

  it('treats a trailing slash or different casing as the same account', () => {
    const list = rememberAccount(
      [stored({ server: `${SERVER}/`, userId: 'ADA' })],
      stored({ lastUsed: 7 }),
    )
    expect(list).toHaveLength(1)
    expect(list[0].lastUsed).toBe(7)
  })

  it('keeps a known face when a sign-in arrives without one', () => {
    // Signing in through the manual form knows no avatar tag; losing the
    // picture already stored would make that face vanish from the picker.
    const list = rememberAccount([stored({ avatarTag: 'tag', lastUsed: 1 })], stored({ lastUsed: 2 }))
    expect(list[0].avatarTag).toBe('tag')
  })

  it('takes a new avatar over the remembered one', () => {
    const list = rememberAccount(
      [stored({ avatarTag: 'old', lastUsed: 1 })],
      stored({ avatarTag: 'new', lastUsed: 2 }),
    )
    expect(list[0].avatarTag).toBe('new')
  })

  it('puts the person who just signed in at the front', () => {
    const list = rememberAccount(
      [stored({ userId: 'grace', userName: 'Grace', lastUsed: 50 })],
      stored({ lastUsed: 2 }),
    )
    expect(list.map((a) => a.userId)).toEqual(['ada', 'grace'])
  })

  it('stops the list growing without bound on a shared device', () => {
    let list: StoredAccount[] = []
    for (let i = 0; i < MAX_REMEMBERED + 5; i++) {
      list = rememberAccount(list, stored({ userId: `u${i}`, userName: `U${i}`, lastUsed: i }))
    }
    expect(list).toHaveLength(MAX_REMEMBERED)
    // The oldest go, not the newest.
    expect(list[0].userId).toBe(`u${MAX_REMEMBERED + 4}`)
    expect(list.some((a) => a.userId === 'u0')).toBe(false)
  })

  it('keeps accounts on other servers', () => {
    const list = rememberAccount([stored({ server: 'http://other:8096' })], stored())
    expect(list).toHaveLength(2)
  })
})

describe('forgetAccount', () => {
  it('removes only the account signed out of', () => {
    const list = forgetAccount(
      [stored(), stored({ userId: 'grace', userName: 'Grace' })],
      SERVER,
      'ada',
    )
    expect(list.map((a) => a.userId)).toEqual(['grace'])
  })

  it('matches the same account written with a trailing slash', () => {
    expect(forgetAccount([stored({ server: `${SERVER}/` })], SERVER, 'ada')).toEqual([])
  })

  it('leaves the same name on a different server alone', () => {
    const other = stored({ server: 'http://other:8096' })
    expect(forgetAccount([other], SERVER, 'ada')).toEqual([other])
  })
})

describe('lastUsedServer', () => {
  it('has nothing to suggest before anyone has signed in', () => {
    expect(lastUsedServer([])).toBeNull()
  })

  it('suggests the server of the most recent sign-in', () => {
    expect(
      lastUsedServer([
        stored({ server: 'http://new:8096', lastUsed: 90 }),
        stored({ server: 'http://old:8096', lastUsed: 10 }),
      ]),
    ).toBe('http://new:8096')
  })

  it('does not trust the stored order', () => {
    expect(
      lastUsedServer([
        stored({ server: 'http://old:8096', lastUsed: 10 }),
        stored({ server: 'http://new:8096', lastUsed: 90 }),
      ]),
    ).toBe('http://new:8096')
  })
})

describe('accountsToOffer', () => {
  it('offers nothing when the device is new and the server publishes nobody', () => {
    expect(accountsToOffer({ stored: [], publicUsers: [], server: SERVER })).toEqual([])
  })

  it('offers the server’s users on a device nobody has used', () => {
    const list = accountsToOffer({
      stored: [],
      publicUsers: [user('grace', 'Grace'), user('ada', 'Ada')],
      server: SERVER,
    })
    expect(list.map((p) => p.userId)).toEqual(['ada', 'grace'])
    expect(list.every((p) => p.remembered)).toBe(false)
  })

  it('lists each account once, with the server’s current name and avatar', () => {
    const list = accountsToOffer({
      stored: [stored({ userName: 'Old name', avatarTag: 'oldtag' })],
      publicUsers: [user('ada', 'Ada', 'freshtag')],
      server: SERVER,
    })
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ name: 'Ada', avatarTag: 'freshtag', remembered: true })
  })

  it('collapses duplicates already sitting in the stored list', () => {
    const list = accountsToOffer({
      stored: [stored({ lastUsed: 1 }), stored({ lastUsed: 2 }), stored({ server: `${SERVER}/` })],
      publicUsers: [],
      server: SERVER,
    })
    expect(list).toHaveLength(1)
  })

  it('drops an account the server no longer has', () => {
    const list = accountsToOffer({
      stored: [stored({ userId: 'gone', userName: 'Departed' }), stored()],
      publicUsers: [user('ada', 'Ada')],
      server: SERVER,
    })
    expect(list.map((p) => p.userId)).toEqual(['ada'])
  })

  it('keeps remembered accounts when the server hides its user list', () => {
    const list = accountsToOffer({
      stored: [stored({ userId: 'gone', userName: 'Departed' }), stored()],
      publicUsers: [],
      server: SERVER,
    })
    // An empty list is "not published", not "nobody exists" — deleting the
    // picker here would leave a shared device with a blank form.
    expect(list.map((p) => p.userId).sort()).toEqual(['ada', 'gone'])
  })

  it('ignores accounts belonging to a different server', () => {
    const list = accountsToOffer({
      stored: [stored({ server: 'http://elsewhere:8096', userId: 'grace', userName: 'Grace' })],
      publicUsers: [user('ada', 'Ada')],
      server: SERVER,
    })
    expect(list.map((p) => p.userId)).toEqual(['ada'])
  })

  it('matches the server whatever slash or case it was stored with', () => {
    const list = accountsToOffer({
      stored: [stored({ server: `${SERVER.toUpperCase()}/` })],
      publicUsers: [],
      server: SERVER,
    })
    expect(list.map((p) => p.userId)).toEqual(['ada'])
  })

  it('puts remembered people first, most recent first, then everyone else by name', () => {
    const list = accountsToOffer({
      stored: [
        stored({ userId: 'grace', userName: 'Grace', lastUsed: 10 }),
        stored({ lastUsed: 99 }),
      ],
      publicUsers: [
        user('zoe', 'Zoe'),
        user('ada', 'Ada'),
        user('bob', 'Bob'),
        user('grace', 'Grace'),
      ],
      server: SERVER,
    })
    expect(list.map((p) => p.userId)).toEqual(['ada', 'grace', 'bob', 'zoe'])
  })

  it('marks the person already signed in rather than hiding them', () => {
    const list = accountsToOffer({
      stored: [stored()],
      publicUsers: [user('ada', 'Ada'), user('grace', 'Grace')],
      server: SERVER,
      currentUserId: 'ada',
    })
    expect(list.map((p) => p.userId)).toContain('ada')
    expect(list.find((p) => p.userId === 'ada')?.current).toBe(true)
    expect(list.find((p) => p.userId === 'grace')?.current).toBe(false)
  })

  it('never carries a token into the picker', () => {
    const list = accountsToOffer({
      stored: [{ ...stored(), token: 'abc123' } as StoredAccount],
      publicUsers: [],
      server: SERVER,
    })
    expect(JSON.stringify(list)).not.toContain('abc123')
  })
})

describe('keysToPurgeOnSwitch', () => {
  const present = [
    'apollo.session',
    'apollo.settings',
    'apollo.playQueue',
    'apollo.seerrAutoConnectError',
    'apollo.deviceId',
    'apollo.accounts',
    'jellyfin_credentials',
    'theme',
  ]

  it('takes the outgoing person’s state with them', () => {
    const purged = keysToPurgeOnSwitch(present)
    expect(purged).toContain('apollo.session')
    expect(purged).toContain('apollo.settings')
    expect(purged).toContain('apollo.playQueue')
    expect(purged).toContain('apollo.seerrAutoConnectError')
  })

  it('keeps what identifies the device rather than the person', () => {
    const purged = keysToPurgeOnSwitch(present)
    expect(purged).not.toContain('apollo.deviceId')
    expect(purged).not.toContain('apollo.accounts')
  })

  it('purges an apollo key nobody has thought of yet', () => {
    // The point of the default: a key added later is purged unless someone
    // deliberately adds it to the keep list.
    expect(keysToPurgeOnSwitch(['apollo.watchHistory'])).toEqual(['apollo.watchHistory'])
  })

  it('leaves other applications on the origin alone', () => {
    const purged = keysToPurgeOnSwitch(present)
    expect(purged).not.toContain('jellyfin_credentials')
    expect(purged).not.toContain('theme')
  })

  it('keeps every kept key out of the purge list', () => {
    expect(keysToPurgeOnSwitch([...KEPT_KEYS])).toEqual([])
  })

  it('copes with an empty store', () => {
    expect(keysToPurgeOnSwitch([])).toEqual([])
  })
})

// Neither store exists in Node.
function fakeStore(initial: Record<string, string> = {}) {
  const store: Record<string, string> = { ...initial }
  return {
    store,
    api: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
      get length() {
        return Object.keys(store).length
      },
      key: (i: number) => Object.keys(store)[i] ?? null,
    },
  }
}

let local: ReturnType<typeof fakeStore>
let session: ReturnType<typeof fakeStore>

beforeEach(() => {
  local = fakeStore()
  session = fakeStore()
  Object.defineProperty(globalThis, 'localStorage', { value: local.api, configurable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: session.api, configurable: true })
})

describe('the remembered list on a real device', () => {
  it('survives a sign-in, a switch and the next sign-in', () => {
    rememberSignIn({ server: SERVER, userId: 'ada', userName: 'Ada', avatarTag: 'tag' })
    local.store['apollo.session'] = '{"token":"secret"}'
    local.store['apollo.settings'] = '{"subtitleSize":200}'
    session.store['apollo.playQueue'] = '{"ids":["ep1"]}'

    purgeDeviceState()

    expect(loadAccounts().map((a) => a.userName)).toEqual(['Ada'])
    expect(local.store['apollo.session']).toBeUndefined()
    expect(local.store['apollo.settings']).toBeUndefined()
    // The play queue is the leak nobody looks for: it lives in the other store.
    expect(session.store['apollo.playQueue']).toBeUndefined()
  })

  it('keeps the device id, which identifies the browser rather than the person', () => {
    local.store['apollo.deviceId'] = 'abc-123'
    purgeDeviceState()
    expect(local.store['apollo.deviceId']).toBe('abc-123')
  })

  it('never writes a token alongside the remembered profile', () => {
    rememberSignIn({ server: SERVER, userId: 'ada', userName: 'Ada', avatarTag: null })
    expect(local.store['apollo.accounts']).not.toContain('token')
  })

  it('forgets one person without forgetting the household', () => {
    rememberSignIn({ server: SERVER, userId: 'ada', userName: 'Ada', avatarTag: null })
    rememberSignIn({ server: SERVER, userId: 'grace', userName: 'Grace', avatarTag: null })
    forgetSignIn(SERVER, 'grace')
    expect(loadAccounts().map((a) => a.userId)).toEqual(['ada'])
  })

  it('reads nothing rather than throwing when storage is blocked', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('private mode')
      },
      configurable: true,
    })
    expect(loadAccounts()).toEqual([])
    // A blocked localStorage must not stop sessionStorage being cleaned.
    session.store['apollo.playQueue'] = '{"ids":["ep1"]}'
    expect(() => purgeDeviceState()).not.toThrow()
    expect(session.store['apollo.playQueue']).toBeUndefined()
  })
})
