/**
 * Taking back the low-latency canvas hint that JASSUB asks for.
 *
 * ── What goes wrong ────────────────────────────────────────────────────────
 *
 * Every renderer JASSUB can pick — WebGL2, WebGL1 and the 2D fallback — creates
 * its context with `desynchronized: true`. That flag asks the browser to skip
 * the usual compositing queue for the canvas, and on Android the way a browser
 * grants it is to hand the canvas its own hardware plane.
 *
 * A canvas on its own plane is scanned out, not blended. The transparent parts
 * stop being transparent and come out black, so the subtitle layer becomes a
 * black sheet with the subtitles drawn on it and the video vanishes behind it.
 * Both Chrome and Firefox on Android do this, which is the tell that it is the
 * platform's compositor rather than either engine.
 *
 * The clue that named it: opening the subtitle menu brought the video back.
 * Stacking a menu over the canvas makes the plane untenable, the browser
 * demotes it to an ordinary layer, alpha starts working again — and closing the
 * menu promotes it and loses the picture a second time.
 *
 * ── Why it is fixed here rather than in an option ──────────────────────────
 *
 * JASSUB does not expose the flag; it is hard-coded in all four of its render
 * paths as of 2.5.14, the current release. What it does expose is `workerUrl`,
 * so Apollo supplies a worker that installs this patch and then loads JASSUB's
 * own worker unchanged. Import order is the whole mechanism: ES modules
 * evaluate in the order they are imported, so the patch is in place before any
 * JASSUB code runs.
 *
 * Nothing is lost by refusing it. `desynchronized` trades compositing
 * correctness for a frame of latency on a canvas that draws subtitles, where a
 * frame of latency cannot be perceived and correctness is the entire job.
 */

/** The `getContext` shape both `HTMLCanvasElement` and `OffscreenCanvas` share. */
type GetContext = (this: unknown, type: string, attrs?: unknown) => unknown

/**
 * The attributes to actually pass on.
 *
 * Returned rather than mutated: the caller's object is JASSUB's, and a renderer
 * that reuses one literal across contexts should not find it rewritten. Absent
 * or non-object attributes come back untouched, so a `getContext('2d')` with no
 * second argument stays a call with no second argument — passing `{}` instead
 * would be a different call, and this has no business changing that.
 */
export function withoutLowLatency(attrs: unknown): unknown {
  if (!attrs || typeof attrs !== 'object') return attrs
  if (!('desynchronized' in attrs)) return attrs
  // Deleted rather than set false, so the browser sees a request that was never
  // made rather than one explicitly declined. Both are honoured; only one is
  // honest about what Apollo wants, which is the default.
  const { desynchronized: _dropped, ...rest } = attrs as Record<string, unknown>
  return rest
}

/**
 * Wraps one `getContext` so the hint never reaches the browser.
 *
 * Returns the replacement rather than assigning it, so the decision of what to
 * patch belongs to the caller and this stays testable without a canvas.
 */
export function patchGetContext(original: GetContext): GetContext {
  return function patched(this: unknown, type: string, attrs?: unknown) {
    return original.call(this, type, withoutLowLatency(attrs))
  }
}

/**
 * Installs the patch on whatever canvas classes this scope has.
 *
 * A worker has `OffscreenCanvas` and no `HTMLCanvasElement`; a document has
 * both. Neither is assumed, and a scope with neither is left alone rather than
 * throwing — this runs before anything else in the worker, and a failure here
 * would take libass down with it for the sake of a hint.
 */
export function installCanvasHintPatch(scope: {
  OffscreenCanvas?: { prototype: { getContext: unknown } }
  HTMLCanvasElement?: { prototype: { getContext: unknown } }
}): number {
  let patched = 0
  for (const ctor of [scope.OffscreenCanvas, scope.HTMLCanvasElement]) {
    const proto = ctor?.prototype
    if (!proto || typeof proto.getContext !== 'function') continue
    proto.getContext = patchGetContext(proto.getContext as GetContext)
    patched += 1
  }
  return patched
}
