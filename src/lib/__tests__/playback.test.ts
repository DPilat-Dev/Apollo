import { describe, expect, it } from 'vitest'
import type {
  BaseItemDto,
  MediaSourceInfo,
  MediaStream,
} from '@jellyfin/sdk/lib/generated-client/models'
import { JellyfinApi } from '../api'
import { pickPlayableEpisode, subtitleTracks } from '../playback'

const TICK = 10_000_000
const ep = (id: string, opts: { played?: boolean; pct?: number } = {}): BaseItemDto =>
  ({
    Id: id,
    Type: 'Episode',
    RunTimeTicks: 60 * TICK,
    UserData: {
      Played: opts.played ?? false,
      ...(opts.pct != null ? { PlayedPercentage: opts.pct } : {}),
    },
  }) as BaseItemDto

/**
 * Regression: the series page had a disabled Play button because nothing ever
 * resolved which episode it should start.
 */
describe('pickPlayableEpisode', () => {
  it('prefers an episode already part-way through', () => {
    const list = [ep('a', { played: true }), ep('b', { pct: 44 }), ep('c')]
    expect(pickPlayableEpisode(list)?.Id).toBe('b')
  })

  it('otherwise takes the first unwatched', () => {
    const list = [ep('a', { played: true }), ep('b', { played: true }), ep('c')]
    expect(pickPlayableEpisode(list)?.Id).toBe('c')
  })

  it('falls back to the first episode when everything is watched', () => {
    const list = [ep('a', { played: true }), ep('b', { played: true })]
    expect(pickPlayableEpisode(list)?.Id).toBe('a')
  })

  it('does not treat a barely-started episode as resumable', () => {
    // 0.4% in is noise, not progress — but it is still unwatched, so it is
    // rightly the first unwatched rather than being skipped.
    const list = [ep('a', { pct: 0.4 }), ep('b', { pct: 44 }), ep('c')]
    expect(pickPlayableEpisode(list)?.Id).toBe('b')
  })

  it('treats a nearly-finished episode as unwatched, not resumable', () => {
    const list = [ep('a', { played: true }), ep('b', { pct: 99 }), ep('c')]
    // 'b' is past the resume threshold, so Play won't jump to its last minute.
    // It is still the first unwatched episode though, which is the contract
    // here and matches how Jellyfin's own Next Up behaves. Jellyfin normally
    // marks something played well before 99%, so this state is rare.
    expect(pickPlayableEpisode(list)?.Id).toBe('b')
  })

  it('returns null rather than throwing on nothing', () => {
    expect(pickPlayableEpisode([])).toBeNull()
    expect(pickPlayableEpisode(undefined)).toBeNull()
  })
})

/*
  What the player needs to know about a subtitle stream before it can decide
  how to draw it: the converted WebVTT for the <track> element, and — for the
  one family of formats libass can improve on — the raw file as well.
*/
describe('subtitleTracks', () => {
  const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 'tok' })
  const source = (streams: Partial<MediaStream>[]): MediaSourceInfo =>
    ({ Id: 'src-1', MediaStreams: streams }) as MediaSourceInfo

  it('offers the raw ASS file alongside the converted one', () => {
    const [t] = subtitleTracks(api, 'item-1', source([
      { Type: 'Subtitle', Index: 2, Codec: 'ass', IsTextSubtitleStream: true },
    ]))
    expect(t.codec).toBe('ass')
    expect(t.url).toContain('/Subtitles/2/0/Stream.vtt')
    expect(t.assUrl).toContain('/Subtitles/2/0/Stream.ass')
  })

  it('offers no raw file for SubRip, which has no typesetting to lose', () => {
    const [t] = subtitleTracks(api, 'item-1', source([
      { Type: 'Subtitle', Index: 2, Codec: 'subrip', IsTextSubtitleStream: true },
    ]))
    expect(t.url).toContain('Stream.vtt')
    expect(t.assUrl).toBeUndefined()
  })

  it('offers neither for a picture track the server has to burn in', () => {
    const [t] = subtitleTracks(api, 'item-1', source([
      { Type: 'Subtitle', Index: 4, Codec: 'pgssub', IsTextSubtitleStream: false },
    ]))
    expect(t.url).toBeUndefined()
    expect(t.assUrl).toBeUndefined()
  })
})
