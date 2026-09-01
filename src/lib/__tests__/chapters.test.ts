import { describe, expect, it } from 'vitest'
import type { ChapterInfo } from '@jellyfin/sdk/lib/generated-client/models'
import { chapterAt, chapterIndexAt, normalizeChapters } from '../chapters'

const S = 10_000_000
const ch = (seconds: number, name?: string | null): ChapterInfo => ({
  StartPositionTicks: seconds * S,
  Name: name ?? undefined,
})

describe('normalizeChapters', () => {
  it('converts ticks to seconds and keeps the server’s names', () => {
    expect(normalizeChapters([ch(0, 'Cold open'), ch(90, 'Titles')])).toEqual([
      { start: 0, name: 'Cold open' },
      { start: 90, name: 'Titles' },
    ])
  })

  it('orders by start whatever order the server sent', () => {
    const out = normalizeChapters([ch(600, 'Third'), ch(0, 'First'), ch(120, 'Second')])
    expect(out.map((c) => c.name)).toEqual(['First', 'Second', 'Third'])
  })

  it('numbers unnamed chapters by where they end up, not where they arrived', () => {
    const out = normalizeChapters([ch(600), ch(0), ch(120, '   ')])
    expect(out).toEqual([
      { start: 0, name: 'Chapter 1' },
      { start: 120, name: 'Chapter 2' },
      { start: 600, name: 'Chapter 3' },
    ])
  })

  it('keeps one entry per start, and the first name wins', () => {
    const out = normalizeChapters([ch(0, 'Opening'), ch(0, 'Opening'), ch(0, 'Also zero')])
    expect(out).toEqual([{ start: 0, name: 'Opening' }])
  })

  it('drops chapters that start at or past the runtime', () => {
    const out = normalizeChapters([ch(0, 'Start'), ch(3600, 'Bogus'), ch(7200, 'Worse')], 3600 * S)
    expect(out.map((c) => c.name)).toEqual(['Start'])
  })

  it('keeps everything when the runtime is unknown', () => {
    expect(normalizeChapters([ch(0, 'A'), ch(99_999, 'B')])).toHaveLength(2)
    expect(normalizeChapters([ch(0, 'A'), ch(99_999, 'B')], 0)).toHaveLength(2)
    expect(normalizeChapters([ch(0, 'A'), ch(99_999, 'B')], null)).toHaveLength(2)
  })

  it('pulls a negative or missing start back to zero', () => {
    expect(normalizeChapters([{ Name: 'Nameless start' }, ch(-30, 'Before the film')])).toEqual([
      { start: 0, name: 'Nameless start' },
    ])
  })

  it('has nothing to say about an item with no chapters', () => {
    expect(normalizeChapters([])).toEqual([])
    expect(normalizeChapters(undefined)).toEqual([])
    expect(normalizeChapters(null)).toEqual([])
  })
})

describe('chapterIndexAt', () => {
  const chapters = normalizeChapters([ch(0, 'One'), ch(120, 'Two'), ch(600, 'Three')])

  it('is the last chapter to have started', () => {
    expect(chapterIndexAt(chapters, 0)).toBe(0)
    expect(chapterIndexAt(chapters, 119.9)).toBe(0)
    expect(chapterIndexAt(chapters, 120)).toBe(1)
    expect(chapterIndexAt(chapters, 99_999)).toBe(2)
  })

  it('reports nothing before the first chapter, or when there are none', () => {
    expect(chapterIndexAt(normalizeChapters([ch(30, 'Late')]), 10)).toBe(-1)
    expect(chapterIndexAt([], 10)).toBe(-1)
    expect(chapterIndexAt(undefined, 10)).toBe(-1)
  })

  /*
    Two chapters can share a name — "Part 1" twice in a double episode — so the
    marker in the list has to be an index. Matching on the name lit both.
  */
  it('separates chapters that share a name', () => {
    const repeated = normalizeChapters([ch(0, 'Part 1'), ch(1200, 'Part 1')])
    expect(chapterIndexAt(repeated, 1300)).toBe(1)
  })
})

describe('chapterAt', () => {
  const chapters = normalizeChapters([ch(0, 'One'), ch(120, 'Two')])

  it('names the chapter covering an instant', () => {
    expect(chapterAt(chapters, 10)).toBe('One')
    expect(chapterAt(chapters, 200)).toBe('Two')
  })

  it('names nothing before the first chapter starts', () => {
    expect(chapterAt(normalizeChapters([ch(30, 'Late')]), 10)).toBeNull()
    expect(chapterAt(undefined, 10)).toBeNull()
  })
})
