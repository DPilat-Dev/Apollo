/**
 * Media segments — the intro, recap and credits ranges a server knows about.
 *
 * Populated by intro detection (the Intro Skipper plugin, or the server's own
 * scan). Where nothing has scanned a library there are simply no segments, and
 * every function here returns nothing rather than guessing at timings.
 */

export type SegmentType = 'Intro' | 'Outro' | 'Recap' | 'Preview' | 'Commercial' | 'Unknown'

export interface MediaSegment {
  Id?: string
  ItemId?: string
  Type?: SegmentType
  StartTicks?: number
  EndTicks?: number
}

export interface SkipTarget {
  type: SegmentType
  label: string
  /** Where playback should land, in seconds. */
  skipToSeconds: number
  /** Identity for the current segment, so a dismissal sticks to one range. */
  key: string
}

const TICKS_PER_SECOND = 10_000_000

/**
 * Below this, skipping is not worth a button — the press costs more than the
 * range it saves, and a stray one-second "segment" is usually a detection
 * artefact rather than a real intro.
 */
const MIN_SEGMENT_SECONDS = 3

const LABELS: Record<SegmentType, string> = {
  Intro: 'Skip Intro',
  Outro: 'Skip Credits',
  Recap: 'Skip Recap',
  Preview: 'Skip Preview',
  Commercial: 'Skip Ad',
  Unknown: 'Skip',
}

const ticks = (value: number | undefined) => (value ?? 0) / TICKS_PER_SECOND

/** Segments worth offering, in playback order. */
export function usableSegments(segments: MediaSegment[] | undefined): MediaSegment[] {
  return (segments ?? [])
    .filter((s) => {
      const start = ticks(s.StartTicks)
      const end = ticks(s.EndTicks)
      return end > start && end - start >= MIN_SEGMENT_SECONDS
    })
    .sort((a, b) => ticks(a.StartTicks) - ticks(b.StartTicks))
}

/**
 * The segment covering this instant, if any.
 *
 * The button is offered for the whole range rather than a few seconds at the
 * start: someone who reaches for it ten seconds in should still find it, which
 * is how every streaming client behaves.
 */
export function segmentAt(
  segments: MediaSegment[] | undefined,
  positionSeconds: number,
): SkipTarget | null {
  for (const segment of usableSegments(segments)) {
    const start = ticks(segment.StartTicks)
    const end = ticks(segment.EndTicks)
    if (positionSeconds >= start && positionSeconds < end) {
      const type = segment.Type ?? 'Unknown'
      return {
        type,
        label: LABELS[type] ?? LABELS.Unknown,
        skipToSeconds: end,
        key: segment.Id ?? `${type}:${start}`,
      }
    }
  }
  return null
}

/**
 * Whether a skip should happen without being asked.
 *
 * Only ever for ranges the viewer has already sat through once — the same
 * reason a client auto-skips a recap but never an ad break it cannot verify.
 */
export function shouldAutoSkip(target: SkipTarget | null, enabled: boolean): boolean {
  if (!enabled || !target) return false
  return target.type === 'Intro' || target.type === 'Recap'
}

/**
 * Where the credits start, in seconds, if the server detected them.
 *
 * The last Outro wins: a server that reports both a mid-episode "next time on"
 * card and the real credits lists them in playback order, and it is the final
 * one that means the episode is over.
 */
export function creditsStartSeconds(segments: MediaSegment[] | undefined): number | null {
  const outros = usableSegments(segments).filter((s) => s.Type === 'Outro')
  const last = outros[outros.length - 1]
  return last ? ticks(last.StartTicks) : null
}
