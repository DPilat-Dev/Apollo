import { useRef, useState } from 'react'
import { formatTimecode } from '../lib/format'
import type { trickplaySprite } from '../lib/trickplay'

/**
 * The seek bar.
 *
 * Split out of the player because it carries the whole pointer story — hover
 * previews, drag-to-scrub, and a hit area sized for a thumb rather than a
 * cursor — and none of that is about playback.
 */
export function Scrubber({
  current,
  duration,
  buffered,
  onSeek,
  chapters,
  ranges,
  preview,
}: {
  current: number
  duration: number
  buffered: number
  onSeek: (seconds: number) => void
  /** Chapters, drawn as divisions and named in the hover preview. */
  chapters?: { start: number; name: string }[]
  /** Skip ranges, shaded so intros and credits are visible before you reach them. */
  ranges?: { start: number; end: number }[]
  /** Returns the sprite covering a moment, when the server has thumbnails. */
  preview?: (seconds: number) => ReturnType<typeof trickplaySprite>
}) {
  const [hoverX, setHoverX] = useState<number | null>(null)
  const [dragX, setDragX] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  /*
    Where a pointer is along the track. Measured against the drawn bar rather
    than the hit surface, which is taller than the bar and hangs over it on
    both sides so a thumb has something to land on.
  */
  const positionOf = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return null
    return Math.min(Math.max(clientX - rect.left, 0), rect.width)
  }

  const secondsAt = (x: number) => {
    const width = trackRef.current?.clientWidth ?? 0
    return width > 0 ? (x / width) * duration : 0
  }

  /*
    Dragging commits on release, not continuously.

    Every intermediate position on a transcoded stream is a fresh request to
    the server for a new segment, so seeking live would have Jellyfin start and
    abandon a transcode for each pixel crossed. The bar follows the thumb the
    whole way; only the video waits.
  */
  const beginDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const x = positionOf(e.clientX)
    if (x == null) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragX(x)
    setHoverX(x)
  }

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragX == null) return
    const x = positionOf(e.clientX) ?? dragX
    setDragX(null)
    // A mouse still hovers after letting go; a finger does not.
    if (e.pointerType !== 'mouse') setHoverX(null)
    if (duration > 0) onSeek(secondsAt(x))
  }

  const dragging = dragX != null
  const shown = dragging ? secondsAt(dragX) : current

  const pct = duration > 0 ? (shown / duration) * 100 : 0
  const bufferedPct = duration > 0 ? Math.min((buffered / duration) * 100, 100) : 0

  const hoverSeconds = hoverX != null && duration > 0 ? secondsAt(hoverX) : null

  return (
    <div ref={trackRef} className="group/track relative h-6 cursor-pointer">
      {/*
        The hit surface, taller than the bar it controls. Twenty-four pixels is
        a comfortable mouse target and a miserable thumb one; this reaches out
        eight more each way into the gradient above and the gap below, without
        changing what the bar occupies in the layout.
      */}
      <div
        className="absolute inset-x-0 -inset-y-2 z-10 touch-none sm:inset-y-0"
        onPointerDown={beginDrag}
        onPointerMove={(e) => {
          const x = positionOf(e.clientX)
          if (x == null) return
          setHoverX(x)
          if (dragging) setDragX(x)
        }}
        onPointerUp={endDrag}
        onPointerCancel={() => {
          setDragX(null)
          setHoverX(null)
        }}
        onPointerLeave={(e) => {
          if (!dragging && e.pointerType === 'mouse') setHoverX(null)
        }}
      />

      <div
        className={`pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/track:h-1.5 ${
          dragging ? 'h-1.5' : 'h-1'
        }`}
      >
        <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${bufferedPct}%` }} />

        {/* Skip ranges, so an intro or the credits are visible before you
            reach them and scrubbing past them is deliberate. */}
        {duration > 0 &&
          ranges?.map((r) => (
            <div
              key={`${r.start}-${r.end}`}
              className="absolute inset-y-0 bg-white/25"
              style={{
                left: `${(r.start / duration) * 100}%`,
                width: `${((r.end - r.start) / duration) * 100}%`,
              }}
            />
          ))}

        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />

        {/* Chapter divisions. The first is always at zero, where a tick would
            only be a mark against the left edge. */}
        {duration > 0 &&
          chapters
            ?.filter((c) => c.start > 1 && c.start < duration)
            .map((c) => (
              <div
                key={c.start}
                className="absolute inset-y-0 w-px bg-black/55"
                style={{ left: `${(c.start / duration) * 100}%` }}
              />
            ))}
      </div>

      {/*
        The handle. Bigger while dragging, and visible the whole time on a
        touchscreen — there is no hover to reveal it with, and a bar with no
        handle gives no clue it can be dragged at all.
      */}
      <div
        className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent transition-[opacity,width,height] group-hover/track:size-3.5 group-hover/track:opacity-100 [@media(pointer:coarse)]:opacity-100 ${
          dragging ? 'size-4 opacity-100' : 'size-3.5 opacity-0'
        }`}
        style={{ left: `${pct}%` }}
      />

      {hoverSeconds != null && Number.isFinite(hoverSeconds) && (
        <ScrubPreview
          seconds={hoverSeconds}
          x={hoverX ?? 0}
          trackWidth={trackRef.current?.clientWidth ?? 0}
          preview={preview}
          chapterName={chapterAt(chapters, hoverSeconds)}
        />
      )}
    </div>
  )
}

/**
 * The tooltip that follows the cursor along the scrubber: a trickplay frame
 * where one exists, and the timecode either way.
 *
 * Clamped to the track so a preview near either end doesn't hang off-screen.
 */
/** The chapter covering an instant: the last one to have started. */
export function chapterAt(
  chapters: { start: number; name: string }[] | undefined,
  seconds: number,
): string | null {
  if (!chapters?.length) return null
  let found: string | null = null
  for (const c of chapters) {
    if (c.start <= seconds) found = c.name
    else break
  }
  return found
}

function ScrubPreview({
  seconds,
  x,
  trackWidth,
  preview,
  chapterName,
}: {
  seconds: number
  x: number
  trackWidth: number
  preview?: (seconds: number) => ReturnType<typeof trickplaySprite>
  chapterName?: string | null
}) {
  const sprite = preview?.(seconds) ?? null
  const boxWidth = sprite?.width ?? 0
  const half = boxWidth / 2
  const left = boxWidth > 0 && trackWidth > 0 ? Math.min(Math.max(x, half), trackWidth - half) : x

  return (
    <div
      className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2"
      style={{ left: `${left}px` }}
    >
      {sprite && (
        <div
          className="mb-1 overflow-hidden rounded border border-white/20 bg-black shadow-2xl"
          style={{
            width: sprite.width,
            height: sprite.height,
            backgroundImage: `url("${sprite.url}")`,
            backgroundSize: sprite.backgroundSize,
            backgroundPosition: sprite.backgroundPosition,
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}
      <span className="mx-auto block w-fit max-w-56 truncate rounded bg-black/90 px-1.5 py-0.5 text-center text-[11px] text-white">
        {chapterName && <span className="mr-1.5 text-white/70">{chapterName}</span>}
        <span className="tabular-nums">{formatTimecode(seconds)}</span>
      </span>
    </div>
  )
}
