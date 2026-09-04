import { describe, expect, it } from 'vitest'
import { playerLoadingMessage } from '../playerLoading'

const ctx = (over = {}) => ({
  burnedSubIndex: undefined as number | undefined,
  reloading: false,
  firstLoad: false,
  buffering: false,
  ...over,
})

describe('playerLoadingMessage', () => {
  it('explains the long wait, because it is the one nobody expects', () => {
    // Twenty seconds of unexplained spinner is the report this exists for.
    const m = playerLoadingMessage(ctx({ burnedSubIndex: 4, reloading: true }))
    expect(m?.headline).toBe('Burning in subtitles')
    expect(m?.detail).toMatch(/re-encoding/)
  })

  it('explains it on a first load too, not only on a switch', () => {
    // An item opened with a burned track already chosen goes straight into the
    // long wait, which is when an unexplained spinner is most alarming.
    expect(playerLoadingMessage(ctx({ burnedSubIndex: 4, firstLoad: true }))?.headline).toBe(
      'Burning in subtitles',
    )
  })

  it('says something shorter for an ordinary stream change', () => {
    const m = playerLoadingMessage(ctx({ reloading: true }))
    expect(m?.headline).toBe('Switching stream')
  })

  it('says nothing for the ordinary two seconds before a first frame', () => {
    // A spinner already says "wait". A sentence for every two-second pause is
    // noise that makes the one that matters easier to ignore.
    expect(playerLoadingMessage(ctx({ firstLoad: true }))).toBeNull()
  })

  it('says nothing for a mid-episode stall', () => {
    expect(playerLoadingMessage(ctx({ buffering: true }))).toBeNull()
  })

  it('says nothing when nothing is happening', () => {
    expect(playerLoadingMessage(ctx())).toBeNull()
  })

  it('does not claim a burn-in when the track is chosen but nothing is loading', () => {
    // Already playing with burned subtitles is not a wait.
    expect(playerLoadingMessage(ctx({ burnedSubIndex: 4 }))).toBeNull()
  })

  it('treats index zero as a real track', () => {
    // A falsy index is still a track, and `!burnedSubIndex` would miss it.
    expect(playerLoadingMessage(ctx({ burnedSubIndex: 0, reloading: true }))?.headline).toBe(
      'Burning in subtitles',
    )
  })
})
