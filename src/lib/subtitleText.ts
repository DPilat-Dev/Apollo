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


/**
 * Where a cue belongs on screen, from ASS's own alignment tag.
 *
 * `\anN` uses the numeric keypad: 7 8 9 across the top, 4 5 6 through the
 * middle, 1 2 3 along the bottom. It is the one placement tag that means the
 * same thing at any resolution, which is why it is honoured here and `\pos`
 * is not — `\pos` is in the script's own coordinates, and the files in one
 * library alone declare anything from 1280x720 to 3840x2160. The WebVTT the
 * server hands over has dropped the header that says which, so a percentage
 * derived from it would be a guess that is wrong more often than not.
 *
 * This matters for reading rather than for looks: a sign translation typeset
 * at the top lands on top of the dialogue if it is dropped to the bottom with
 * everything else.
 */
export interface CuePlacement {
  align: 'start' | 'center' | 'end'
  /** Percentage down the frame, or null to leave the cue where it would sit. */
  linePercent: number | null
}

/** Far enough in that a cue is not touching the edge of the frame. */
const TOP_LINE = 10
const MIDDLE_LINE = 45

export function cuePlacement(text: string): CuePlacement | null {
  // The last one wins, as it does in a renderer: a later override replaces it.
  const matches = [...text.matchAll(/\\an([1-9])/g)]
  const an = matches.length ? Number(matches[matches.length - 1][1]) : null
  if (an == null) return null

  const column = (an - 1) % 3
  const row = Math.floor((an - 1) / 3)
  return {
    align: column === 0 ? 'start' : column === 1 ? 'center' : 'end',
    // Row 0 is the bottom, which is where a cue already goes.
    linePercent: row === 0 ? null : row === 1 ? MIDDLE_LINE : TOP_LINE,
  }
}

/**
 * Apply placement to the cues of a track, returning how many moved.
 *
 * `snapToLines` has to go off for `line` to mean a percentage; left on, the
 * number is counted in lines of text from the top and a value of 10 puts the
 * cue somewhere entirely different.
 */
export function placeCues(cues: ArrayLike<unknown> | null | undefined): number {
  if (!cues) return 0
  let moved = 0
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i]
    if (!isPlaceableCue(cue)) continue
    const placement = cuePlacement(cue.text)
    if (!placement) continue
    cue.align = placement.align
    if (placement.linePercent != null) {
      cue.snapToLines = false
      cue.line = placement.linePercent
    }
    moved++
  }
  return moved
}

function isPlaceableCue(
  cue: unknown,
): cue is { text: string; align: string; line: number | 'auto'; snapToLines: boolean } {
  return (
    typeof cue === 'object' &&
    cue !== null &&
    typeof (cue as { text?: unknown }).text === 'string' &&
    'align' in cue &&
    'line' in cue
  )
}
