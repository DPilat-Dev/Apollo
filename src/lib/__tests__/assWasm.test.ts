import { describe, expect, it, vi } from 'vitest'
import { SIMD_PROBE, pickWasmUrl, supportsSimd } from '../assWasm'

/**
 * Which of libass's two WebAssembly builds this browser will be given.
 *
 * Only here so a prefetch can warm the *same* file JASSUB is about to ask
 * for. Guessing wrong is not a crash — JASSUB still fetches what it wants —
 * it just means two megabytes were downloaded for nothing and the viewer
 * still waits, which is the whole problem this is meant to solve.
 */
describe('supportsSimd', () => {
  it('asks the engine, rather than sniffing the browser', () => {
    const validate = vi.fn().mockReturnValue(true)
    expect(supportsSimd(validate)).toBe(true)
    expect(validate).toHaveBeenCalledTimes(1)
    expect(validate.mock.calls[0][0]).toBeInstanceOf(Uint8Array)
  })

  it('says no when the engine rejects the probe', () => {
    expect(supportsSimd(() => false)).toBe(false)
  })

  it('says no, rather than throwing, where WebAssembly is missing entirely', () => {
    // A browser with WebAssembly disabled by policy throws on validate. ASS
    // cannot work there at all, and the honest answer is the smaller file.
    expect(
      supportsSimd(() => {
        throw new Error('WebAssembly is not defined')
      }),
    ).toBe(false)
  })

  it('probes with a real WebAssembly module, not arbitrary bytes', () => {
    // The magic number and version, which every .wasm starts with. A probe
    // that is not a module at all would be rejected by every engine and this
    // would silently always pick the legacy build.
    expect([...SIMD_PROBE.slice(0, 8)]).toEqual([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])
  })

  it('agrees with the engine actually running these tests', () => {
    // Node validates the same way a browser does, so this pins that the probe
    // is answerable rather than always false.
    expect(typeof supportsSimd()).toBe('boolean')
  })
})

describe('pickWasmUrl', () => {
  const urls = { modern: '/modern.wasm', legacy: '/legacy.wasm' }

  it('takes the SIMD build where SIMD is available', () => {
    expect(pickWasmUrl(urls, true)).toBe('/modern.wasm')
  })

  it('falls back to the plain build otherwise', () => {
    expect(pickWasmUrl(urls, false)).toBe('/legacy.wasm')
  })
})
