import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  SORTS,
  applicableFilters,
  filterChangeMovesPage,
  filtersToParams,
  parseFilters,
  parseSort,
  type LibraryFilters,
  type Sort,
  type SortKey,
} from './libraryFilters'

/**
 * The sort, the filters and the two writers a filtered grid needs, read out of
 * the URL in one place.
 *
 * Library and Browse had grown their own copies of this, and the copies had
 * already drifted. Library scrolls back to the top when the letter changes;
 * Browse, which shows the same picker on every person, genre and studio page
 * — and shows it on arrival, because it defaults to the alphabetical sort —
 * passed the writer straight through and did not. More importantly, both
 * decided separately what to do about a letter the sort does not apply to, and
 * each decided it only for the controls it drew: the request was handed the
 * raw parse, so `?letter=M` with no `?sort=` filtered a grid that had no rail,
 * no picker and no chip to say so.
 *
 * So the derivation happens once, here, and everything downstream of it — the
 * request, the cache key, the chip bar, the picker, the rail — is reading the
 * same `filters` object. `libraryFilters` holds every decision this makes; the
 * only thing that belongs in a hook is the URL and the scroll.
 *
 * Written as a REPLACE, so Back leaves the page rather than walking back
 * through every select change on the way in.
 */
export function useFilterParams(
  /**
   * Which sorts this page offers and which it opens on — as a function of the
   * URL, because on Browse it is one: a page with a `parentId` offers the
   * curated order and defaults to it, and the URL is the thing this hook owns.
   */
  sortContext: (params: URLSearchParams) => { sorts?: readonly Sort[]; fallback: SortKey },
): {
  params: URLSearchParams
  filters: LibraryFilters
  sort: Sort
  /** The orders to offer, for handing straight to the filter bar. */
  sorts: readonly Sort[]
  setFilters: (next: LibraryFilters) => void
  setSort: (key: SortKey) => void
} {
  const [params, setParams] = useSearchParams()
  const { sorts, fallback } = sortContext(params)
  const sort = parseSort(params.get('sort'), fallback, sorts)
  const filters = useMemo(
    () => applicableFilters(parseFilters(params), sort.key),
    [params, sort.key],
  )

  const write = (next: URLSearchParams) => setParams(next, { replace: true })

  const setFilters = (next: LibraryFilters) => {
    if (filterChangeMovesPage(filters, next)) window.scrollTo({ top: 0 })
    write(filtersToParams(next, params))
  }

  /*
    Leaving A–Z takes the letter with it, out of the URL as well as out of the
    request — a letter that outlived its own picker would be state with nothing
    on screen admitting to it, which is the empty-library illusion the chip bar
    exists to prevent, except with no control left to undo it.
  */
  const setSort = (key: SortKey) => {
    const next = new URLSearchParams(params)
    next.set('sort', key)
    write(filtersToParams(applicableFilters(filters, key), next))
  }

  return { params, filters, sort, sorts: sorts ?? SORTS, setFilters, setSort }
}
