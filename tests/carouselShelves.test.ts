import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Every shelf that scrolls sideways has to scroll the same way.
 *
 * `Row` carried the arrows, the edge slack and the page fraction inline, and
 * the schedule strip shipped in 1.19.0 with none of them — so the back half
 * of the week was visible and unreachable, because a mouse wheel over a
 * horizontal scroller moves the page and not the shelf. The arithmetic now
 * lives in `lib/carousel`, where `carousel.test.ts` can reach it; what those
 * unit tests cannot see is whether the shelves still use it, or whether the
 * next one grows its own copy of the numbers.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), 'utf8'))

/** Every shelf with a horizontal scroller. Add one here when you build one. */
const SHELVES = ['components/Row.tsx', 'components/AiringThisWeek.tsx']

describe('horizontal shelves', () => {
  for (const file of SHELVES) {
    it(`takes its paging from the shared hook — ${file}`, () => {
      expect(code(file)).toMatch(/useCarousel\(/)
    })

    it(`keeps no second copy of the scroll arithmetic — ${file}`, () => {
      const source = code(file)
      expect(source).not.toMatch(/scrollBy\(/)
      expect(source).not.toMatch(/scrollWidth|scrollLeft/)
      expect(source).not.toMatch(/0\.85/)
    })

    it(`offers an arrow each way, and only when it would move — ${file}`, () => {
      const source = code(file)
      expect(source).toMatch(/\{canLeft && \([\s\S]{0,300}side="left"/)
      expect(source).toMatch(/\{canRight && \([\s\S]{0,300}side="right"/)
    })

    it(`re-measures as the shelf is scrolled — ${file}`, () => {
      // Without this the arrows are drawn once and never corrected, so the
      // left arrow stays hidden after the first page and the right one is
      // still offered at the end of the shelf.
      expect(code(file)).toMatch(/onScroll=\{measure\}/)
    })
  }
})
