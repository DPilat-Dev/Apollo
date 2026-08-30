import { describe, expect, it } from 'vitest'
import {
  boostGain,
  clampLevel,
  elementVolume,
  formatLevel,
  isBoosted,
  levelForPosition,
  MAX_LEVEL,
  positionForLevel,
  SLIDER_STEP,
  sourceSafety,
  UNITY_POSITION,
} from '../audioBoost'

/** Every hundredth of the slider, so nothing in between is left unexercised. */
const positions = Array.from({ length: 101 }, (_, i) => i / 100)
const levels = Array.from({ length: 301 }, (_, i) => i / 100)

describe('levelForPosition', () => {
  it('anchors the ends and the unity point', () => {
    expect(levelForPosition(0)).toBe(0)
    expect(levelForPosition(UNITY_POSITION)).toBe(1)
    expect(levelForPosition(1)).toBe(MAX_LEVEL)
  })

  it('rises without ever going backwards', () => {
    let previous = -1
    for (const p of positions) {
      const level = levelForPosition(p)
      expect(level).toBeGreaterThan(previous)
      previous = level
    }
  })

  it('spends most of the travel below 100%, where adjustments actually happen', () => {
    expect(levelForPosition(0.5)).toBeLessThan(1)
    expect(levelForPosition(UNITY_POSITION + 0.0001)).toBeGreaterThan(1)
  })

  /*
    A slider only stops on multiples of its step. If 100% falls between two of
    them it is not merely awkward to hit — it is unreachable, and the viewer
    can go up from 99% but never come back to exactly unity.
  */
  it('puts 100% on a step the slider can actually stop at', () => {
    const nearestStep = Math.round(UNITY_POSITION / SLIDER_STEP) * SLIDER_STEP
    expect(levelForPosition(nearestStep)).toBeCloseTo(1, 12)
    expect(isBoosted(levelForPosition(nearestStep))).toBe(false)
    expect(formatLevel(levelForPosition(nearestStep))).toBe('100%')
  })

  it('reaches every whole step of the slider without falling off the range', () => {
    for (let step = 0; step * SLIDER_STEP <= 1 + 1e-9; step++) {
      const level = levelForPosition(step * SLIDER_STEP)
      expect(level).toBeGreaterThanOrEqual(0)
      expect(level).toBeLessThanOrEqual(MAX_LEVEL)
    }
  })

  it('clamps a position off either end of the track', () => {
    expect(levelForPosition(-0.4)).toBe(0)
    expect(levelForPosition(2)).toBe(MAX_LEVEL)
  })

  it('falls back to untouched audio for a position that is not a number', () => {
    expect(levelForPosition(NaN)).toBe(1)
    expect(levelForPosition(Infinity)).toBe(1)
    expect(levelForPosition(-Infinity)).toBe(1)
  })
})

describe('positionForLevel', () => {
  it('is the exact inverse of levelForPosition', () => {
    for (const p of positions) {
      expect(positionForLevel(levelForPosition(p))).toBeCloseTo(p, 10)
    }
  })

  it('stays inside the track for levels outside the range', () => {
    expect(positionForLevel(-1)).toBe(0)
    expect(positionForLevel(99)).toBe(1)
  })

  it('parks a nonsense level at unity rather than at silence', () => {
    expect(positionForLevel(NaN)).toBe(UNITY_POSITION)
  })
})

describe('clampLevel', () => {
  it('keeps ordinary levels untouched', () => {
    expect(clampLevel(0)).toBe(0)
    expect(clampLevel(0.37)).toBe(0.37)
    expect(clampLevel(MAX_LEVEL)).toBe(MAX_LEVEL)
  })

  it('clamps past both ends', () => {
    expect(clampLevel(-2)).toBe(0)
    expect(clampLevel(7)).toBe(MAX_LEVEL)
  })

  /*
    A NaN reaching a gain node throws, and a NaN reaching `video.volume`
    throws too — so the only safe answer is the one that changes nothing.
  */
  it('answers unity for anything not finite', () => {
    expect(clampLevel(NaN)).toBe(1)
    expect(clampLevel(Infinity)).toBe(1)
    expect(clampLevel(-Infinity)).toBe(1)
  })
})

