import { describe, expect, it } from 'vitest'
import { canRestore, createScrollMemory, RESTORE_SLACK_PX, scrollTargetFor } from '../scrollMemory'

describe('scrollTargetFor', () => {
  it('puts a followed link at the top', () => {
    expect(scrollTargetFor({ kind: 'PUSH' })).toBe(0)
  })

  it('puts going back where you were', () => {
    expect(scrollTargetFor({ kind: 'POP', remembered: 1840 })).toBe(1840)
  })

  it('puts going back to the top when there is nothing remembered', () => {
    // A reload, or an entry from before this session: the top is the only
    // honest answer, and it is what the app did before any of this existed.
    expect(scrollTargetFor({ kind: 'POP' })).toBe(0)
  })

  it('leaves a replace alone entirely', () => {
    // The app rewriting its own entry — a filter, a tidied query string. Null
    // is "do not touch", which is different from zero.
    expect(scrollTargetFor({ kind: 'REPLACE', remembered: 900 })).toBeNull()
  })
})

describe('canRestore', () => {
  it('waits while the grid is still one screen tall', () => {
    // The moment the entry pops, the items have not arrived. Restoring here is
    // what makes the browser's own scrollRestoration useless for this.
    expect(canRestore({ target: 1800, scrollHeight: 900, viewportHeight: 900 })).toBe(false)
  })

  it('goes once the page can hold the offset', () => {
    expect(canRestore({ target: 1800, scrollHeight: 4000, viewportHeight: 900 })).toBe(true)
  })

  it('accepts a page a little shorter than last time', () => {
    // One item removed should not cost the restore; exactly at the slack.
    const target = 1800
    expect(
      canRestore({ target, scrollHeight: target + 900 - RESTORE_SLACK_PX, viewportHeight: 900 }),
    ).toBe(true)
  })

  it('does not wait at all for the top', () => {
    expect(canRestore({ target: 0, scrollHeight: 0, viewportHeight: 900 })).toBe(true)
  })
})

describe('createScrollMemory', () => {
  it('gives back what it was told', () => {
    const m = createScrollMemory()
    m.remember('a', 1200)
    expect(m.recall('a')).toBe(1200)
  })

  it('knows nothing about a key it never saw', () => {
    expect(createScrollMemory().recall('nope')).toBeUndefined()
  })

  it('keeps two visits to one page apart', () => {
    // Keyed by history entry, not path — the same library opened twice is two
    // places in the grid, and keying by path would confuse them.
    const m = createScrollMemory()
    m.remember('entry-1', 100)
    m.remember('entry-2', 900)
    expect(m.recall('entry-1')).toBe(100)
    expect(m.recall('entry-2')).toBe(900)
  })

  it('drops the oldest once it is full', () => {
    const m = createScrollMemory(2)
    m.remember('a', 1)
    m.remember('b', 2)
    m.remember('c', 3)
    expect(m.size).toBe(2)
    expect(m.recall('a')).toBeUndefined()
    expect(m.recall('c')).toBe(3)
  })

  it('keeps an entry alive by using it', () => {
    // Without the delete-before-set, a Map holds its first insertion order and
    // would evict the entry being actively scrolled.
    const m = createScrollMemory(2)
    m.remember('a', 1)
    m.remember('b', 2)
    m.remember('a', 5)
    m.remember('c', 3)
    expect(m.recall('a')).toBe(5)
    expect(m.recall('b')).toBeUndefined()
  })

  it('refuses nonsense rather than storing it', () => {
    const m = createScrollMemory()
    m.remember('', 10)
    m.remember('a', Number.NaN)
    m.remember('b', -5)
    expect(m.size).toBe(0)
  })
})
