import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Rules that no single file can be wrong about on its own, which is why
 * nothing noticed them being broken.
 *
 * `letterApplies` was asked by the three things that *draw* the letter — the
 * picker, the rail and the sort writers — and by nothing that *sends* it. So
 * `/library/<id>?letter=M` with no `?sort=` hid the rail, hid the picker, hid
 * the chip, and filtered the grid to 26 M titles in Recently Added order: a
 * filter with no control, no chip and no way to tell it was on. Browse grew
 * the picker from the shared bar and none of the handling around it — no
 * scroll reset, and a count line that vanished on an empty result instead of
 * saying "0".
 *
 * Both are the shape `authGate` and `effects` already deal with: a rule about
 * how several files have to agree, checked by reading them, in a suite that
 * mounts nothing. The alternative is a reviewer noticing, which is what did
 * not happen.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') ? [full] : []
  })
}

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const read = (file: string) => readFileSync(path.join(SRC, file), 'utf8')
const code = (file: string) => withoutComments(read(file))

/** Every page that renders the shared filter bar, found rather than listed. */
const FILTERED_PAGES = sourceFiles(SRC)
  .filter((file) => /<FilterBar\b/.test(withoutComments(readFileSync(file, 'utf8'))))
  .map((file) => path.relative(SRC, file))

describe('the pages that render the filter bar', () => {
  it('are the two this file is about, and any third one has to opt in here', () => {
    expect(FILTERED_PAGES.sort()).toEqual(['routes/Browse.tsx', 'routes/Library.tsx'])
  })

  for (const file of FILTERED_PAGES) {
    /*
      One derivation per page, so the request, the cache key, the chip bar, the
      picker and the rail are all reading the same filter set. Threaded instead
      through whichever call site remembered to ask, they drift — and the one
      that forgot was the only one that talks to the server.
    */
    it(`${file} takes its filters from useFilterParams and parses none itself`, () => {
      const source = code(file)
      expect(source).toMatch(/useFilterParams\(/)
      expect(source).not.toMatch(/\bparseFilters\s*\(/)
      expect(source).not.toMatch(/\bparseSort\s*\(/)
    })

    /*
      The count line is the only confirmation a screen reader gets that a
      filter did anything, so it has to be in the tree before it changes — a
      node that appears together with its own text is just another node
      appearing. `total > 0 &&` is the guard that removes it on the one result
      that most needs saying out loud.
    */
    it(`${file} keeps its count line mounted and says what it counted`, () => {
      const source = code(file)
      expect(source).toMatch(/<p role="status"/)
      expect(source).toMatch(/matchCountLabel\(/)
      expect(source).not.toMatch(/total > 0 &&/)
    })
  }
})

describe('useFilterParams', () => {
  const source = code('lib/useFilterParams.ts')

  it('clears a letter that the sort does not apply to, before anything reads it', () => {
    // The parse itself, not some call site downstream of it: the whole point
    // is that there is one filter set and the query reads the same one the
    // chips do. Named together here so that applying it to the sort writer
    // alone — which is what the pages used to do — does not look like this.
    expect(source).toMatch(/applicableFilters\(\s*parseFilters\(/)
    expect(source).toMatch(/applicableFilters\(filters,/)
  })

  it('puts the page back at the top when the letter changes', () => {
    // Pressing M while 4,000px down a library otherwise lands you 4,000px
    // into a list that just became 400 titles long: a blank screen.
    expect(source).toMatch(/filterChangeMovesPage\(/)
    expect(source).toMatch(/window\.scrollTo\(/)
  })
})

describe('the letter rail', () => {
  const source = code('components/LetterRail.tsx')

  /*
    Ownership of a key cannot be inferred from whether the focus moved:
    `nextLetterIndex` clamps, so End at Z and a key the rail has never heard of
    are the same answer. Read that way, End at the bottom of the rail fell
    through to the browser and scrolled the page 2,436px under a fixed focus
    ring — and on a long library started fetching the next page too.
  */
  it('consumes the keys it owns before deciding whether the focus moved', () => {
    expect(source).toMatch(/LETTER_RAIL_KEYS\.has\(/)
    const guard = source.indexOf('LETTER_RAIL_KEYS.has(')
    const prevent = source.indexOf('preventDefault()')
    const noMovement = source.search(/next === from/)
    expect(guard).toBeGreaterThan(-1)
    expect(prevent).toBeGreaterThan(guard)
    expect(noMovement).toBeGreaterThan(prevent)
  })

  /*
    `hidden sm:flex` is a width test, and the rail's problems are not about
    width. At 848×389 — an iPhone 15 in landscape — it rendered 393px of rail
    into a 389px viewport with its ends unreachable and its top five buttons
    under the nav, in 20×14px targets on a touchscreen. At 200% zoom on a
    1366×768 laptop, which is the magnification WCAG 1.4.4 asks for, the CSS
    viewport is 683×348 and it is clipped the same way.
  */
  it('is hidden on touchscreens and in a window too short to hold it', () => {
    expect(source).toMatch(/touch:hidden/)
    expect(source).toMatch(/short:hidden/)
    expect(read('index.css')).toMatch(/@custom-variant short \(@media \(max-height/)
    expect(read('index.css')).toMatch(/@custom-variant touch \(@media \(hover: none\)\)/)
  })
})

describe('the filter bar controls', () => {
  /*
    `outline-none` sits in `@layer utilities` and the app's `:focus-visible`
    ring in `@layer base`, so it won every focused `<select>` in the bar
    regardless of specificity — a focused control reported `outline-style:
    none` and showed nothing at all. It was never earning anything either:
    `:focus:not(:focus-visible)` in `index.css` is what keeps mouse clicks
    ring-free.
  */
  it('do not suppress the focus ring they are the only indicator of', () => {
    expect(code('components/FilterBar.tsx')).not.toMatch(/outline-none/)
    expect(read('index.css')).toMatch(/:focus:not\(:focus-visible\)/)
    expect(read('index.css')).toMatch(/:focus-visible \{\s*outline: 2px solid/)
  })
})
