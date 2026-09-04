/**
 * Cleaning up subtitles the server converted but did not finish converting.
 *
 * Jellyfin turns ASS/SSA into WebVTT for the `<track>` element, and leaves the
 * format's override tags in the text. They are instructions, not dialogue, so
 * the browser prints them — one file in a real library carried them on 112 of
 * its 1439 lines, and a viewer sees:
 *
 *   {\fad(1020,1)\blur1.2\bord2\fnTimes New Roman\pos(688,214)}Fifth Epoch
 *
 * Anime subtitles are typeset far more heavily than television ones, which is
 * why this shows up there first, but nothing here is anime-specific.
 */

/*
  Only a brace group whose first character is a backslash is an override block.
  ASS guarantees that, and dialogue does contain braces — "{laughs}" is a real
  subtitle line, and stripping every brace group would eat it.
*/
const OVERRIDE = /\{\\[^}]*\}/g

/** Drawing mode: the "text" between these is vector coordinates, not words. */
const DRAWING = /\{\\p[1-9]\d*\}[\s\S]*?(?:\{\\p0\}|$)/g

/** Inline style tags worth keeping, because WebVTT can express them. */
const TOGGLES: { open: RegExp; close: RegExp; tag: string }[] = [
  { open: /\{\\i1\}/g, close: /\{\\i0\}/g, tag: 'i' },
  { open: /\{\\b1\}/g, close: /\{\\b0\}/g, tag: 'b' },
  { open: /\{\\u1\}/g, close: /\{\\u0\}/g, tag: 'u' },
]

/**
 * One cue's text, with the typesetting taken out.
 *
 * Italics, bold and underline survive as the WebVTT tags that mean the same
 * thing — they carry meaning in dialogue, and dropping them silently loses the
 * difference between a thought and a line spoken aloud.
 */
export function cleanSubtitleText(text: string): string {
  if (!text || !text.includes('{')) return unescapeAss(text)

  let out = text
  // Drawings first: their coordinates would survive as text once the tags
  // around them were stripped.
  out = out.replace(DRAWING, '')

  for (const { open, close, tag } of TOGGLES) {
    out = out.replace(open, `<${tag}>`).replace(close, `</${tag}>`)
  }

  out = out.replace(OVERRIDE, '')
  return unescapeAss(out)
}

/*
  ASS's own escapes. `\N` is a hard line break, `\h` a non-breaking space, and
  `\n` a soft break that renderers usually treat as a space. They arrive as
  literal backslash-letter pairs, so a line reads "First line\NSecond line".
*/
function unescapeAss(text: string): string {
  return text
    .replace(/\\N/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/\\n/g, ' ')
}

/** Whether a cue would change — so nothing is written when nothing needs to be. */
export function needsCleaning(text: string): boolean {
  return cleanSubtitleText(text) !== text
}

/**
 * Clean every cue in a track, returning how many changed.
 *
 * Cues are mutated in place because a `TextTrack`'s list is the browser's, not
 * ours; there is no way to hand back a new one.
 */
export function cleanCues(cues: ArrayLike<unknown> | null | undefined): number {
  if (!cues) return 0
  let changed = 0
  for (let i = 0; i < cues.length; i++) {
    /*
      Narrowed rather than typed as VTTCue. `TextTrackCueList` is a list of
      `TextTrackCue`, which carries no `text` at all in the DOM types — the
      property belongs to `VTTCue`, and a track built from a WebVTT file holds
      those. Checking beats asserting: a cue kind without text is skipped
      instead of throwing.
    */
    const cue = cues[i]
    if (!isTextCue(cue)) continue
    const cleaned = cleanSubtitleText(cue.text)
    if (cleaned !== cue.text) {
      cue.text = cleaned
      changed++
    }
  }
  return changed
}

function isTextCue(cue: unknown): cue is { text: string } {
  return typeof cue === 'object' && cue !== null && typeof (cue as { text?: unknown }).text === 'string'
}
