import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearQueue,
  jumpInQueue,
  jumpToQueueItem,
  moveInQueue,
  moveQueueItem,
  nextInQueue,
  previousInQueue,
  queueFor,
  queuePosition,
  removeFromQueue,
  removeQueueItem,
  shuffleIds,
  startShuffle,
  type PlayQueue,
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

/** A queue with a known order, so an edit's effect is not luck of the shuffle. */
const at = (index: number, ids = ['a', 'b', 'c', 'd', 'e']): PlayQueue => ({
  seriesId: 'sr1',
  ids,
  index,
  shuffled: true,
})

describe('moveQueueItem', () => {
  it('moves an item down without losing anybody', () => {
    const { queue } = moveQueueItem(at(0), 'd', 1)
    expect(queue!.ids).toEqual(['a', 'b', 'c', 'e', 'd'])
  })

  it('moves an item up without losing anybody', () => {
    const { queue } = moveQueueItem(at(0), 'd', -1)
    expect(queue!.ids).toEqual(['a', 'b', 'd', 'c', 'e'])
  })

  it('refuses to walk off either end', () => {
    expect(moveQueueItem(at(2), 'a', -1).queue!.ids).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(moveQueueItem(at(2), 'e', 1).queue!.ids).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('ignores an id that is no longer in the queue', () => {
    const before = at(2)
    const { queue, playTo } = moveQueueItem(before, 'gone', 1)
    expect(queue).toEqual(before)
    expect(playTo).toBeNull()
  })

  it('has nothing to do to a single-item queue', () => {
    expect(moveQueueItem(at(0, ['a']), 'a', 1).queue!.ids).toEqual(['a'])
    expect(moveQueueItem(at(0, ['a']), 'a', -1).queue!.ids).toEqual(['a'])
  })

  it('keeps playing the same episode when something is dragged past the playhead', () => {
    // Watching 'c'. Pull 'e' up over it; 'c' is now further down the list.
    const before = at(2)
    const { queue, playTo } = moveQueueItem(moveQueueItem(before, 'e', -1).queue!, 'e', -1)
    expect(queue!.ids).toEqual(['a', 'b', 'e', 'c', 'd'])
    expect(queue!.ids[queue!.index]).toBe('c')
    expect(queue!.index).toBe(3)
    // A reorder is not a skip: nothing about what is on screen changed.
    expect(playTo).toBeNull()
  })

  it('changes what comes next when an item is moved into the slot after the playhead', () => {
    // Watching 'b', so 'c' is next. Promote 'e' to sit right behind 'b'.
    let queue = at(1)
    for (let i = 0; i < 2; i++) queue = moveQueueItem(queue, 'e', -1).queue!
    expect(queue.ids).toEqual(['a', 'b', 'e', 'c', 'd'])
    expect(queue.ids[queue.index]).toBe('b')
    expect(queue.ids[queue.index + 1]).toBe('e')
  })

  it('follows the currently playing item when it is the one being moved', () => {
    const { queue } = moveQueueItem(at(2), 'c', 1)
    expect(queue!.ids).toEqual(['a', 'b', 'd', 'c', 'e'])
    expect(queue!.index).toBe(3)
    expect(queue!.ids[queue!.index]).toBe('c')
  })

  it('leaves the shuffle running rather than reverting to episode order', () => {
    const { queue } = moveQueueItem(at(2), 'e', -1)
    expect(queue!.shuffled).toBe(true)
    expect(queue!.seriesId).toBe('sr1')
  })
})

describe('removeQueueItem', () => {
  it('drops something further down without disturbing playback', () => {
    const { queue, playTo } = removeQueueItem(at(2), 'e')
    expect(queue!.ids).toEqual(['a', 'b', 'c', 'd'])
    expect(queue!.ids[queue!.index]).toBe('c')
    expect(playTo).toBeNull()
  })

  it('drops something already played and keeps the index on the same episode', () => {
    const { queue, playTo } = removeQueueItem(at(2), 'a')
    expect(queue!.ids).toEqual(['b', 'c', 'd', 'e'])
    expect(queue!.index).toBe(1)
    expect(queue!.ids[queue!.index]).toBe('c')
    expect(playTo).toBeNull()
  })

  it('plays what was next when the current episode is removed', () => {
    const { queue, playTo } = removeQueueItem(at(2), 'c')
    expect(queue!.ids).toEqual(['a', 'b', 'd', 'e'])
    expect(playTo).toBe('d')
    expect(queue!.ids[queue!.index]).toBe('d')
  })

  it('steps back rather than stopping when the removed current episode was last', () => {
    const { queue, playTo } = removeQueueItem(at(4), 'e')
    expect(queue!.ids).toEqual(['a', 'b', 'c', 'd'])
    expect(playTo).toBe('d')
    expect(queue!.ids[queue!.index]).toBe('d')
  })

  it('never answers with the front of the queue when the current episode goes', () => {
    // The failure this guards: a naive index reset drops the viewer back to
    // episode one mid-series.
    expect(removeQueueItem(at(3), 'd').playTo).not.toBe('a')
    expect(removeQueueItem(at(4), 'e').playTo).not.toBe('a')
  })

  it('ends the queue but not playback when the last item left is the current one', () => {
    const { queue, playTo } = removeQueueItem(at(0, ['a']), 'a')
    expect(queue).toBeNull()
    expect(playTo).toBeNull()
  })

  it('ignores an id that is no longer in the queue', () => {
    const before = at(2)
    const { queue, playTo } = removeQueueItem(before, 'gone')
    expect(queue).toEqual(before)
    expect(playTo).toBeNull()
  })

  it('leaves the shuffle running', () => {
    expect(removeQueueItem(at(2), 'e').queue!.shuffled).toBe(true)
  })
})

describe('jumpToQueueItem', () => {
  it('moves the playhead onto the chosen item', () => {
    const { queue, playTo } = jumpToQueueItem(at(0), 'd')
    expect(queue!.index).toBe(3)
    expect(playTo).toBe('d')
  })

  it('refuses an id that is no longer in the queue', () => {
    const before = at(2)
    const { queue, playTo } = jumpToQueueItem(before, 'gone')
    expect(queue).toEqual(before)
    expect(playTo).toBeNull()
  })
})

describe('editing the stored queue', () => {
  const ids = ['a', 'b', 'c', 'd', 'e']

  it('persists a move so the player sees the new next', () => {
    const q = startShuffle('sr1', ids)!
    const [first, second, third] = q.ids
    expect(nextInQueue(first)).toBe(second)
    moveInQueue(first, third, -1)
    expect(nextInQueue(first)).toBe(third)
    expect(queuePosition(first)).toEqual({ position: 1, total: 5 })
  })

  it('reports the episode to play when the current one is removed', () => {
    const q = startShuffle('sr1', ids)!
    const [first, second] = q.ids
    expect(removeFromQueue(first, first)).toBe(second)
    expect(queuePosition(second)).toEqual({ position: 1, total: 4 })
  })

  it('forgets the queue once its last item is removed', () => {
    const q = startShuffle('sr1', ['only'])!
    expect(removeFromQueue('only', 'only')).toBeNull()
    expect(queueFor('only')).toBeNull()
    expect(q.ids).toEqual(['only'])
  })

  it('keeps shuffling the reordered queue rather than the series order', () => {
    const q = startShuffle('sr1', ids)!
    const last = q.ids[4]
    moveInQueue(q.ids[0], last, -1)
    const reordered = queueFor(q.ids[0])!
    expect(reordered.shuffled).toBe(true)
    expect(reordered.ids).toEqual([q.ids[0], q.ids[1], q.ids[2], last, q.ids[3]])
    // Still every episode, exactly once — a reorder is not a reshuffle.
    expect(new Set(reordered.ids)).toEqual(new Set(ids))
  })

  it('jumps to a chosen item and continues from there', () => {
    const q = startShuffle('sr1', ids)!
    expect(jumpInQueue(q.ids[0], q.ids[3])).toBe(q.ids[3])
    expect(queuePosition(q.ids[3])).toEqual({ position: 4, total: 5 })
    expect(nextInQueue(q.ids[3])).toBe(q.ids[4])
  })

  it('does nothing at all without a queue', () => {
    clearQueue()
    expect(moveInQueue('a', 'b', 1)).toBeNull()
    expect(removeFromQueue('a', 'b')).toBeNull()
    expect(jumpInQueue('a', 'b')).toBeNull()
  })
})
