import { describe, expect, it } from 'vitest'
import type { SubtitleTrack } from '../playback'
import {
  MEMORY_LIMIT,
  choiceFor,
  choiceIn,
  evict,
  parseStore,
  subtitleMemoryKey,
  withChoice,
  type Store,
} from '../subtitleMemory'
import { keysToPurgeOnSwitch } from '../accounts'

const track = (over: Partial<SubtitleTrack> = {}): SubtitleTrack =>
  ({ index: 3, label: 'English', language: 'eng', url: '/x.vtt', ...over }) as SubtitleTrack

describe('which show a choice belongs to', () => {
  it('keys an episode on its series, so the next one inherits', () => {
    // Choosing subtitles is something people do for a show. Keyed per episode
    // the memory would be right about the one already watched and useless
    // about the one about to start.
    expect(subtitleMemoryKey({ Id: 'ep-2', SeriesId: 'show-1' })).toBe('show-1')
  })

  it('keys a film on itself', () => {
    expect(subtitleMemoryKey({ Id: 'film-1' })).toBe('film-1')
  })

  it('has nothing to say about nothing', () => {
    expect(subtitleMemoryKey(null)).toBeNull()
    expect(subtitleMemoryKey(undefined)).toBeNull()
    expect(subtitleMemoryKey({})).toBeNull()
  })
})

describe('what gets remembered about a track', () => {
  it('remembers the language, not the index', () => {
    /*
      Stream indexes are positions inside one container: track 3 is English on
      tonight's episode and Castilian Spanish on next week's. The language is
      the part that survives the file changing underneath it.
    */
    expect(choiceFor(track({ index: 3, language: 'eng' }))).toEqual({
      kind: 'language',
      language: 'eng',
    })
  })

  it('treats no track as a choice of its own', () => {
    // Not the same as never having chosen: someone who turned subtitles off
    // meant it, and putting them back every episode is the same bug mirrored.
    expect(choiceFor(null)).toEqual({ kind: 'off' })
  })

  it('declines to remember a track with no language to match on later', () => {
    // It would match nothing on the next file, and storing it would bury the
    // real choice underneath so it never got made again.
    expect(choiceFor(track({ language: undefined }))).toBeNull()
    expect(choiceFor(track({ language: '  ' }))).toBeNull()
  })
})

describe('the store', () => {
  const empty: Store = {}

  it('carries a choice back', () => {
    const store = withChoice(empty, 'show-1', { kind: 'language', language: 'eng' })
    expect(choiceIn(store, 'show-1')).toEqual({ kind: 'language', language: 'eng' })
  })

  it('carries off back too', () => {
    expect(choiceIn(withChoice(empty, 'show-1', { kind: 'off' }), 'show-1')).toEqual({
      kind: 'off',
    })
  })

  it('keeps shows apart', () => {
    let store = withChoice(empty, 'show-1', { kind: 'language', language: 'eng' })
    store = withChoice(store, 'show-2', { kind: 'off' })
    expect(choiceIn(store, 'show-1')).toEqual({ kind: 'language', language: 'eng' })
    expect(choiceIn(store, 'show-2')).toEqual({ kind: 'off' })
  })

  it('says nothing for a show never chosen for', () => {
    expect(choiceIn(empty, 'never-seen')).toBeNull()
    expect(choiceIn(empty, null)).toBeNull()
  })

  it('leaves an earlier answer standing when there is nothing to record', () => {
    // `choiceFor` returns null for a track with no language; that must not
    // erase the real choice underneath it.
    const store = withChoice(empty, 'show-1', { kind: 'language', language: 'eng' })
    expect(choiceIn(withChoice(store, 'show-1', null), 'show-1')).toEqual({
      kind: 'language',
      language: 'eng',
    })
  })

  it('reads nothing out of junk', () => {
    for (const junk of ['not json at all', '[]', 'null', '"string"', '']) {
      expect(parseStore(junk)).toEqual({})
    }
    expect(parseStore(null)).toEqual({})
  })

  it('drops a stored shape it does not recognise', () => {
    const store = parseStore(
      JSON.stringify({
        ok: { choice: { kind: 'off' }, at: 1 },
        noLanguage: { choice: { kind: 'language' }, at: 1 },
        blankLanguage: { choice: { kind: 'language', language: '  ' }, at: 1 },
        nonsense: { choice: { kind: 'wat' }, at: 1 },
        missing: {},
      }),
    )
    expect(Object.keys(store)).toEqual(['ok'])
  })

  it('tolerates a missing timestamp rather than sorting on NaN', () => {
    // An entry with no `at` must still be evictable; NaN comparisons make a
    // sort silently incoherent rather than loudly wrong.
    expect(parseStore(JSON.stringify({ a: { choice: { kind: 'off' } } })).a.at).toBe(0)
  })

  it('round-trips through what it writes', () => {
    const store = withChoice(empty, 'show-1', { kind: 'language', language: 'jpn' })
    expect(choiceIn(parseStore(JSON.stringify(store)), 'show-1')).toEqual({
      kind: 'language',
      language: 'jpn',
    })
  })
})

describe('eviction', () => {
  it('leaves a store under the limit alone', () => {
    const store = Object.fromEntries(
      Array.from({ length: MEMORY_LIMIT }, (_, i) => [
        `s${i}`,
        { choice: { kind: 'off' as const }, at: i },
      ]),
    )
    expect(Object.keys(evict(store)).length).toBe(MEMORY_LIMIT)
  })

  it('drops the oldest once there is one too many', () => {
    const store = Object.fromEntries(
      Array.from({ length: MEMORY_LIMIT + 1 }, (_, i) => [
        `s${i}`,
        { choice: { kind: 'off' as const }, at: i },
      ]),
    )
    const kept = evict(store)
    expect(Object.keys(kept).length).toBe(MEMORY_LIMIT)
    // s0 is the oldest, so it is the one that goes.
    expect(kept.s0).toBeUndefined()
    expect(kept[`s${MEMORY_LIMIT}`]).toBeDefined()
  })
})

describe('leaving the device', () => {
  it('goes when the account does', () => {
    /*
      `keysToPurgeOnSwitch` is deny-by-default over the `apollo.` prefix, which
      is the only reason this module does not have to remember to clean up
      after itself. A key named outside that prefix would survive a sign-out
      and tell the next person what the last one watched with.
    */
    expect(keysToPurgeOnSwitch(['apollo.subtitleChoice'])).toEqual(['apollo.subtitleChoice'])
  })
})
