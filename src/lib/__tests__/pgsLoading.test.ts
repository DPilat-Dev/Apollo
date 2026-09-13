import { describe, expect, it } from 'vitest'
import * as loading from '../pgsLoading'
import { PGS_PREPARING_AFTER_MS, PGS_RENDER_TIMEOUT_MS, pgsWaitMessage } from '../pgsLoading'

describe('waiting for a PGS track', () => {
  it('sets no deadline on the fetch at all', () => {
    /*
      Measured against 10.11.8: 185 s to the first byte of one film's PGS track
      the first time it is asked for, and over seven minutes for a longer one —
      so no number here is the right number. Nothing is blocked meanwhile, and
      aborting appears to kill the server's extraction, which makes a deadline
      worse than none: it cannot rescue anybody and it throws away the work
      that would have.
    */
    const deadlines = Object.entries(loading).filter(
      ([name, v]) => typeof v === 'number' && /FETCH|GIVE_UP|ABORT/i.test(name),
    )
    expect(deadlines).toEqual([])
  })

  it('keeps the renderer on a short leash, now that it is not waiting on a network', () => {
    // A worker starting and a buffer parsing — not a download, and not an
    // extraction. If that has not happened in fifteen seconds it is not going
    // to, and unlike the fetch this one genuinely can be bounded.
    expect(PGS_RENDER_TIMEOUT_MS).toBeGreaterThan(5_000)
    expect(PGS_RENDER_TIMEOUT_MS).toBeLessThan(30_000)
  })

  it('says it is loading while that is still a fair description', () => {
    expect(pgsWaitMessage(0)).toBe('Loading subtitles…')
    expect(pgsWaitMessage(PGS_PREPARING_AFTER_MS - 1)).toBe('Loading subtitles…')
  })

  it('explains itself once the wait stops looking like loading', () => {
    const later = pgsWaitMessage(PGS_PREPARING_AFTER_MS)
    expect(later).not.toBe('Loading subtitles…')
    expect(later).toMatch(/server/i)
    // Says it only happens once, because otherwise the honest version of this
    // reads as "subtitles are always slow here".
    expect(later).toMatch(/first time/i)
  })

  it('changes its mind exactly once', () => {
    const messages = new Set([0, 1_000, 11_999, 12_000, 60_000, 300_000].map(pgsWaitMessage))
    expect(messages.size).toBe(2)
  })
})
