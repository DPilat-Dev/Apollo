/**
 * The "still watching?" nudge, shown for the last half-minute of a sleep timer.
 *
 * Deliberately not a dialogue: someone who is still awake should be able to
 * ignore it and keep watching without the video being covered or paused, and
 * someone who has dozed off should not be woken by a modal. Ignoring it is a
 * valid answer — the timer fires anyway.
 *
 * It sits bottom-left because Up Next and the skip button own the other
 * corner, and an end-of-episode timer's grace window overlaps both of them.
 */
export function SleepPrompt({
  secondsLeft,
  onExtend,
}: {
  secondsLeft: number
  onExtend: () => void
}) {
  const countdown = Math.max(0, Math.ceil(secondsLeft))

  return (
    <div className="pointer-events-auto absolute bottom-28 left-4 z-30 flex items-center gap-4 rounded-lg border border-white/15 bg-black/85 py-2.5 pl-3.5 pr-2.5 shadow-2xl backdrop-blur sm:bottom-32 sm:left-8">
      <div className="min-w-0">
        <p className="text-sm font-semibold">Still watching?</p>
        <p className="text-xs tabular-nums text-white/55">Sleep timer pauses in {countdown}s</p>
      </div>
      <button
        onClick={onExtend}
        className="shrink-0 rounded border border-white/25 px-3 py-1.5 text-xs font-semibold text-white/85 transition hover:border-white/60 hover:text-white"
      >
        Keep watching
      </button>
    </div>
  )
}
