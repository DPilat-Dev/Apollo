import { describe, expect, it } from 'vitest'
import { BITRATE_OPTIONS } from '../settings'
import { FALLBACK_BPS, withHeadroom } from '../bandwidth'
import {
  VERDICT_TIERS,
  describeAge,
  supportedQualityLabel,
  verdict,
} from '../connectionTest'

/**
 * The words the Settings page puts on a speed test.
 *
 * A number on its own answers nothing: 29 Mbps is wonderful on a phone and
 * disappointing from a NAS on the same switch, and nobody reading it knows
 * which rung of the quality menu it buys. So the test reports three things —
 * what it measured, what that will play, and how old the figure is — and all
 * three are arithmetic over a measurement, which means they can be tested
 * here rather than looked at in a browser.
 */
describe('verdict', () => {
  it('describes a connection in terms of what it will play', () => {
    expect(verdict(1_000_000).label).toBe('Slow')
    expect(verdict(4_000_000).label).toBe('Workable')
    expect(verdict(9_000_000).label).toBe('Good')
    expect(verdict(25_000_000).label).toBe('Fast')
    expect(verdict(400_000_000).label).toBe('Very fast')
  })

  it('reads every tier at its own boundary', () => {
    // Each tier covers everything below its threshold, so the threshold itself
    // belongs to the tier above it. Off by one here mislabels the connection
    // of anyone who lands exactly on a round number, which is most LANs.
    for (const tier of VERDICT_TIERS) {
      if (!Number.isFinite(tier.belowBps)) continue
      expect(verdict(tier.belowBps - 1).label).toBe(tier.label)
      expect(verdict(tier.belowBps).label).not.toBe(tier.label)
    }
  })

  it('says something useful rather than repeating the label', () => {
    for (const tier of VERDICT_TIERS) {
      expect(tier.detail.length).toBeGreaterThan(20)
      expect(tier.detail).not.toBe(tier.label)
    }
  })

  it('treats a nonsense figure as the slowest case instead of throwing', () => {
    // `measureBitrate` cannot produce these, but a cache written by an older
    // build can, and a settings page that throws is worse than a wrong word.
    expect(verdict(0).label).toBe('Slow')
    expect(verdict(Number.NaN).label).toBe('Slow')
    expect(verdict(-1).label).toBe('Slow')
  })
})

describe('supportedQualityLabel', () => {
  it('names the highest rung the measured ceiling actually covers', () => {
    expect(supportedQualityLabel(8_000_000, BITRATE_OPTIONS)).toBe('1080p — 8 Mbps')
    expect(supportedQualityLabel(9_900_000, BITRATE_OPTIONS)).toBe('1080p — 8 Mbps')
    expect(supportedQualityLabel(10_000_000, BITRATE_OPTIONS)).toBe('1080p — 10 Mbps')
    expect(supportedQualityLabel(120_000_000, BITRATE_OPTIONS)).toBe('4K — 120 Mbps')
  })

  it('never offers Auto as the answer to how fast this connection is', () => {
    // Auto is the row asking the question. Its value is 0, so a naive "highest
    // value at or below the ceiling" picks it for every connection.
    for (const bps of [1_500_000, 7_000_000, 42_000_000]) {
      expect(supportedQualityLabel(bps, BITRATE_OPTIONS)).not.toMatch(/Auto/)
    }
  })

  it('falls back to the lowest rung below the bottom of the ladder', () => {
    // `withHeadroom` clamps to the lowest rung, so this is unreachable through
    // a measurement — but the function is also handed figures from a cache.
    expect(supportedQualityLabel(100_000, BITRATE_OPTIONS)).toBe('480p — 1.5 Mbps')
  })

  it('agrees with what Auto will really ask for', () => {
    // The pair that has to hang together: Auto hands the server
    // `withHeadroom(raw)`, and this is the rung the page says that buys.
    const raw = 9_000_000
    expect(supportedQualityLabel(withHeadroom(raw), BITRATE_OPTIONS)).toBe('720p — 6 Mbps')
    expect(supportedQualityLabel(FALLBACK_BPS, BITRATE_OPTIONS)).toBe('1080p — 8 Mbps')
  })
})

describe('describeAge', () => {
  const now = 1_700_000_000_000

  it('puts a fresh result in the present tense', () => {
    expect(describeAge(now, now)).toBe('just now')
    expect(describeAge(now - 20_000, now)).toBe('just now')
  })

  it('counts whole minutes once there are any', () => {
    expect(describeAge(now - 60_000, now)).toBe('a minute ago')
    expect(describeAge(now - 4 * 60_000, now)).toBe('4 minutes ago')
    expect(describeAge(now - 9 * 60_000, now)).toBe('9 minutes ago')
  })

  it('does not report a figure from the future as ancient', () => {
    // Clocks move. A negative age formatted as minutes reads as "-3 minutes
    // ago", which looks like a bug in the test rather than in the clock.
    expect(describeAge(now + 5_000, now)).toBe('just now')
  })
})
