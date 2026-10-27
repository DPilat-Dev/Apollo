import { useRef, useState, type KeyboardEvent } from 'react'
import {
  LETTERS,
  LETTER_RAIL_KEYS,
  letterLabel,
  letterRailLabel,
  nextLetterIndex,
  railTabStop,
  type RailTabStop,
} from '../lib/libraryFilters'

/**
 * The alphabet down the right edge of a library, for jumping to a letter the
 * way a finger finds the tab in a filing cabinet.
 *
 * ── Why every button stays enabled ────────────────────────────────────────
 *
 * No dimming, no hiding, no "this letter has nothing". There is no server
 * facility for which letters have content — nothing in the 10.11.8 OpenAPI
 * document indexes by prefix, and `QueryFilters` answers with Genres and Tags
 * only — so the only way to know would be 27 count probes, re-run every time
 * any *other* filter moved. That buys a rail whose buttons change state while
 * you adjust the year, which is a worse object than one that occasionally
 * returns nothing: a rail earns its keep by being in the same place with the
 * same 27 targets every time, and "nothing matches those filters" is already
 * on screen with a way out of it.
 *
 * ── Why it is desktop-only, and what "desktop" has to mean ───────────────
 *
 * On a phone, 27 targets in a 700px column is ~26px each — under a quarter of
 * the 44px minimum — stacked in the exact strip the thumb uses to scroll. The
 * picker in the filter bar is the control there, and a native full-height
 * scroll wheel beats a 26px target rather than consoling anyone for the loss
 * of one. (A drag-with-a-magnified-bubble rail is the pattern that does work
 * on touch; it is a different feature, not this one shrunk.)
 *
 * `hidden sm:flex` alone said that in terms of *width*, and shipped the rail
 * to every case the argument was about. An iPhone 15 in landscape is 848×389:
 * past `sm:`, so the rail rendered — 393px of it into a 389px viewport, with
 * `#` and `Z` off-screen and no scroll that could reach them, `#` to D under
 * the 64px nav where they could not be clicked, and buttons measuring 20×14px
 * on a touchscreen. So the condition is now what the argument was always
 * about: `touch:hidden` for the pointer, `short:hidden` for the height.
 *
 * The height gate is not only about phones. Cells scale with the viewport
 * because they cannot afford not to — 27 fixed 22px cells is 594px, which
 * overflows a 1366×768 laptop once the nav is counted — but the clamp has a
 * 0.85rem floor, so below ~591px of viewport the rail is a fixed ~393px
 * however short the window gets. At 200% zoom on that same laptop the CSS
 * viewport is 683×348: still past `sm:`, and clipped at both ends. 200% is the
 * magnification WCAG 1.4.4 asks for and low-vision viewers are exactly who
 * uses it, so the rail stands down there and the picker — which is the whole
 * feature on its own — carries it.
 */
export function LetterRail({
  value,
  onSelect,
}: {
  value: string
  /** The letter pressed, or `''` when the active one was pressed again. */
  onSelect: (letter: string) => void
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  /*
    One tab stop for all 27 — a roving tabindex. It is stored, along with the
    letter it was left under, and `railTabStop` is what decides from the two of
    them which button is the stop: stored alone, a letter cleared from the chip
    bar left it on a button that was no longer about anything.
  */
  const [moved, setMoved] = useState<RailTabStop | null>(null)
  const stop = railTabStop(moved, value)

  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    /*
      Ownership first, movement second. `nextLetterIndex` clamps, so "End with
      the focus already on Z" and "a key this rail does not own" are the same
      answer from it — and returning on that answer handed End back to the
      browser, which scrolled the page 2,436px out from under a `fixed` focus
      ring and started fetching pages of a library nobody had asked for.
    */
    if (!LETTER_RAIL_KEYS.has(event.key)) return
    event.preventDefault()
    const next = nextLetterIndex(from, event.key, LETTERS.length)
    if (next === from) return
    setMoved({ index: next, letter: value })
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Filter by first letter"
      className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-px pl-2 pr-[calc(0.5rem+env(safe-area-inset-right)+var(--dialog-scrollbar-gap,0px))] sm:flex touch:hidden short:hidden"
    >
      {LETTERS.map((letter, index) => (
        <button
          key={letter}
          type="button"
          ref={(el) => {
            buttons.current[index] = el
          }}
          tabIndex={index === stop ? 0 : -1}
          /*
            A toggle, not a location: `aria-pressed`, the same as the Subtitled
            button, rather than `aria-current` — the rail says what is being
            filtered to, not where in a list anybody is.
          */
          aria-pressed={value === letter}
          /*
            The name starts with the glyph the button shows, which is WCAG
            2.5.3: a button reading `#` and named "Numbers & symbols" cannot be
            reached by anyone speaking to their computer — "click hash" matches
            nothing in that name.
          */
          aria-label={letterRailLabel(letter)}
          title={letterLabel(letter)}
          onKeyDown={(e) => move(e, index)}
          onClick={() => {
            // Pressing the letter that is already on clears it: a pointer-only
            // way out that does not need the chip bar hunted for. Focus stays
            // here, because someone scanning presses M, reads the count, then
            // presses N — and moving focus into the grid breaks that loop. The
            // letter stored alongside is the one this press produces, so the
            // stop stays here rather than being read as cleared from outside.
            const next = value === letter ? '' : letter
            setMoved({ index, letter: next })
            onSelect(next)
          }}
          /*
            The idle letters are /70, not /55. `--color-white` is the
            foreground token and the light theme redefines it to #17171b, so at
            55% over that theme's #f4f4f6 page these 10.4px letters compute to
            3.87:1 — under the 4.5:1 text that size needs. /70 is 6.32:1 there
            and 9.71:1 in the dark theme, and still reads as de-emphasised
            beside the letter in force.
          */
          className={`flex h-[clamp(0.85rem,2.3vh,1.4rem)] w-5 items-center justify-center rounded text-[0.65rem] font-semibold leading-none transition ${
            value === letter
              ? 'border border-accent/60 bg-accent/15 text-white'
              : 'text-white/70 hover:bg-white/10 hover:text-white'
          }`}
        >
          {letter}
        </button>
      ))}
    </div>
  )
}
