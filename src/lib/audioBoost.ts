/**
 * Audio boost — volume past the ceiling a media element imposes.
 *
 * `video.volume` is specified as a 0–1 *attenuation*, so a quietly mastered
 * film — or one whose dialogue sits twenty decibels under its explosions — has
 * no remedy at all once the slider is at the top. The only way further up is to
 * run the element through a WebAudio GainNode. This module is the arithmetic
 * half of that; `useAudioBoost` owns the graph.
 *
 * Everything here is expressed as a *level*, where 1 is the file untouched and
 * 3 is three times as loud. A level is split into the element's own volume and
 * the gain node's multiplier by `elementVolume` and `boostGain`, and the
 * product of those two is always the level that was asked for. That identity is
 * the whole point of splitting it here rather than inline in the player: the
 * two halves are set on different objects at different times, and nothing else
 * would notice them drifting apart.
 */

/** The loudest the control goes. Past roughly this, nothing survives it. */
export const MAX_LEVEL = 3

/** The granularity of the slider, in position units. */
export const SLIDER_STEP = 0.01

/**
 * Where 100% sits along the slider.
 *
 * Roughly two thirds of the travel is spent on the ordinary 0–100% range,
 * because that is where almost every adjustment happens. Mapping the level
 * linearly onto the track would leave only a third of it for normal volume,
 * making every everyday nudge twitchy in exchange for fine control over a boost
 * most people never touch.
 *
 * It is 0.65 and not 2/3 so that it lands exactly on a `SLIDER_STEP`
 * boundary. Two thirds falls between 0.66 and 0.67, and a slider that cannot
 * stop at 100% — only at 99% or 102% — turns the boundary this whole module is
 * organised around into something you can't actually return to.
 */
export const UNITY_POSITION = 0.65

/**
 * A level that is safe to hand to both a gain node and `video.volume`.
 *
 * Anything non-finite becomes 1 rather than 0 or the maximum: a NaN arriving
 * from a corrupt stored setting or a `Number('')` throws when assigned to
 * either of them, and of the values that do not throw, the only one that
 * cannot startle someone at 2am is "leave it alone".
 */
export function clampLevel(level: number): number {
  if (!Number.isFinite(level)) return 1
  return Math.min(MAX_LEVEL, Math.max(0, level))
}

/** Slider position (0–1) to level. */
export function levelForPosition(position: number): number {
  if (!Number.isFinite(position)) return 1
  const p = Math.min(1, Math.max(0, position))
  if (p <= UNITY_POSITION) return p / UNITY_POSITION
  return 1 + ((p - UNITY_POSITION) / (1 - UNITY_POSITION)) * (MAX_LEVEL - 1)
}

/** Level back to slider position, so the thumb lands where the level says. */
export function positionForLevel(level: number): number {
  const l = clampLevel(level)
  if (l <= 1) return l * UNITY_POSITION
  return UNITY_POSITION + ((l - 1) / (MAX_LEVEL - 1)) * (1 - UNITY_POSITION)
}

/**
 * What the element's own volume should be for this level.
 *
 * Held wide open while boosting so the gain node is the only thing moving —
 * two attenuations in series would make the number on screen a lie.
 */
export function elementVolume(level: number): number {
  return Math.min(1, clampLevel(level))
}

/**
 * What the gain node should be for this level.
 *
 * Exactly 1 at and below 100%, which is what lets the player leave WebAudio out
 * of the picture entirely until someone actually asks for more.
 */
export function boostGain(level: number): number {
  return Math.max(1, clampLevel(level))
}

/** Whether to say so on screen. Tied to the printed number so they agree. */
export function isBoosted(level: number): boolean {
  return Math.round(clampLevel(level) * 100) > 100
}

export function formatLevel(level: number): string {
  return `${Math.round(clampLevel(level) * 100)}%`
}

export type SourceSafety = 'safe' | 'unknown'

/**
 * Whether routing this source through WebAudio is known not to produce silence.
 *
 * A cross-origin media resource that is not CORS-clean does not make
 * `createMediaElementSource` fail — it makes the graph output silence, forever,
 * with no event and no way back. So the question is asked before the graph is
 * built, and anything not provably fine answers 'unknown' so the caller can
 * check harder or decline.
 *
 * A blob URL is the Media Source path: hls.js fetched the segments itself and
 * appended the bytes, so as far as the element is concerned the media came from
 * this document and is always clean.
 */
export function sourceSafety(src: string | null | undefined, pageOrigin: string): SourceSafety {
  if (!src) return 'unknown'
  if (src.startsWith('blob:') || src.startsWith('mediasource:')) return 'safe'
  try {
    return new URL(src, pageOrigin).origin === pageOrigin ? 'safe' : 'unknown'
  } catch {
    return 'unknown'
  }
}
