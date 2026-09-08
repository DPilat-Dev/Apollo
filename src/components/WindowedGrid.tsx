import { memo, type ReactNode } from 'react'
import { useWindowedGrid } from '../lib/useWindowedGrid'

/**
 * A poster grid that only renders the rows near the viewport.
 *
 * Its own component, and that is the point rather than tidiness. The window
 * changes as you scroll, and whatever holds that state re-renders when it
 * does. Held by the page, every scroll past a block of rows re-ran the whole
 * screen — the filter bar, the heading, the counts — to move a grid. Held
 * here, the page renders when its data changes and this renders when the
 * window does.
 *
 * The arithmetic is in `windowedGrid.ts` and the measuring in
 * `useWindowedGrid.ts`; this is the markup and the boundary.
 */
function WindowedGridInner<T>({
  items,
  className,
  children,
}: {
  items: readonly T[]
  /** The grid's own classes, including its columns and gaps. */
  className: string
  /** Renders one item. Called only for the items in the window. */
  children: (item: T, index: number) => ReactNode
}) {
  const grid = useWindowedGrid(items.length)

  return (
    <div
      ref={grid.ref}
      className={className}
      /*
        Padding rather than spacer elements: a spacer inside a grid is a grid
        item and would take a cell. This leaves the page exactly as tall as it
        would have been with every row rendered, so the scrollbar does not move
        as you scroll and "keep your place" still finds a page to scroll into.
      */
      style={{ paddingTop: grid.window.paddingTop, paddingBottom: grid.window.paddingBottom }}
    >
      {items
        .slice(grid.window.startIndex, grid.window.endIndex)
        .map((item, i) => children(item, grid.window.startIndex + i))}
    </div>
  )
}

/*
  Memoised so a page re-rendering for its own reasons — a filter changing, a
  count arriving — does not rebuild the visible rows. `children` is a function
  and must be stable at the call site for this to hold, which is why both
  callers define theirs outside the render or with `useCallback`.
*/
export const WindowedGrid = memo(WindowedGridInner) as typeof WindowedGridInner
