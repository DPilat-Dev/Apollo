import { describe, expect, it } from 'vitest'
import { pagesSettling, type PageWalk } from '../pageWalk'

const walk = (over: Partial<PageWalk & { isLoading: boolean }> = {}) => ({
  isLoading: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  isFetchNextPageError: false,
  ...over,
})

describe('pagesSettling', () => {
  // The first page: there is nothing on screen yet, so everything is skeletons.
  it('is settling while the first page is in flight', () => {
    expect(pagesSettling(walk({ isLoading: true, hasNextPage: false }))).toBe(true)
  })

  // A total built from half a year is a wrong number, not a partial one, so the
  // figure stays hidden while there is another page to come.
  it('is settling while there are pages left to ask for', () => {
    expect(pagesSettling(walk({ hasNextPage: true }))).toBe(true)
    expect(pagesSettling(walk({ isFetchingNextPage: true }))).toBe(true)
  })

  it('is done once the last page is in', () => {
    expect(pagesSettling(walk())).toBe(false)
  })

  /*
    The case this exists for. `hasNextPage` stays true after a page is refused,
    so a screen reading it directly counts for ever: the heat map held
    "Counting…" over a graph that would never finish counting, the recap page
    shimmered instead of showing the part of the year that did arrive, and the
    story's spinner outlived every request feeding it.
  */
  it('is not settling once a page has been refused', () => {
    expect(pagesSettling(walk({ hasNextPage: true, isFetchNextPageError: true }))).toBe(false)
    expect(
      pagesSettling(walk({ hasNextPage: true, isFetchingNextPage: true, isFetchNextPageError: true })),
    ).toBe(false)
  })
})
