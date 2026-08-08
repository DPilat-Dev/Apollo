import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearQueue,
  nextInQueue,
  previousInQueue,
  queueFor,
  queuePosition,
  shuffleIds,
  startShuffle,
} from '../queue'

// sessionStorage does not exist in Node.
beforeEach(() => {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    configurable: true,
  })
})

describe('shuffleIds', () => {
  it('keeps every episode exactly once', () => {
    const ids = Array.from({ length: 50 }, (_, i) => `e${i}`)
    const out = shuffleIds(ids)
    expect(out).toHaveLength(ids.length)
    expect(new Set(out)).toEqual(new Set(ids))
  })

  it('actually reorders', () => {
    const ids = Array.from({ length: 40 }, (_, i) => `e${i}`)
    // Astronomically unlikely to be identical unless it isn't shuffling.
    expect(shuffleIds(ids)).not.toEqual(ids)
  })

  it('can pin a chosen episode first without losing it', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `e${i}`)
    const out = shuffleIds(ids, 'e7')
    expect(out[0]).toBe('e7')
    expect(new Set(out)).toEqual(new Set(ids))
  })
})

describe('play queue', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('walks forwards and backwards', () => {
    const q = startShuffle('sr1', ids)!
    const [first, second] = q.ids
    expect(nextInQueue(first)).toBe(second)
    expect(previousInQueue(second)).toBe(first)
    expect(previousInQueue(first)).toBeNull()
    expect(nextInQueue(q.ids.at(-1))).toBeNull()
  })

  it('re-syncs when someone jumps to an episode by hand', () => {
    const q = startShuffle('sr1', ids)!
    const third = q.ids[2]
    // Never played the first two; the queue should continue from here.
    expect(nextInQueue(third)).toBe(q.ids[3])
    expect(queuePosition(third)).toEqual({ position: 3, total: 4 })
  })

  it('does not apply to an episode outside the queue', () => {
    startShuffle('sr1', ids)
    expect(queueFor('somewhere-else')).toBeNull()
    expect(nextInQueue('somewhere-else')).toBeNull()
  })

  it('stops applying once cleared', () => {
    const q = startShuffle('sr1', ids)!
    clearQueue()
    expect(queueFor(q.ids[0])).toBeNull()
  })

  it('refuses to start on nothing', () => {
    expect(startShuffle('sr1', [])).toBeNull()
  })
})
