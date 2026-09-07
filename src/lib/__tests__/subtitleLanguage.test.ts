import { describe, expect, it } from 'vitest'
import type { SubtitleTrack } from '../playback'
import { canonicalLanguage, languagesMatch, pickSubtitleTrack } from '../subtitleLanguage'

const track = (over: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  index: 1,
  label: 'Track',
  isDefault: false,
  isForced: false,
  url: 'https://server/sub.vtt',
  ...over,
})

describe('languagesMatch', () => {
  it('matches a code with itself', () => {
    expect(languagesMatch('eng', 'eng')).toBe(true)
    expect(languagesMatch('ENG', ' eng ')).toBe(true)
  })

  it('matches the two-letter and three-letter names for one language', () => {
    // Jellyfin reports ISO 639-2; files tagged elsewhere carry 639-1, and a
    // preference set from one list has to match a track named from the other.
    expect(languagesMatch('en', 'eng')).toBe(true)
    expect(languagesMatch('jpn', 'ja')).toBe(true)
  })

  it('does not treat three-letter codes as prefixes of each other', () => {
    // `enm` is Middle English. A prefix match in general would claim it.
    expect(languagesMatch('eng', 'enm')).toBe(false)
    expect(languagesMatch('spa', 'srp')).toBe(false)
  })

  it('matches nothing against nothing', () => {
    expect(languagesMatch('', 'eng')).toBe(false)
    expect(languagesMatch(null, null)).toBe(false)
    expect(languagesMatch('eng', undefined)).toBe(false)
  })
})

describe('pickSubtitleTrack', () => {
  const pick = (subtitles: SubtitleTrack[], preferredLanguage = '', onByDefault = false) =>
    pickSubtitleTrack({ subtitles, preferredLanguage, onByDefault })

  it('chooses the language that was asked for', () => {
    const subs = [track({ index: 1, language: 'jpn' }), track({ index: 2, language: 'eng' })]
    expect(pick(subs, 'eng')).toBe(2)
  })

  it('turns subtitles on because a language was asked for', () => {
    // Needing a language *and* a switch would be two ways of saying one thing,
    // and forgetting either would look like the feature not working.
    expect(pick([track({ index: 3, language: 'eng' })], 'eng', false)).toBe(3)
  })

  it('prefers the full track over a forced one', () => {
    // Forced carries only signs and third-language dialogue. Somebody who
    // asked for English wants the dialogue.
    const subs = [
      track({ index: 1, language: 'eng', isForced: true, isDefault: true }),
      track({ index: 2, language: 'eng' }),
    ]
    expect(pick(subs, 'eng')).toBe(2)
  })

  it('takes a forced track when it is the only one in that language', () => {
    expect(pick([track({ index: 5, language: 'eng', isForced: true })], 'eng')).toBe(5)
  })

  it('breaks a tie with the file’s own default', () => {
    const subs = [
      track({ index: 1, language: 'eng' }),
      track({ index: 2, language: 'eng', isDefault: true }),
    ]
    expect(pick(subs, 'eng')).toBe(2)
  })

  it('shows nothing rather than the wrong language', () => {
    // Asked for English, offered Japanese: worse than none, and the menu is
    // right there.
    expect(pick([track({ index: 1, language: 'jpn' })], 'eng', false)).toBeNull()
  })

  it('still honours the old switch when the language is missing', () => {
    const subs = [track({ index: 1, language: 'jpn' }), track({ index: 2, language: 'fra', isDefault: true })]
    expect(pick(subs, 'eng', true)).toBe(2)
  })

  it('does nothing at all with no preference and the switch off', () => {
    expect(pick([track({ index: 1, language: 'eng' })], '', false)).toBeNull()
  })

  it('falls back to the file’s default with no preference', () => {
    const subs = [track({ index: 1, language: 'eng' }), track({ index: 2, language: 'jpn', isDefault: true })]
    expect(pick(subs, '', true)).toBe(2)
  })

  it('takes the first track when the file marks no default', () => {
    expect(pick([track({ index: 4, language: 'jpn' }), track({ index: 7 })], '', true)).toBe(4)
  })

  it('counts a PGS track as selectable', () => {
    // The old auto-selection tested `url` alone, so a file whose only English
    // subtitles were PGS got none — silently, when another track existed.
    const subs = [track({ index: 1, language: 'eng', url: undefined, pgsUrl: 'https://server/s.pgssub' })]
    expect(pick(subs, 'eng')).toBe(1)
  })

  it('ignores a track Apollo cannot draw', () => {
    // VOBSUB with no url and no pgsUrl still needs the server to burn it in,
    // which is not something to do to somebody unasked.
    const subs = [track({ index: 1, language: 'eng', url: undefined }), track({ index: 2, language: 'eng' })]
    expect(pick(subs, 'eng')).toBe(2)
    expect(pick([track({ index: 1, language: 'eng', url: undefined })], 'eng')).toBeNull()
  })

  it('has nothing to choose from an empty list', () => {
    expect(pick([], 'eng', true)).toBeNull()
    expect(pickSubtitleTrack({ subtitles: undefined, preferredLanguage: 'eng', onByDefault: true })).toBeNull()
  })

  it('treats a whitespace preference as no preference', () => {
    expect(pick([track({ index: 1, language: 'jpn' })], '   ', true)).toBe(1)
  })
})

describe('canonicalLanguage', () => {
  it('resolves the two ISO 639-2 codes some languages have', () => {
    // German is `ger` from the English name and `deu` from its own, depending
    // on who wrote the tag.
    expect(languagesMatch('ger', 'deu')).toBe(true)
    expect(languagesMatch('fre', 'fra')).toBe(true)
    expect(languagesMatch('chi', 'zho')).toBe(true)
    expect(languagesMatch('cze', 'ces')).toBe(true)
  })

  it('drops a region so a preference still matches a regional track', () => {
    // Somebody who asked for Portuguese should get Brazilian Portuguese
    // rather than nothing.
    expect(languagesMatch('pt', 'pt-BR')).toBe(true)
    expect(languagesMatch('zh-Hans', 'zho')).toBe(true)
    expect(canonicalLanguage('en_US')).toBe('en')
  })

  it('leaves a language it has never heard of matching only itself', () => {
    // The table is not exhaustive and does not need to be.
    expect(languagesMatch('epo', 'epo')).toBe(true)
    expect(languagesMatch('epo', 'eo')).toBe(false)
  })
})
