import { useEffect, type RefObject } from 'react'
import type { PageWalk } from './pageWalk'

/**
 * Asking an infinite query for its next page: on scroll, or on its own.
 *
 * Written once because the error guard in both is load-bearing and was
 * paraphrased six different ways. A refused page leaves `hasNextPage` true
 * while `isFetchingNextPage` goes false, and both of these effects re-run
 * whenever those flags change — so without the guard one refusal becomes the
 * same request on the very next render, and the one after that, as fast as the
 * server can refuse it, for as long as the tab is open. On a phone with one bar
 * that is an unbounded retry loop nobody asked for.
 *
 * `isFetchNextPageError` stays set until a page succeeds, so the way out is a
 * deliberate retry: every screen using these keeps a Try again button under
 * the list, and that press is the only thing that starts the walk again.
 */
type Walk = PageWalk & { fetchNextPage: () => unknown }

/**
 * How far ahead of the sentinel the next page starts loading.
 *
 * Generous on purpose: the page should already be there by the time the bottom
 * of the list is, so a flick-scroll never lands on a row of skeletons.
 */
const ROOT_MARGIN = '800px'

/** Pages as the viewer scrolls towards the end of a list. */
export function usePageOnScroll(sentinel: RefObject<Element | null>, walk: Walk) {
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = walk
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasNextPage &&
          !isFetchingNextPage &&
          !isFetchNextPageError
        ) {
          void fetchNextPage()
        }
      },
      { rootMargin: ROOT_MARGIN },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [sentinel, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
}

/**
 * Runs itself to the last page, with nothing to wait for.
 *
 * For the screens built out of a total rather than a list — a year's minutes, a
 * heat map of a year's days, the cards of a recap. The figure is wrong until
 * every page is in, and there is no list to scroll towards that would ask for
 * the rest, so the walk is its own trigger and its stopping condition is the
 * only thing holding it back.
 */
export function usePagesToEnd(walk: Walk) {
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = walk
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage])
}
