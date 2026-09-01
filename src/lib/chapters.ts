import type { ChapterInfo } from '@jellyfin/sdk/lib/generated-client/models'
import { ticksToSeconds } from './format'

/**
 * Chapters, tidied up before anything draws them.
 *
 * What a library actually holds is whatever the encoder left in the container,
 * and that is rarely the ordered, named list the API's shape suggests. Rips
 * carry unnamed markers, some tools write them out of order, a repeated start
 * turns into two entries for the same instant, and a chapter can sit past the
 * end of the runtime the server reports. None of that is worth a crash or a
 * dead menu row, so it is all flattened here — once — and everything else in
 * the player gets to assume an ordered list of real, reachable moments.
 */

export interface Chapter {
  /** Where it begins, in seconds. */
  start: number
  /** Always something to show: `Chapter N` where the file named nothing. */
  name: string
}

/**
 * The chapters worth offering, in playback order.
 *
 * `runtimeTicks` is optional because it is not always known yet — before the
 * item's metadata arrives, filtering against a runtime of zero would empty a
 * perfectly good list, so an absent or zero runtime means "keep them all".
 */
export function normalizeChapters(
  chapters: ChapterInfo[] | null | undefined,
  runtimeTicks?: number | null,
): Chapter[] {
  const runtime = runtimeTicks && runtimeTicks > 0 ? ticksToSeconds(runtimeTicks) : null

  const sorted = (chapters ?? [])
    .map((c) => ({
      // A negative start is nonsense but seekable once clamped, which is
      // kinder than dropping the opening chapter of a badly muxed file.
      start: Math.max(ticksToSeconds(c.StartPositionTicks ?? 0), 0),
      name: c.Name?.trim() ?? '',
    }))
    .filter((c) => runtime === null || c.start < runtime)
    .sort((a, b) => a.start - b.start)

  const seen = new Set<number>()
  const unique = sorted.filter((c) => {
    if (seen.has(c.start)) return false
    seen.add(c.start)
    return true
  })

  // Numbered after ordering and de-duplicating, so the placeholders count the
  // rows the viewer can actually see rather than the file's own indices.
  return unique.map((c, i) => ({ start: c.start, name: c.name || `Chapter ${i + 1}` }))
}

/**
 * Which chapter covers an instant: the last one to have started, or -1 before
 * the first one does.
 *
 * An index rather than the chapter itself, because two chapters may carry the
 * same name and the same start-to-the-second — marking the current row by name
 * lit every "Part 1" in a double episode at once.
 *
 * Assumes the ordering `normalizeChapters` guarantees.
 */
export function chapterIndexAt(
  chapters: Chapter[] | undefined,
  seconds: number,
): number {
  if (!chapters?.length) return -1
  let found = -1
  for (let i = 0; i < chapters.length; i++) {
    if (chapters[i].start <= seconds) found = i
    else break
  }
  return found
}

/** The name of the chapter covering an instant — for the scrubber's tooltip. */
export function chapterAt(chapters: Chapter[] | undefined, seconds: number): string | null {
  const i = chapterIndexAt(chapters, seconds)
  return i < 0 ? null : chapters![i].name
}
