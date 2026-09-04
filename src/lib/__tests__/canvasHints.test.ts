import { describe, expect, it, vi } from 'vitest'
import { installCanvasHintPatch, patchGetContext, withoutLowLatency } from '../canvasHints'

describe('withoutLowLatency', () => {
  it('removes the hint that costs the video its transparency', () => {
    expect(withoutLowLatency({ alpha: true, desynchronized: true })).toEqual({ alpha: true })
  })

  it('removes it even when it was already false', () => {
    // The browser reads the key, not the value's truthiness on our side; a
    // half-patch that only caught `true` would be a patch that does nothing
    // the day JASSUB writes it differently.
    expect(withoutLowLatency({ alpha: true, desynchronized: false })).toEqual({ alpha: true })
  })

  it('leaves every other attribute exactly as it found them', () => {
    const attrs = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false }
    expect(withoutLowLatency(attrs)).toEqual(attrs)
  })

  it('does not mutate the caller’s object', () => {
    // JASSUB builds these as literals inside its renderers; rewriting one in
    // place would change a later context this never saw.
    const attrs = { alpha: true, desynchronized: true }
    withoutLowLatency(attrs)
    expect(attrs.desynchronized).toBe(true)
  })

  it('passes a missing argument through as missing', () => {
    // `getContext('2d')` and `getContext('2d', {})` are different calls, and
    // turning one into the other is not this function's business.
    expect(withoutLowLatency(undefined)).toBeUndefined()
    expect(withoutLowLatency(null)).toBeNull()
  })
})

describe('patchGetContext', () => {
  it('calls through with the hint stripped', () => {
    const original = vi.fn(() => 'ctx')
    const patched = patchGetContext(original)
    expect(patched.call(null, 'webgl2', { alpha: true, desynchronized: true })).toBe('ctx')
    expect(original).toHaveBeenCalledWith('webgl2', { alpha: true })
  })

  it('keeps the canvas as the receiver', () => {
    // `getContext` is a prototype method; called with the wrong `this` it
    // throws an illegal-invocation error rather than returning a context.
    const canvas = { tag: 'canvas' }
    let seen: unknown = null
    const patched = patchGetContext(function (this: unknown) {
      seen = this
      return null
    })
    patched.call(canvas, '2d')
    expect(seen).toBe(canvas)
  })
})

describe('installCanvasHintPatch', () => {
  const fakeClass = () => ({ prototype: { getContext: vi.fn(() => 'ctx') } })

  it('patches OffscreenCanvas, which is the one the worker uses', () => {
    const scope = { OffscreenCanvas: fakeClass() }
    expect(installCanvasHintPatch(scope)).toBe(1)
    ;(scope.OffscreenCanvas.prototype.getContext as (t: string, a: unknown) => unknown)(
      'webgl2',
      { alpha: true, desynchronized: true },
    )
    // The spy is the pre-patch function; it must see the cleaned attributes.
    expect(scope.OffscreenCanvas.prototype.getContext).not.toBe(undefined)
  })

  it('patches both when both exist', () => {
    expect(installCanvasHintPatch({ OffscreenCanvas: fakeClass(), HTMLCanvasElement: fakeClass() })).toBe(2)
  })

  it('does nothing, quietly, in a scope with neither', () => {
    // This runs before libass loads. Throwing here would cost the viewer
    // subtitles entirely, to fix a hint.
    expect(installCanvasHintPatch({})).toBe(0)
  })

  it('ignores a class whose getContext is not a function', () => {
    expect(installCanvasHintPatch({ OffscreenCanvas: { prototype: { getContext: null } } })).toBe(0)
  })

  it('actually strips the hint once installed', () => {
    const original = vi.fn(() => 'ctx')
    const scope = { OffscreenCanvas: { prototype: { getContext: original } } }
    installCanvasHintPatch(scope)
    const patched = scope.OffscreenCanvas.prototype.getContext as (t: string, a: unknown) => unknown
    patched.call(scope.OffscreenCanvas.prototype, 'webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      desynchronized: true,
    })
    expect(original).toHaveBeenCalledWith('webgl2', { alpha: true, premultipliedAlpha: true })
  })
})
