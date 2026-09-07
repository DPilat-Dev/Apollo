import { describe, expect, it } from 'vitest'
import {
  isUsable,
  PERSIST_MAX_AGE_MS,
  PERSIST_VERSION,
  persistKey,
  PERSISTED_QUERIES,
  shouldPersistQuery,
} from '../queryPersistence'

describe('shouldPersistQuery', () => {
  it('keeps the things a library is made of', () => {
    for (const k of ['views', 'itemsRow', 'item', 'seasons', 'episodes']) {
      expect(shouldPersistQuery([k, 'anything'])).toBe(true)
    }
  })

  it('refuses a live view of a server', () => {
    // An administrator acting on yesterday's session list is being misled,
    // which is worse than waiting for the real one.
    for (const k of ['sessions', 'logFiles', 'logFile', 'devices', 'apiKeys', 'scheduledTasks', 'activityLog', 'plugins']) {
      expect(shouldPersistQuery([k])).toBe(false)
    }
  })

  it('refuses anything that changes by watching something', () => {
    // The one thing a viewer notices being wrong.
    for (const k of ['resume', 'nextUp', 'segments']) {
      expect(shouldPersistQuery([k])).toBe(false)
    }
  })

  it('refuses another service entirely', () => {
    expect(shouldPersistQuery(['seerrSession'])).toBe(false)
    expect(shouldPersistQuery(['seerrSearch', 'dune'])).toBe(false)
  })

  it('says no to a query it has never heard of', () => {
    // Allow-list, not deny-list: a query added later refetches rather than
    // being persisted by accident.
    expect(shouldPersistQuery(['somethingNew'])).toBe(false)
    expect(shouldPersistQuery([])).toBe(false)
    expect(shouldPersistQuery([123])).toBe(false)
  })
})

describe('persistKey', () => {
  it('separates two accounts on one browser', () => {
    const a = persistKey({ server: 'http://s', userId: 'alice' })
    const b = persistKey({ server: 'http://s', userId: 'bob' })
    expect(a).not.toBe(b)
  })

  it('separates two servers', () => {
    expect(persistKey({ server: 'http://a', userId: 'u' })).not.toBe(
      persistKey({ server: 'http://b', userId: 'u' }),
    )
  })

  it('has nowhere to write without both', () => {
    // Signed out, there is no cache to read or keep.
    expect(persistKey({ server: 'http://s', userId: null })).toBeNull()
    expect(persistKey({ server: null, userId: 'u' })).toBeNull()
    expect(persistKey({})).toBeNull()
  })

  it('carries the version, so an upgrade cannot half-read an old shape', () => {
    expect(persistKey({ server: 'http://s', userId: 'u' })).toContain(`v${PERSIST_VERSION}`)
  })
})

describe('isUsable', () => {
  const now = 1_700_000_000_000
  const stored = (over = {}) => ({ savedAt: now - 1000, version: PERSIST_VERSION, state: {}, ...over })

  it('uses a recent cache', () => {
    expect(isUsable(stored(), now)).toBe(true)
  })

  it('discards one written by an older version', () => {
    expect(isUsable(stored({ version: PERSIST_VERSION - 1 }), now)).toBe(false)
  })

  it('discards one past its age', () => {
    expect(isUsable(stored({ savedAt: now - PERSIST_MAX_AGE_MS - 1 }), now)).toBe(false)
    expect(isUsable(stored({ savedAt: now - PERSIST_MAX_AGE_MS }), now)).toBe(true)
  })

  it('discards one from the future', () => {
    // A device correcting its clock, or a restored backup: an age that cannot
    // be computed is not an age to trust.
    expect(isUsable(stored({ savedAt: now + 60_000 }), now)).toBe(false)
  })

  it('discards nonsense', () => {
    expect(isUsable(null, now)).toBe(false)
    expect(isUsable(stored({ savedAt: 'yesterday' }), now)).toBe(false)
    expect(isUsable(stored({ savedAt: Number.NaN }), now)).toBe(false)
  })
})

describe('the allow-list itself', () => {
  it('holds no administrative query', () => {
    for (const k of ['sessions', 'devices', 'apiKeys', 'logFiles', 'plugins', 'scheduledTasks']) {
      expect(PERSISTED_QUERIES.has(k)).toBe(false)
    }
  })
})
