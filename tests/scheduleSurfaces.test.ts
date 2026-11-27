import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Rules about the schedule that no single file can be right about alone.
 *
 * The date arithmetic is unit-tested in `schedule.test.ts`. What those tests
 * cannot see is whether the screens actually use it, and there are two ways
 * to build this feature wrong that both look fine in a screenshot taken in
 * London:
 *
 * - Reading a premiere with `new Date()` or `toLocaleDateString`. Almost
 *   every date this server holds is midnight UTC — a date, not a time — so
 *   that puts the entire schedule one day early for every viewer in the
 *   Americas, and nothing on screen says so.
 * - Linking an episode the server does not hold to its own page. Half of
 *   what is coming has no file behind it; those entries have to go to the
 *   series, or the schedule is a page of dead ends.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), 'utf8'))

const PAGE = 'routes/Schedule.tsx'
const STRIP = 'components/AiringThisWeek.tsx'
const NAV = 'components/TopNav.tsx'
const APP = 'App.tsx'

describe('the schedule screens', () => {
  it('are reachable: a tab in the nav and a route behind it', () => {
    expect(code(NAV)).toMatch(/to="\/schedule"/)
    expect(code(APP)).toMatch(/path="\/schedule"/)
  })

  for (const file of [PAGE, STRIP]) {
    it(`takes its dates from the schedule module, not from Date — ${file}`, () => {
      const source = code(file)
      // The one call that is legitimate: reading the viewer's own offset and
      // the current instant. Anything parsing an item's date must not be here.
      expect(source).not.toMatch(/new Date\((?!\)\.getTimezoneOffset)/)
      expect(source).not.toMatch(/toLocaleDateString|toLocaleString/)
      expect(source).toMatch(/dayKeyOf\(Date\.now\(\), tz\)/)
    })

    it(`asks the viewer's clock which way round it runs — ${file}`, () => {
      // `getTimezoneOffset` returns minutes *behind* UTC, so New York is +300
      // and the sign has to be flipped before anything is added to a date.
      expect(code(file)).toMatch(/const tz = -new Date\(\)\.getTimezoneOffset\(\)/)
    })

    it(`sends an episode the server lacks to the series — ${file}`, () => {
      expect(code(file)).toMatch(/airStatus\(item\) === 'have' \? item\.Id : item\.SeriesId/)
    })
  }

  it('says which entries have landed and which have not', () => {
    const page = code(PAGE)
    expect(page).toMatch(/On the server/)
    expect(page).toMatch(/Not here yet/)
  })

  it('explains an empty schedule instead of showing a blank page', () => {
    // It is empty for one reason — the server has no future air dates yet —
    // and a bare page looks like the feature is broken.
    expect(code(PAGE)).toMatch(/Nothing upcoming/)
  })

  it('keeps the home strip silent when there is nothing to say', () => {
    expect(code(STRIP)).toMatch(/if \(days\.length === 0\) return null/)
  })

  it('puts the home strip above the row before it, which overhangs it', () => {
    /*
      Every `Row` lays its scroller out with `pb-28 -mb-28`, so a card that
      scales on hover is not clipped by the horizontal overflow. That leaves
      7rem of invisible, clickable row hanging over whatever comes next, and
      a `Row` is `relative` while this strip was not: a positioned sibling
      paints above an unpositioned one whatever the tree order says, so Next
      Up's overhang covered this strip's heading and its "Full schedule"
      link and swallowed every click and scroll aimed at them. Verified in
      the browser with `elementFromPoint`, which named Next Up's scroller as
      the topmost element over both. Shipped that way in 1.19.0.

      Anything else dropped between two rows on the home page needs this too.
    */
    const root = code(STRIP).match(/<section className="([^"]*)"/)
    expect(root?.[1]).toMatch(/\brelative\b/)
  })
})
