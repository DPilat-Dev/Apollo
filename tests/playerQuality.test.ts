import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Rules about how Auto has to hang together, which no one file can be right
 * about on its own.
 *
 * The arithmetic lives in `bandwidth.ts` and `adaptiveQuality.ts` and has unit
 * tests. What those cannot see is the wiring, and the wiring is where every
 * expensive mistake in this feature is:
 *
 * - Resolving the stream *before* the measurement lands means the first
 *   request is the unlimited one the feature exists to stop sending.
 * - The step-down effect depending on anything that changes on a `timeupdate`
 *   tears down the five-second timer four times a second, so the long-stall
 *   rule silently never fires.
 * - The step-down running outside Auto would override a figure a person chose
 *   by hand.
 *
 * None of those break a unit test, and all of them are visible in the source.
 * Same approach as `requestSurfaces` and `authGate`: a rule enforced by
 * reading the files, in a suite that mounts nothing.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), 'utf8'))

const PLAYER = 'routes/Player.tsx'
const API = 'lib/api.ts'
const SETTINGS = 'lib/settings.ts'

describe('Auto asks for what it measured', () => {
  it('waits for the measurement before resolving the stream', () => {
    // Otherwise playback opens at Jellyfin's 120 Mbps default, then switches —
    // two transcodes, the first of them the one that stalls.
    expect(code(PLAYER)).toMatch(/enabled:[^\n]*!auto \|\| bandwidth\.bps != null/)
  })

  it('hands the measured figure to the stream, not the stored 0', () => {
    expect(code(PLAYER)).toMatch(
      /effectiveBitrate = auto \? \(autoDrop \?\? bandwidth\.bps \?\? 0\) : chosen/,
    )
  })

  it('keeps the spinner up while measuring, rather than showing a dead screen', () => {
    // With the query disabled, `streamQuery.isLoading` is false, so without
    // this the probe happens behind an empty player.
    expect(code(PLAYER)).toMatch(/bandwidth\.measuring/)
  })

  it('measures per episode, so a binge is not pinned to the first one', () => {
    expect(code(PLAYER)).toMatch(/useBandwidth\(auto, item\?\.Id \?\? null\)/)
  })
})

describe('the step-down', () => {
  const source = code(PLAYER)

  it('runs only in Auto', () => {
    // A figure someone picked by hand is a decision, not a hint.
    expect(source).toMatch(/if \(!video \|\| !plan \|\| !auto\) return/)
  })

  it('does not depend on anything that changes while the clock runs', () => {
    const deps = source.match(/\}, \[auto, effectiveBitrate, noteBandwidth, plan\]\)/)
    expect(deps).not.toBeNull()
    // `reloadFrom` closes over the current position, so it is a new function on
    // every `timeupdate` — four times a second, each one clearing the timer
    // that the long-stall rule is waiting on.
    const effect = source.slice(source.indexOf('const onWaiting'))
    expect(effect.slice(0, effect.indexOf('}, ['))).not.toMatch(/reloadFrom/)
  })

  it('resumes from the element rather than from the last timeupdate', () => {
    // A stall means no `timeupdate` has landed for a while; resuming from one
    // would rewind the picture by however long it was frozen.
    expect(source).toMatch(/resumeTargetRef\.current = video\.currentTime \+ plan\.startOffsetSeconds/)
  })

  it('records the lower figure so the next episode opens there', () => {
    expect(source).toMatch(/noteBandwidth\(next\)/)
  })

  it('says so on screen', () => {
    expect(source).toMatch(/dropMessage\(next\)/)
    expect(source).toMatch(/role="status"/)
  })

  it('clears the ladder and the history when the episode changes', () => {
    expect(source).toMatch(/setAutoDrop\(null\)[\s\S]{0,120}stallsRef\.current = \[\]/)
  })

  it('drops the adaptive ceiling when a quality is picked by hand', () => {
    // Two `setAutoDrop(null)` in the menu: one on the Auto row, one on the
    // fixed rungs. Coming back to Auto must re-measure, not re-use a drop.
    const menu = source.slice(source.indexOf('<MenuGroup title="Quality">'))
    expect(menu.match(/setAutoDrop\(null\)/g)).toHaveLength(2)
  })
})

describe('the words', () => {
  it('no longer promises no limit anywhere', () => {
    // Auto has a ceiling now. Saying otherwise in the menu or in Settings is
    // the kind of stale copy nobody re-reads.
    expect(code(SETTINGS)).not.toMatch(/no limit/i)
    expect(code(PLAYER)).not.toMatch(/Auto \(no limit\)/)
  })

  it('ticks the choice rather than the resolved ceiling', () => {
    // With the ceiling, Auto on a 6 Mbps line would tick the 6 Mbps rung and
    // claim a choice nobody made.
    const menu = code(PLAYER).slice(code(PLAYER).indexOf('<MenuGroup title="Quality">'))
    expect(menu).toMatch(/active=\{auto\}/)
    expect(menu).toMatch(/active=\{!auto && chosen === o\.value\}/)
  })
})

describe('the probe', () => {
  it('is not routed through the JSON request helper', () => {
    // The body is binary padding; `request` would hand it to JSON.parse.
    const api = code(API)
    const method = api.slice(api.indexOf('async bitrateTest('))
    const body = method.slice(0, method.indexOf('\n  }'))
    expect(body).toMatch(/fetch\(this\.url\('\/Playback\/BitrateTest'/)
    expect(body).not.toMatch(/this\.request</)
  })

  it('refuses the cache, so it measures the connection and not the disk', () => {
    const api = code(API)
    const method = api.slice(api.indexOf('async bitrateTest('))
    expect(method.slice(0, method.indexOf('\n  }'))).toMatch(/cache: 'no-store'/)
  })
})
