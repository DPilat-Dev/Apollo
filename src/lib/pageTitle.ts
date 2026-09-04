/**
 * What the browser tab is called.
 *
 * Every screen in this app was called "Apollo". Three tabs open, the history
 * menu, the back button's long-press list, the Android task switcher and the
 * bookmark it saves — all of them said the same word, which makes each of them
 * useless for telling one screen from another.
 *
 * The rule is the ordinary one: what you are looking at, then the app's name,
 * in that order, because a tab strip truncates from the right and the part
 * worth keeping is the part that differs.
 */

export const APP_NAME = 'Apollo'

/** Between the subject and the app name. Not a dash: titles contain dashes. */
const SEPARATOR = ' · '

/**
 * Long enough for a series and an episode, short enough that it is not the
 * reason a tab strip collapses. Tabs truncate anyway; this only stops a
 * pathological title being carried around in history and bookmarks.
 */
const MAX_LENGTH = 120

/**
 * The title for a screen, given what it is showing.
 *
 * Parts are ordered most-specific first, so an episode reads
 * `The Chosen Future · Gundam SEED Destiny · Apollo`. Empty and missing parts
 * drop out rather than leaving a stray separator, which is what lets a caller
 * pass a value that is still loading without branching on it.
 */
export function pageTitle(...parts: (string | null | undefined)[]): string {
  const named = parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0)

  if (named.length === 0) return APP_NAME

  const full = [...named, APP_NAME].join(SEPARATOR)
  if (full.length <= MAX_LENGTH) return full

  /*
    Too long. Trim the subject rather than dropping the app name: a title that
    ends mid-word tells you it was cut, while one missing its suffix looks like
    a different app.
  */
  const room = MAX_LENGTH - APP_NAME.length - SEPARATOR.length
  const subject = named.join(SEPARATOR)
  return `${subject.slice(0, Math.max(1, room - 1)).trimEnd()}…${SEPARATOR}${APP_NAME}`
}
