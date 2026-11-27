import { ChevronLeft, ChevronRight } from './icons'

interface Props {
  side: 'left' | 'right'
  /** Named for a screen reader: "Scroll Next Up right". */
  label: string
  onClick: () => void
  /** Height, where a shelf's own padding means it is not the full box. */
  className?: string
}

/**
 * One edge arrow on a shelf that scrolls sideways.
 *
 * Only drawn when the shelf can actually move that way, so asking first is
 * the caller's job. Hidden on small screens, where a finger does this better
 * than a 48px target laid over the artwork, and faded in on hover of the
 * shelf — the `group/row` its parent declares.
 */
export function CarouselArrow({ side, label, onClick, className = 'h-full' }: Props) {
  const Chevron = side === 'left' ? ChevronLeft : ChevronRight
  const edge =
    side === 'left'
      ? 'left-0 bg-linear-to-r from-black/85 to-transparent'
      : 'right-0 bg-linear-to-l from-black/85 to-transparent'
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={`absolute top-0 z-20 hidden w-12 items-center justify-center text-white opacity-0 transition-opacity duration-200 group-hover/row:opacity-100 hover:from-black sm:flex ${edge} ${className}`}
    >
      <Chevron className="size-8" />
    </button>
  )
}
