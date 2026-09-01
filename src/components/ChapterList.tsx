import { useEffect, useRef } from 'react'
import type { Chapter } from '../lib/chapters'
import { formatTimecode } from '../lib/format'
import type { trickplaySprite } from '../lib/trickplay'

/**
 * The chapter list: somewhere to see what a title is made of, and jump.
 *
 * Thumbnails come from the same trickplay sheets the scrubber previews with,
 * so a list of forty rows costs the two or three sprite JPEGs the browser has
 * already cached rather than forty requests. Where a server has never
 * generated them the rows fall back to a name and a timecode, which is still
 * the whole point of the list.
 */

/**
 * Trickplay frames are generated at whatever width the server chose — 320 is
 * the default — and drawn here scaled down rather than by asking for a smaller
 * variant, so the rows are one size whatever a given library holds.
 */
const THUMB_WIDTH = 96

export function ChapterList({
  chapters,
  activeIndex,
  preview,
  onSelect,
}: {
  chapters: Chapter[]
  /** Which row is playing, from `chapterIndexAt`, or -1 before the first. */
  activeIndex: number
  /** Returns the sprite covering a moment, when the server has thumbnails. */
  preview?: (seconds: number) => ReturnType<typeof trickplaySprite>
  onSelect: (seconds: number) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  /*
    Open on the chapter that is playing. A two-hour film carries forty of them
    and the one you want is almost never the first, so a list that opens at the
    top is a list you have to scroll before it tells you anything.

    Once only, on the mount that opening the menu causes: re-centring as
    playback crosses a boundary would drag the list out from under a viewer
    who had scrolled somewhere else on purpose.
  */
  useEffect(() => {
    const box = boxRef.current
    const row = activeRef.current
    if (!box || !row) return
    box.scrollTop = row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2
  }, [])

  return (
    /* `relative`, so a row's `offsetTop` is measured against this box and not
       whatever positioned ancestor the popover happens to sit in. */
    <div ref={boxRef} className="relative max-h-[min(18rem,45vh)] overflow-y-auto">
      {chapters.map((c, i) => {
        const active = i === activeIndex
        const sprite = preview?.(c.start) ?? null
        return (
          <button
            key={c.start}
            ref={active ? activeRef : undefined}
            onClick={() => onSelect(c.start)}
            aria-current={active ? 'true' : undefined}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition hover:bg-white/8 ${
              active ? 'text-white' : 'text-white/65'
            }`}
          >
            <span
              className={`size-1.5 shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`}
            />

            {sprite && (
              <span
                className="block shrink-0 overflow-hidden rounded bg-black"
                style={{
                  width: THUMB_WIDTH,
                  height: (sprite.height * THUMB_WIDTH) / sprite.width,
                }}
              >
                {/*
                  Scaled rather than resized: the sprite's offsets are in the
                  sheet's own pixels, and a `background-size` fitted to the row
                  would put the frame next door in the box.
                */}
                <span
                  className="block origin-top-left"
                  style={{
                    width: sprite.width,
                    height: sprite.height,
                    transform: `scale(${THUMB_WIDTH / sprite.width})`,
                    backgroundImage: `url("${sprite.url}")`,
                    backgroundSize: sprite.backgroundSize,
                    backgroundPosition: sprite.backgroundPosition,
                    backgroundRepeat: 'no-repeat',
                  }}
                />
              </span>
            )}

            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{c.name}</span>
              <span className="block text-[11px] tabular-nums text-white/40">
                {formatTimecode(c.start)}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
