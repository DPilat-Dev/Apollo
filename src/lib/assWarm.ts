/**
 * Starting the libass download before anybody is waiting on it.
 *
 * Two separate costs are being moved earlier. The renderer module itself is a
 * dynamic import — a chunk that has to arrive before a single byte of the
 * engine is requested — and JASSUB then fetches two megabytes of WebAssembly
 * and a font from inside its worker. Left alone, all of that happens after
 * the subtitle file has been fetched, which is to say while the episode is
 * already playing and the viewer is reading nothing.
 *
 * This file is the trigger and nothing else; it stays tiny on purpose, so
 * that importing it costs the player nothing. Everything heavy lives behind
 * the dynamic import below, exactly as it did before.
 */

/** One warm per page. Repeat calls get the first promise back. */
let started: Promise<void> | null = null

export function warmAssRenderer(): Promise<void> {
  started ??= import('./assRenderer')
    .then((mod) => mod.prefetchAssBinaries())
    .catch(() => {
      // An unreachable chunk is the fallback path's problem to report, not a
      // prefetch's. Nothing here is load-bearing: every one of these fetches
      // happens again, for real, when the renderer is actually constructed.
      started = null
    })
  return started
}

/** Test seam: forget that a warm ever happened. */
export function resetAssWarmForTests(): void {
  started = null
}
