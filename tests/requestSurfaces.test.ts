import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Rules about how requesting has to hang together, which no one file can be
 * right about on its own.
 *
 * The season dialog was added *beside* the one-press request, not in place of
 * it — that was the whole point of the design. Two ways to send the same
 * request is also exactly the shape that drifts: a season list that reads the
 * per-season status while the card ignores it, a dialog that forgets to narrow
 * the payload, a second `outline-none` creeping back into a new file. None of
 * those break a unit test, and all of them are visible in the source.
 *
 * Same approach as `filterSurfaces` and `authGate`: a rule enforced by reading
 * the files, in a suite that mounts nothing.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), 'utf8'))

const CARD = 'components/RequestResults.tsx'
const DIALOG = 'components/RequestDialog.tsx'

describe('the one-press request', () => {
  /*
    The fast path is the one people use. If the info control ever becomes the
    only way to request something, this is the test that says so.
  */
  it('still sends the request itself rather than opening the dialog', () => {
    const source = code(CARD)
    expect(source).toMatch(/request\.mutate\(/)
  })

  it('keeps the dialog on a separate control from the request button', () => {
    const source = code(CARD)
    // The Request button submits; the info button opens. One `onClick` each,
    // and neither does the other's job.
    expect(source).toMatch(/onClick=\{submit\}/)
    expect(source).toMatch(/onClick=\{\(\) => setOpen\(true\)\}/)
    expect(source).not.toMatch(/onClick=\{\(\) => \{\s*setOpen\(true\)[\s\S]*submit/)
  })

  /*
    The card has no season list, so it has only the Settings default to go on.
    That is fine — and it must keep sending *something* for a series, because
    Jellyseerr rejects a TV request with no seasons.
  */
  it('still names seasons when it requests a series', () => {
    expect(code(CARD)).toMatch(/seasons:/)
  })
})

describe('the season dialog', () => {
  const source = code(DIALOG)

  /*
    The dialog's job is to send the boxes that are ticked. Falling back to the
    Settings default here would quietly ignore the choice somebody just made.
  */
  it('sends the seasons that were picked', () => {
    expect(source).toMatch(/seasons: selected/)
  })

  /*
    `mediaInfo.seasons` is the only place a per-season status lives. A dialog
    that does not read it offers seasons that are already in the library.
  */
  it('reads the per-season status before offering a season', () => {
    expect(source).toMatch(/mediaInfo\?\.seasons/)
    expect(source).toMatch(/seasonStatusOf\(/)
  })

  /*
    Every decision about seasons is in `requestSeasons`, which is tested
    without a DOM. A comparison against Jellyseerr's status enum written
    inline here would be a decision this suite cannot see.
  */
  it('decides nothing about seasons for itself', () => {
    expect(source).not.toMatch(/MediaStatus\./)
  })

  /*
    A film request with a `seasons` key is rejected by Jellyseerr, so the key
    has to be conditional rather than always present.
  */
  it('leaves seasons off a film', () => {
    expect(source).toMatch(/isTv \? \{ seasons: selected \} : \{\}/)
  })
})

describe('both ways in', () => {
  /*
    `outline-none` on a shared class is what took the focus ring off the whole
    filter bar, in a layer where no amount of specificity could win it back.
    These two files are new, so they start clean and this keeps them that way.
  */
  it('do not take the focus ring off anything', () => {
    expect(code(CARD)).not.toMatch(/outline-none/)
    expect(code(DIALOG)).not.toMatch(/outline-none/)
  })

  /*
    The request goes to Jellyseerr as the person signed in, which is worth
    saying once on the shelf and not worth repeating on every card.
  */
  it('say the request is filed as you', () => {
    expect(code(CARD)).toMatch(/as you/)
  })
})
