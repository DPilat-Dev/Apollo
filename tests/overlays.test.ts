import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * Two rules about things that cover the page, each of which no single file can
 * be wrong about on its own — the shape `authGate`, `effects` and
 * `filterSurfaces` already deal with, checked by reading source in a suite that
 * mounts nothing.
 *
 * Both were broken in the same way: a behaviour that one overlay had and the
 * others did not, where every individual file looked finished.
 */
const SRC = path.resolve(import.meta.dirname, '../src')

/** Block and line comments removed, so prose about a rule is not read as code. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

const code = (file: string) => withoutComments(readFileSync(path.join(SRC, file), 'utf8'))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') ? [full] : []
  })
}

/** Everything that puts an `aria-modal` overlay on screen, found rather than listed. */
const DIALOGS = sourceFiles(SRC)
  .filter((file) => /dialogProps/.test(withoutComments(readFileSync(file, 'utf8'))))
  .map((file) => path.relative(SRC, file))
  .filter((file) => file !== 'lib/useDialog.ts')

/*
  The phone Filters sheet is the measured case: at 390×844, a drag on the dim
  backdrop scrolled the grid behind it from 0 to 500px while the sheet stayed
  put. `body` computed to `overflow: hidden auto` — the x-axis locked by
  `index.css`, the y-axis never locked by anyone. A swipe on the dim area
  scrolling the list underneath is the one thing a modal must not allow.

  It was reported against `Modal`, and it does not belong there: `Modal` is six
  of the ten dialogs in this app, and the other four build the same overlay
  around `useDialog` themselves. The hook is the one thing all ten share, so
  that is where the lock is — and the list below is what keeps a future
  eleventh from being a dialog that nothing locks.
*/
describe('every dialog', () => {
  const source = code('lib/useDialog.ts')

  it('is one of useDialog\'s callers, and a new one has to opt in here', () => {
    expect(DIALOGS.sort()).toEqual([
      'components/AddToCollection.tsx',
      'components/AddToPlaylist.tsx',
      'components/Modal.tsx',
      'components/ShortcutsModal.tsx',
      'components/TrailerModal.tsx',
    ])
  })

  it('locks the page behind it, on both axes', () => {
    expect(source).toMatch(/overflow = 'hidden'/)
  })

  it('counts the dialogs over the page rather than assuming it is the only one', () => {
    // Two can be open at once in the admin panels, and either can close first.
    expect(source).toMatch(/acquireScrollLock\(/)
    expect(source).toMatch(/releaseScrollLock\(/)
  })

  it('gives back the width the vanished scrollbar was occupying', () => {
    // Otherwise the whole page jumps ~15px sideways as a dialog opens on any
    // desktop with a classic scrollbar.
    expect(source).toMatch(/scrollbarGap\(/)
  })

  it('does not lock the page a second time in any one caller', () => {
    // Nested dialogs are counted, but a caller locking on its own account
    // would be a count the hook does not know about.
    for (const file of DIALOGS) expect(code(file)).not.toMatch(/ScrollLock\(/)
  })
})

/*
  Escape closed the item ⋮ menu and the Filters sheet, and did nothing at all to
  the header's account menu or the phone nav drawer: both could only be
  dismissed by clicking elsewhere, which a keyboard cannot do. The account
  button also said nothing about what it opens.

  The fix is one hook, so there is one dismissal behaviour rather than three
  copies — the ⋮ menu's own listeners were the third copy.
*/
describe('the popups that hang off a trigger', () => {
  const POPUPS = ['components/TopNav.tsx', 'components/admin/ItemActionsMenu.tsx']

  for (const file of POPUPS) {
    it(`${file} dismisses through the shared hook, not listeners of its own`, () => {
      const source = code(file)
      expect(source).toMatch(/usePopupDismiss\(/)
      expect(source).not.toMatch(/addEventListener\('keydown'/)
      expect(source).not.toMatch(/addEventListener\('pointerdown'/)
    })
  }

  it('returns the focus to the trigger rather than dropping it on the page', () => {
    const hook = code('lib/usePopupDismiss.ts')
    expect(hook).toMatch(/isDismissKey\(/)
    expect(hook).toMatch(/FOCUSABLE_SELECTOR/)
    expect(hook).toMatch(/\.focus\(\)/)
  })

  it('says what the header triggers open and what the popups are', () => {
    // Both of them, which is what the ⋮ menu already had and neither of these
    // did: a button that gives no sign it opens anything, and a popup a screen
    // reader reads as a stack of links in a div.
    const nav = code('components/TopNav.tsx')
    expect(nav.match(/aria-haspopup="menu"/g)).toHaveLength(2)
    expect(nav.match(/aria-expanded=/g)).toHaveLength(2)
    expect(nav.match(/role="menu"/g)).toHaveLength(2)
  })
})
