import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import type { SubtitleTrack } from './playback'

/**
 * The subtitle choice a viewer made, kept for the next time they press play.
 *
 * Apollo had no memory of this at all. Choosing a track lasted exactly as long
 * as the player was open: leaving and coming back ran the automatic selection
 * again, which knows only the one language in Settings, so a show watched with
 * its English track came back in whatever that setting said — or in nothing.
 *
 * ── Why a language and not the index ──────────────────────────────────────
 *
 * Because the next episode is a different file. Stream indexes are positions
 * inside one container: track 3 is English on tonight's episode and Castilian
 * Spanish on next week's, and the thing worth carrying across is which
 * language was being read, not where it happened to sit. Within one file a
 * language resolves back to the same track anyway, so replaying the same item
 * behaves as though the index had been stored.
 *
 * Off is a choice too, and a different one from never having chosen — which is
 * why this is a union rather than a nullable language. Someone who turned
 * subtitles off on a show meant it, and the automatic selection putting them
 * back every episode is the same complaint from the other side.
 *
 * ── Why the series ────────────────────────────────────────────────────────
 *
 * People choose subtitles for a show, not for an episode. Keyed per episode,
 * the memory would be right about the one they had already watched and useless
 * about the one they were about to. Films have no series and key on themselves.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 *
 * Not the only place the choice is recorded. Jellyfin keeps its own, through
 * `RememberSubtitleSelections` and the stream indexes a client reports while
 * playing, and `useProgressReporter` now sends those — so jellyfin-web and a
 * phone and this all agree. That memory is not read back here, deliberately:
 * the server reports `DefaultSubtitleStreamIndex` whether or not anybody ever
 * chose anything, falling back to whatever the file flags as its own default,
 * and the two cases are indistinguishable from outside. Measured on this
 * server: an item nobody has played answers 3 where the file flags 3, 2 where
 * it flags 2, and null where it flags nothing. Trusting that would turn
 * subtitles on for people who have them switched off, which is not a memory,
 * it is a different feature.
 */
export type SubtitleChoice = { kind: 'off' } | { kind: 'language'; language: string }

/*
  Under the `apollo.` prefix deliberately: `keysToPurgeOnSwitch` is deny-by-
  default over that prefix, so signing out or switching user takes this with
  it without anything here having to remember to ask.
*/
const KEY = 'apollo.subtitleChoice'

/**
 * How many shows are remembered.
 *
 * Small on purpose. This exists to carry a choice from one evening to the
 * next, not to build a profile, and an unbounded map in localStorage is a
 * quota error waiting for whoever watches the most.
 */
export const MEMORY_LIMIT = 100

/** Which show this choice belongs to. Films stand for themselves. */
export function subtitleMemoryKey(
  item: Pick<BaseItemDto, 'Id' | 'SeriesId'> | null | undefined,
): string | null {
  return item?.SeriesId ?? item?.Id ?? null
}

/**
 * What to remember about a track, or `off` for none.
 *
 * A track with no language is not worth storing: it would match nothing on the
 * next file, and keeping it would mean the real choice underneath never got
 * made again. Returning null leaves whatever was remembered before alone.
 */
export function choiceFor(track: SubtitleTrack | null | undefined): SubtitleChoice | null {
  if (!track) return { kind: 'off' }
  const language = (track.language ?? '').trim()
  return language ? { kind: 'language', language } : null
}

export interface StoredChoice {
  choice: SubtitleChoice
  at: number
}
export type Store = Record<string, StoredChoice>

/**
 * A stored map from whatever was under the key.
 *
 * Everything here is defensive because none of it is ours by the time it comes
 * back: another tab's half-written value, a key someone else chose the same
 * name for, a shape from a version of this that did something else. A subtitle
 * preference is not worth a blank player, so anything unrecognisable reads as
 * "nothing remembered".
 */
export function parseStore(raw: string | null): Store {
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const out: Store = {}
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const entry = value as { choice?: unknown; at?: unknown } | null
    const choice = entry?.choice as SubtitleChoice | undefined
    const at = typeof entry?.at === 'number' && Number.isFinite(entry.at) ? entry.at : 0
    if (choice?.kind === 'off') out[key] = { choice: { kind: 'off' }, at }
    else if (
      choice?.kind === 'language' &&
      typeof choice.language === 'string' &&
      choice.language.trim()
    ) {
      out[key] = { choice: { kind: 'language', language: choice.language }, at }
    }
  }
  return out
}

/**
 * The oldest entries, dropped once there are too many.
 *
 * Its own function because the eviction is the part with an off-by-one in it,
 * and the part that only shows up on the hundred-and-first show.
 */
export function evict(store: Store, limit = MEMORY_LIMIT): Store {
  const entries = Object.entries(store)
  if (entries.length <= limit) return store
  entries.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(entries.slice(0, limit))
}

/** The store as it should be after recording this choice. */
export function withChoice(
  store: Store,
  key: string | null,
  choice: SubtitleChoice | null,
  now = Date.now(),
): Store {
  // A null choice is "nothing worth remembering about this track", which must
  // leave an earlier answer standing rather than erase it.
  if (!key || !choice) return store
  return evict({ ...store, [key]: { choice, at: now } })
}

/** What was remembered for this show, if anything usable was. */
export function choiceIn(store: Store, key: string | null): SubtitleChoice | null {
  return (key && store[key]?.choice) || null
}

// ------------------------------------------------------------ storage edges

function read(): Store {
  try {
    return parseStore(localStorage.getItem(KEY))
  } catch {
    // Touching localStorage at all throws in some private-browsing modes.
    return {}
  }
}

export function rememberSubtitleChoice(key: string | null, choice: SubtitleChoice | null): void {
  if (!key || !choice) return
  try {
    localStorage.setItem(KEY, JSON.stringify(withChoice(read(), key, choice)))
  } catch {
    /* storage full or blocked; the choice simply is not carried over */
  }
}

export function recallSubtitleChoice(key: string | null): SubtitleChoice | null {
  return choiceIn(read(), key)
}
