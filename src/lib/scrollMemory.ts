/**
 * Keeping your place in a grid you came back to.
 *
 * The app scrolls to the top on every navigation, which is right for following
 * a link and wrong for going back. Scroll a long way into a library, open a
 * show, press back: the browser restores the route but the app has already put
 * you at the top, and the twenty rows you had worked through are gone.
 *
 * The browser's own `history.scrollRestoration` cannot do this here. It restores
 * a position at the moment the entry is popped, and the grid at that moment is
 * still empty — the items arrive a query later, so it restores against a page
 * one screen tall and lands at the top anyway. So the offset is remembered
 * against the history entry and reapplied once the content is tall enough to
 * hold it.
 */

/** react-router's navigation types, named here so nothing else imports them. */
export type NavKind = 'PUSH' | 'REPLACE' | 'POP'

/**
 * Where a navigation should leave the page.
 *
 * `null` means "do not touch the scroll position at all", which is not the same
 * as zero: a REPLACE is the app rewriting the current entry — a filter being
 * applied, a query string being tidied — and yanking someone to the top for
 * that is the behaviour this whole module exists to stop.
 */
export function scrollTargetFor({
  kind,
  remembered,
}: {
  kind: NavKind
  remembered?: number
}): number | null {
  if (kind === 'REPLACE') return null
  if (kind === 'POP') return remembered ?? 0
  return 0
}

/**
 * How far down the page may still be short of the remembered offset before the
 * restore is abandoned.
 *
 * A grid that has loaded fewer items than last time — a filter changed, an
 * item deleted — will never grow tall enough, and waiting forever means the
 * page silently jumps under someone who has started reading. One screen of
 * slack covers the ordinary case of the last row being a little shorter.
 */
export const RESTORE_SLACK_PX = 400

/**
 * Whether the page is tall enough for the restore to mean anything yet.
 *
 * Asked repeatedly as content loads. Once it is true the offset is applied and
 * the watching stops.
 */
export function canRestore({
  target,
  scrollHeight,
  viewportHeight,
}: {
  target: number
  scrollHeight: number
  viewportHeight: number
}): boolean {
  if (target <= 0) return true
  return scrollHeight - viewportHeight + RESTORE_SLACK_PX >= target
}

/**
 * The remembered offsets, oldest dropped first.
 *
 * Keyed by history entry rather than by path: the same library visited twice in
 * one session is two entries and two places in the grid, and keying by path
 * would give the second visit the first one's offset. Capped because a session
 * that browses all evening should not accumulate an entry per click forever.
 */
export function createScrollMemory(limit = 50) {
  const places = new Map<string, number>()

  return {
    remember(key: string, offset: number) {
      if (!key || !Number.isFinite(offset) || offset < 0) return
      // Delete first so a re-remembered key moves to the end and survives the
      // eviction below; a Map without this keeps its original insertion order
      // and would drop the entry someone is actively using.
      places.delete(key)
      places.set(key, offset)
      while (places.size > limit) {
        const oldest = places.keys().next()
        if (oldest.done) break
        places.delete(oldest.value)
      }
    },
    recall(key: string): number | undefined {
      return places.get(key)
    },
    get size() {
      return places.size
    },
  }
}

export type ScrollMemory = ReturnType<typeof createScrollMemory>
