import type { SubtitleTrack } from './playback'

/**
 * Choosing a subtitle track without being asked every time.
 *
 * Apollo had one switch — "turn subtitles on by default" — which picked
 * whichever track the file had marked as its default, or failing that the
 * first one. For a library where most files carry two or three languages that
 * is a coin toss, and the answer is usually wrong: the point of turning
 * subtitles on is wanting to read a particular language.
 *
 * So the preference is a language, and the switch stays for anyone who wants
 * the file's own choice.
 */

/**
 * Codes that name the same language.
 *
 * Three naming schemes collide here. Jellyfin reports ISO 639-2, files tagged
 * by other tools carry the two-letter 639-1, and 639-2 itself has two codes for
 * twenty-odd languages — a "bibliographic" one from the English name and a
 * "terminological" one from the language's own, so German is both `ger` and
 * `deu` depending on who wrote the tag.
 *
 * A prefix rule handles none of this: `ja` is `jpn` and `de` is `deu`, which
 * share nothing, while `eng` and `enm` share a prefix and are English and
 * Middle English. So the equivalences are listed.
 *
 * Not exhaustive, and does not need to be — anything absent still matches
 * itself exactly, which is the common case where both codes came from the same
 * server.
 */
const LANGUAGE_ALIASES: readonly (readonly string[])[] = [
  ['en', 'eng'],
  ['ja', 'jpn'],
  ['de', 'deu', 'ger'],
  ['fr', 'fra', 'fre'],
  ['es', 'spa'],
  ['it', 'ita'],
  ['pt', 'por'],
  ['ru', 'rus'],
  ['zh', 'zho', 'chi'],
  ['ko', 'kor'],
  ['ar', 'ara'],
  ['nl', 'nld', 'dut'],
  ['sv', 'swe'],
  ['no', 'nor'],
  ['da', 'dan'],
  ['fi', 'fin'],
  ['pl', 'pol'],
  ['tr', 'tur'],
  ['cs', 'ces', 'cze'],
  ['el', 'ell', 'gre'],
  ['he', 'heb'],
  ['hi', 'hin'],
  ['th', 'tha'],
  ['vi', 'vie'],
  ['uk', 'ukr'],
  ['hu', 'hun'],
  ['ro', 'ron', 'rum'],
  ['is', 'isl', 'ice'],
  ['fa', 'fas', 'per'],
]

const CANONICAL = new Map<string, string>()
for (const group of LANGUAGE_ALIASES) {
  for (const code of group) CANONICAL.set(code, group[0])
}

/** One name for a language, so two spellings of it can be compared. */
export function canonicalLanguage(code: string | null | undefined): string {
  const raw = (code ?? '').trim().toLowerCase()
  if (!raw) return ''
  /*
    `pt-BR` and `zh-Hans` are a language and a region or script. The region is
    real information and this deliberately drops it: someone who asked for
    Portuguese should be given Brazilian Portuguese rather than nothing.
  */
  const base = raw.split(/[-_]/)[0]
  return CANONICAL.get(base) ?? base
}

/** Whether two codes name the same language. */
export function languagesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = canonicalLanguage(a)
  const y = canonicalLanguage(b)
  return Boolean(x) && x === y
}

/** A track Apollo can put on screen without asking the server to re-encode. */
function playable(track: SubtitleTrack): boolean {
  // `pgsUrl` matters here: the auto-selection used to test `url` alone, so a
  // file whose only English subtitles were PGS got none at all — silently,
  // since there was another track to fall back to.
  return Boolean(track.url || track.pgsUrl)
}

/**
 * How much this track wants to be chosen, for a viewer who asked for this
 * language. Higher wins; ties keep the file's own order.
 *
 * A forced track carries only the lines a viewer of the *original* language
 * still needs — signs, and dialogue in a third language. Someone who asked for
 * English subtitles wants the full dialogue, so a full track beats a forced
 * one; a forced one is still better than nothing when it is all there is.
 */
function score(track: SubtitleTrack): number {
  let value = 0
  if (!track.isForced) value += 2
  if (track.isDefault) value += 1
  return value
}

/**
 * The subtitle track to start with, or null for none.
 *
 * The language preference implies wanting subtitles: having to set a language
 * *and* turn a switch on to get them would be two ways of saying one thing,
 * and forgetting either would look like the feature not working.
 */
export function pickSubtitleTrack({
  subtitles,
  preferredLanguage,
  onByDefault,
}: {
  subtitles: readonly SubtitleTrack[] | undefined
  /** ISO code, or empty for "no preference". */
  preferredLanguage: string
  /** The older switch: use whatever the file calls its default. */
  onByDefault: boolean
}): number | null {
  const usable = (subtitles ?? []).filter(playable)
  if (usable.length === 0) return null

  const wanted = preferredLanguage.trim()
  if (wanted) {
    const matching = usable.filter((s) => languagesMatch(s.language, wanted))
    if (matching.length > 0) {
      let best = matching[0]
      for (const track of matching) if (score(track) > score(best)) best = track
      return best.index
    }
    /*
      Asked for a language this file does not have. Falling through to the
      switch rather than picking something else: a viewer who asked for English
      and is shown Japanese has been given a worse answer than none, and the
      menu is right there.
    */
  }

  if (!onByDefault) return null
  return (usable.find((s) => s.isDefault) ?? usable[0]).index
}