describe('splitting a level into element volume and gain', () => {
  it('delivers exactly the level that was asked for, at every step', () => {
    for (const level of levels) {
      expect(elementVolume(level) * boostGain(level)).toBeCloseTo(clampLevel(level), 10)
    }
  })

  it('still delivers the clamped level for out-of-range and nonsense input', () => {
    for (const level of [-5, 0, MAX_LEVEL + 4, NaN, Infinity, -Infinity]) {
      expect(elementVolume(level) * boostGain(level)).toBe(clampLevel(level))
    }
  })

  it('leaves the gain node neutral at and below 100%', () => {
    expect(boostGain(0)).toBe(1)
    expect(boostGain(0.5)).toBe(1)
    expect(boostGain(1)).toBe(1)
  })

  it('holds the element wide open once boosting, so the gain is the whole story', () => {
    expect(elementVolume(1.5)).toBe(1)
    expect(elementVolume(MAX_LEVEL)).toBe(1)
    expect(boostGain(1.5)).toBe(1.5)
    expect(boostGain(MAX_LEVEL)).toBe(MAX_LEVEL)
  })

  it('never asks the element for a volume it would reject', () => {
    for (const level of [...levels, NaN, -3, 40]) {
      const v = elementVolume(level)
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
  })

  it('never hands the gain node a value below unity', () => {
    for (const level of [...levels, NaN, -3, 40]) {
      expect(boostGain(level)).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('isBoosted', () => {
  it('is false at and below 100%, true above it', () => {
    expect(isBoosted(0)).toBe(false)
    expect(isBoosted(0.99)).toBe(false)
    expect(isBoosted(1)).toBe(false)
    expect(isBoosted(1.02)).toBe(true)
    expect(isBoosted(MAX_LEVEL)).toBe(true)
  })

  /** The badge and the number are read together, so they must agree. */
  it('agrees with the percentage on screen either side of the boundary', () => {
    for (const level of levels) {
      expect(isBoosted(level)).toBe(formatLevel(level) !== '100%' && level > 1)
    }
    expect(formatLevel(1.004)).toBe('100%')
    expect(isBoosted(1.004)).toBe(false)
    expect(formatLevel(1.006)).toBe('101%')
    expect(isBoosted(1.006)).toBe(true)
  })

  it('does not claim a boost for nonsense', () => {
    expect(isBoosted(NaN)).toBe(false)
    expect(isBoosted(Infinity)).toBe(false)
  })
})

describe('formatLevel', () => {
  it('reads as a whole percentage', () => {
    expect(formatLevel(0)).toBe('0%')
    expect(formatLevel(0.5)).toBe('50%')
    expect(formatLevel(1)).toBe('100%')
    expect(formatLevel(2.35)).toBe('235%')
    expect(formatLevel(MAX_LEVEL)).toBe('300%')
  })

  it('reports the clamped level, not the one that was asked for', () => {
    expect(formatLevel(9)).toBe('300%')
    expect(formatLevel(-1)).toBe('0%')
    expect(formatLevel(NaN)).toBe('100%')
  })
})

describe('sourceSafety', () => {
  const origin = 'https://apollo.example'

  it('trusts a Media Source blob, which the page fed itself', () => {
    expect(sourceSafety('blob:https://apollo.example/9f2c', origin)).toBe('safe')
    expect(sourceSafety('blob:https://jellyfin.example/9f2c', origin)).toBe('safe')
  })

  it('trusts a same-origin file however it is written', () => {
    expect(sourceSafety('https://apollo.example/Videos/1/stream.mkv', origin)).toBe('safe')
    expect(sourceSafety('/Videos/1/stream.mkv', origin)).toBe('safe')
  })

  it('will not vouch for another origin, port or scheme', () => {
    expect(sourceSafety('https://jellyfin.example/Videos/1/stream.mkv', origin)).toBe('unknown')
    expect(sourceSafety('https://apollo.example:8096/stream.mkv', origin)).toBe('unknown')
    expect(sourceSafety('http://apollo.example/stream.mkv', origin)).toBe('unknown')
  })

  it('will not vouch for a missing or unparseable source', () => {
    expect(sourceSafety('', origin)).toBe('unknown')
    expect(sourceSafety(undefined, origin)).toBe('unknown')
    expect(sourceSafety(null, origin)).toBe('unknown')
    expect(sourceSafety('http://[', origin)).toBe('unknown')
  })

  /*
    An element that has never been given a source reports `currentSrc` as the
    empty string, but one whose source failed to load reports the document URL —
    which is same-origin, and would be vouched for. That is fine: an element
    with nothing playing has no audio to capture either way.
  */
  it('treats a garbled relative source as the same-origin path it resolves to', () => {
    expect(sourceSafety('::not a url::', origin)).toBe('safe')
  })

  it('reads the origin from the page it is given, not from the environment', () => {
    expect(sourceSafety('https://apollo.example/a.mkv', 'https://other.example')).toBe('unknown')
    expect(sourceSafety('https://other.example/a.mkv', 'https://other.example')).toBe('safe')
  })
})
