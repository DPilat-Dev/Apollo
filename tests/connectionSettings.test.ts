import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Rules about the connection test on the Settings page.
 *
 * The arithmetic is unit-tested in `connectionTest.test.ts` and the runner in
 * `forcedMeasurement.test.ts`. What neither can see is the wiring, and the
 * wiring is where this feature can be quietly useless:
 *
 * - Gated on `isAdmin`, it would answer the question for the one person who
 *   can already read it off the server dashboard.
 * - Reading the cache instead of forcing a probe, the button returns a figure
 *   from nine minutes ago in no time flat and looks broken.
 * - Showing only the ceiling, the page reports 29 Mbps on a line somebody
 *   knows is 42 and reads as a measurement that is wrong.
 *
 * Same approach as `playerQuality` and `authGate`: rules enforced by reading
 * the source, in a suite that mounts nothing.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), 'utf8'))

const SETTINGS = 'routes/Settings.tsx'
const TEST_PANEL = 'components/ConnectionTest.tsx'

describe('the connection test on the Settings page', () => {
  it('is on the page for every signed-in user', () => {
    const source = code(SETTINGS)
    expect(source).toMatch(/<ConnectionTest\s*\/>/)
    // Not behind the admin check that guards the dashboard link: the people
    // who need to know why video stalls at their house are the ones who
    // cannot open the server's own speed test.
    expect(source).not.toMatch(/isAdmin[^\n]*ConnectionTest/)
    expect(source).not.toMatch(/ConnectionTest[^\n]*isAdmin/)
  })

  it('sits with the quality setting it explains', () => {
    const source = code(SETTINGS)
    const playback = source.slice(source.indexOf('<Section title="Playback">'))
    const panel = playback.indexOf('<ConnectionTest')
    const end = playback.indexOf('</Section>')
    expect(panel).toBeGreaterThan(-1)
    expect(panel).toBeLessThan(end)
  })

  it('forces a fresh probe rather than answering from the cache', () => {
    expect(code(TEST_PANEL)).toMatch(/ensureMeasurement\([^)]*\{\s*force:\s*true\s*\}/)
  })

  it('shows the measured speed next to the ceiling Auto will use', () => {
    const panel = code(TEST_PANEL)
    expect(panel).toMatch(/rawBps/)
    expect(panel).toMatch(/formatMbps/)
    expect(panel).toMatch(/supportedQualityLabel/)
    expect(panel).toMatch(/verdict/)
  })

  it('says so when the test could not be run at all', () => {
    // `measured: false` is the 404-on-an-old-server case. Reporting the 8 Mbps
    // fallback as a measurement would be a made-up number on a page of facts.
    expect(code(TEST_PANEL)).toMatch(/measured/)
    expect(code(TEST_PANEL)).toMatch(/could not|couldn't|Couldn't|Could not/)
  })

  it('re-arms the mounted flag rather than only clearing it', () => {
    /*
      Caught by running it, not by a test: in StrictMode React mounts, unmounts
      and remounts, so a flag that is only cleared in the cleanup is false for
      the rest of the component's life. Every probe came back 200 and the panel
      sat on "Testing…" forever, because each state update was skipped.
    */
    expect(code(TEST_PANEL)).toMatch(/useEffect\(\(\) => \{\s*live\.current = true/)
  })

  it('shows something moving while the test runs', () => {
    /*
      The test can take the full three seconds on the connections it exists to
      diagnose, and "Testing…" on a button is not enough to tell a slow test
      from a dead one. The bar is decorative — the status text is what a
      screen reader hears — and it has a still variant under reduced motion
      rather than being switched off, because then nothing would say the page
      is busy.
    */
    const panel = code(TEST_PANEL)
    expect(panel).toMatch(/animate-\[bitrate-sweep/)
    expect(panel).toMatch(/aria-hidden/)
    const css = readFileSync(path.join(SRC, 'index.css'), 'utf8')
    expect(css).toMatch(/@keyframes bitrate-sweep\b/)
    expect(css).toMatch(/@keyframes bitrate-sweep-still\b/)
    expect(css).toMatch(/\[class\*='bitrate-sweep'\]/)
  })

  it('cannot be started twice at once from the button', () => {
    // A second press mid-test adds a download that competes with the one being
    // timed, which measures the connection as slower than it is.
    expect(code(TEST_PANEL)).toMatch(/disabled=\{[^}]*(testing|running|busy)/i)
  })
})
