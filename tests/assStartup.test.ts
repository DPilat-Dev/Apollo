import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * How quickly libass can be on screen, which no single file decides.
 *
 * Starting libass costs four things: the subtitle file, the server's font
 * list, the renderer chunk, and then two megabytes of WebAssembly fetched
 * from inside JASSUB's worker. Until 1.19.1 those happened strictly one
 * after another — measured against a real server, the renderer chunk was not
 * even requested until 135ms after the subtitle file had arrived — so the
 * expensive download started last, with the episode already playing.
 *
 * The rules below are what keeps that fixed. They are here rather than in a
 * unit test because every one of them is a relationship between files: a
 * worker, a dynamic import and an HTTP cache, none of which exist in node.
 */
const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'src')

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), 'utf8'))

const HOOK = 'lib/useAssSubtitles.ts'
const RENDERER = 'lib/assRenderer.ts'
const WARM = 'lib/assWarm.ts'
const WASM = 'lib/assWasm.ts'
const PLAYER = 'routes/Player.tsx'

describe('starting libass', () => {
  it('fetches the file, the fonts and the renderer at once', () => {
    const hook = code(HOOK)
    const parallel = hook.match(/Promise\.all\(\[([\s\S]*?)\]\)/)
    expect(parallel, 'the three startup fetches should share one Promise.all').toBeTruthy()
    const inside = parallel![1]
    expect(inside).toMatch(/api\.assSubtitle\(/)
    expect(inside).toMatch(/api\.fallbackFonts\(/)
    expect(inside).toMatch(/import\('\.\/assRenderer'\)/)
  })

  it('does not go back to awaiting them one at a time', () => {
    // The shape that caused this: each await blocking the next request.
    const hook = code(HOOK)
    expect(hook).not.toMatch(/const content = await api\.assSubtitle/)
    expect(hook).not.toMatch(/await api\.fallbackFonts\(\)[\s\S]{0,200}await import\(/)
  })

  it('warms the renderer from the player, while the video is buffering', () => {
    const player = code(PLAYER)
    expect(player).toMatch(/warmAssRenderer\(\)/)
    expect(player).toMatch(/assWarmWanted\(\{[\s\S]{0,200}subtitles: plan\?\.subtitles/)
  })

  it('lets the viewer opt out of the download they turned off', () => {
    // `assTypesetting` off means no renderer is ever constructed, so warming
    // one would spend two megabytes of somebody's bandwidth on nothing.
    expect(code(PLAYER)).toMatch(/assWarmWanted\(\{[\s\S]{0,200}enabled: settings\.assTypesetting/)
  })

  it('warms once, however many times the player re-renders', () => {
    expect(code(WARM)).toMatch(/started \?\?=/)
  })

  it('never lets a failed warm surface or reject', () => {
    // It is an optimisation. Every fetch in it happens again, for real, when
    // the renderer is constructed — so a failure here must be invisible.
    expect(code(WARM)).toMatch(/\.catch\(/)
    expect(code(RENDERER)).toMatch(/prefetchAssBinaries[\s\S]{0,700}\.catch\(/)
  })

  it('warms at a priority that cannot starve the video', () => {
    expect(code(RENDERER)).toMatch(/priority: 'low'/)
  })

  it('warms the same WebAssembly build JASSUB will ask for', () => {
    // Prefetching the other one is not a crash — JASSUB still fetches what it
    // wants — it just means two megabytes were spent for nothing.
    const renderer = code(RENDERER)
    expect(renderer).toMatch(/pickWasmUrl\(\{ modern: modernWasmUrl, legacy: wasmUrl \}/)
    expect(renderer).toMatch(/supportsSimd\(\)/)
  })

  it('probes for SIMD with the bytes jassub itself uses', () => {
    /*
      JASSUB picks its build with `_supportsSIMD ? modern : normal`, and
      neither the flag nor the probe is exported. Apollo therefore keeps a
      copy, and a copy silently drifts: an upgrade that changes the probe
      would leave Apollo warming the wrong file, costing exactly the two
      megabytes this is meant to save, with nothing on screen to show it.

      So the copy is pinned to the original. If this fails after a jassub
      upgrade, read its `_test()` and update `SIMD_PROBE` to match.
    */
    /* Every hex byte of the literal that starts at `from`, however it is
       spelled — `Uint8Array.of(...)` on one side, `new Uint8Array([...])` on
       the other, and neither spelling is the point. */
    const bytesIn = (source: string, from: string) => {
      const at = source.indexOf(from)
      expect(at, `"${from}" not found`).toBeGreaterThan(-1)
      const open = source.indexOf('Uint8Array', at)
      const literal = source.slice(open, source.indexOf(';', open))
      return (literal.match(/0x[0-9a-fA-F]{2}/g) ?? []).map((b) => parseInt(b, 16))
    }
    const jassub = readFileSync(path.join(ROOT, 'node_modules/jassub/dist/jassub.js'), 'utf8')
    const theirs = bytesIn(jassub, 'static _test()')
    const ours = bytesIn(code(WASM), 'export const SIMD_PROBE')

    expect(theirs.length).toBeGreaterThan(8)
    expect(ours).toEqual(theirs)
  })
})
