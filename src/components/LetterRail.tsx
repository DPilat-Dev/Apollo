import { useRef, useState, type KeyboardEvent } from 'react'
import { LETTERS, letterLabel, nextLetterIndex } from '../lib/libraryFilters'

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
 * ── Why it is desktop-only ────────────────────────────────────────────────
 *
 * `hidden sm:flex`. On a phone, 27 targets in a 700px column is ~26px each —
 * under a quarter of the 44px minimum — stacked in the exact strip the thumb
 * uses to scroll. The picker in the filter bar is the control there, and a
 * native full-height scroll wheel beats a 26px target rather than consoling
 * anyone for the loss of one. (A drag-with-a-magnified-bubble rail is the
 * pattern that does work on touch; it is a different feature, not this one
 * shrunk.)
 *
 * Cells scale with the viewport height because they cannot afford not to:
 * 27 fixed 22px cells is 594px, which overflows a 1366×768 laptop once the nav
 * is counted, and a rail with its own scrollbar is not a rail.
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
  const [moved, setMoved] = useState(-1)

  /*
    One tab stop for all 27 — a roving tabindex. Where it sits is wherever the
    arrow keys last left it, and before that the letter currently in force, so
    tabbing in lands on the part of the alphabet the grid is already showing
    rather than back at `#`. Derived rather than stored, so a letter cleared
    from the chip bar cannot leave the tab stop pointing at a stale button.
  */
  const stop = moved >= 0 ? moved : Math.max(LETTERS.indexOf(value), 0)

  const move = (event: KeyboardEvent<HTMLButtonElement>, from: number) => {
    const next = nextLetterIndex(from, event.key, LETTERS.length)
    if (next === from) return
    // Up/Down and Home/End would otherwise scroll the page out from under the
    // focus ring they are moving.
    event.preventDefault()
    setMoved(next)
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="toolbar"
      aria-orientation="vertical"
      aria-label="Filter by first letter"
      className="fixed right-0 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-px pl-2 pr-[calc(0.5rem+env(safe-area-inset-right))] sm:flex"
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
          aria-label={letterLabel(letter)}
          title={letterLabel(letter)}
          onKeyDown={(e) => move(e, index)}
          onClick={() => {
            setMoved(index)
            // Pressing the letter that is already on clears it: a pointer-only
            // way out that does not need the chip bar hunted for. Focus stays
            // here, because someone scanning presses M, reads the count, then
            // presses N — and moving focus into the grid breaks that loop.
            onSelect(value === letter ? '' : letter)
          }}
          className={`flex h-[clamp(0.85rem,2.3vh,1.4rem)] w-5 items-center justify-center rounded text-[0.65rem] font-semibold leading-none transition ${
            value === letter
              ? 'border border-accent/60 bg-accent/15 text-white'
              : 'text-white/55 hover:bg-white/10 hover:text-white'
          }`}
        >
          {letter}
        </button>
      ))}
    </div>
  )
}
