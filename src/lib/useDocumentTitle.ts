import { useEffect } from 'react'

/**
 * Names the browser tab.
 *
 * One line of glue around `pageTitle`, which does the deciding and is tested.
 * Set rather than restored on unmount: the next screen sets its own, and a
 * restore would put the old name back for the frame in between.
 */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title
  }, [title])
}
