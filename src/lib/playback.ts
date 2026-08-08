import type { BaseItemDto, MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models'
import type { JellyfinApi } from './api'
import { secondsToTicks } from './format'

/** Item types that hold media themselves rather than containing other items. */
const PLAYABLE_TYPES = new Set(['Movie', 'Episode', 'Video', 'Audio', 'MusicVideo', 'Trailer'])

/**
 * Maps a container (series, season, collection) to something that can actually
 * be played. Hero and card Play buttons hand over whatever the row contained,
 * which for a "New Shows" row is a Series — and asking the server for
 * PlaybackInfo on a folder is an error, not an empty result.
 */
export async function resolvePlayableItem(
  api: JellyfinApi,
  item: BaseItemDto,
): Promise<BaseItemDto> {
  if (!item.Type || PLAYABLE_TYPES.has(item.Type)) return item

  if (item.Type === 'Series' && item.Id) {
    const next = await api.nextUp({ seriesId: item.Id, limit: 1 })
    if (next.Items?.[0]) return next.Items[0]
    const episodes = await api.episodes(item.Id)
    if (episodes.Items?.[0]) return episodes.Items[0]
  }

  if (item.Type === 'Season' && item.SeriesId && item.Id) {
    const episodes = await api.episodes(item.SeriesId, item.Id)
    if (episodes.Items?.[0]) return episodes.Items[0]
  }

  if (item.Id) {
    const children = await api.items({
      parentId: item.Id,
      recursive: true,
      includeItemTypes: [...PLAYABLE_TYPES],
      sortBy: ['SortName'],
      limit: 1,
    })
    if (children.Items?.[0]) return children.Items[0]
  }

  throw new Error(`There's nothing playable inside “${item.Name ?? 'this item'}”.`)
}

export interface StreamPlan {
  url: string
  /** hls.js is needed for transcoded playlists unless Safari can do it natively. */
  isHls: boolean
  playMethod: 'DirectPlay' | 'DirectStream' | 'Transcode'
  mediaSource: MediaSourceInfo
  playSessionId?: string
  /**
   * Transcodes are cut to start at the resume point, so the video element's
   * clock restarts at 0 and we must add this back when reporting position.
   */
  startOffsetSeconds: number
  subtitles: SubtitleTrack[]
  audio: AudioTrack[]
}

export interface AudioTrack {
  index: number
  label: string
  language?: string
  channels?: number
  codec?: string
  isDefault: boolean
}

export interface SubtitleTrack {
  index: number
  label: string
  language?: string
  /** Present when the track can be attached as a <track> element. */
  url?: string
  isDefault: boolean
}

/**
 * Asks the server how to play an item, then mirrors jellyfin-web's resolution
 * order: direct play > direct stream > transcode.
 */
export async function resolveStream(
  api: JellyfinApi,
  itemId: string,
  opts: {
    startPositionSeconds?: number
    audioStreamIndex?: number
    subtitleStreamIndex?: number
    maxStreamingBitrate?: number
    /** Pins a specific version when an item has several files. */
    mediaSourceId?: string
  } = {},
): Promise<StreamPlan> {
  const startTicks = secondsToTicks(opts.startPositionSeconds ?? 0)

  const info = await api.playbackInfo(itemId, {
    startTimeTicks: startTicks,
    audioStreamIndex: opts.audioStreamIndex,
    subtitleStreamIndex: opts.subtitleStreamIndex,
    maxStreamingBitrate: opts.maxStreamingBitrate,
    mediaSourceId: opts.mediaSourceId,
  })

  // The server may still return every version, so pick the requested one.
  const source =
    (opts.mediaSourceId
      ? info.MediaSources?.find((s) => s.Id === opts.mediaSourceId)
      : undefined) ?? info.MediaSources?.[0]
  if (!source) throw new Error('The server returned no playable media source for this item.')

  const base = {
    mediaSource: source,
    playSessionId: info.PlaySessionId ?? undefined,
    subtitles: collectSubtitles(api, itemId, source),
    audio: audioTracks(source),
  }

  if (source.SupportsDirectPlay || source.SupportsDirectStream) {
    const container = source.Container ?? 'mp4'
    const url = api.authedUrl(`/Videos/${itemId}/stream.${container}`, {
      static: true,
      mediaSourceId: source.Id,
      tag: source.ETag,
      playSessionId: info.PlaySessionId,
    })
    return {
      ...base,
      url,
      isHls: false,
      playMethod: source.SupportsDirectPlay ? 'DirectPlay' : 'DirectStream',
      // Direct playback keeps the original timeline, so we seek instead of offsetting.
      startOffsetSeconds: 0,
    }
  }

  if (source.SupportsTranscoding && source.TranscodingUrl) {
    // TranscodingUrl is server-relative and already carries its own auth + params.
    const url = new URL(source.TranscodingUrl.replace(/^\//, ''), `${api.server}/`).toString()
    const isHls = source.TranscodingSubProtocol?.toLowerCase() === 'hls'
    return {
      ...base,
      url,
      isHls,
      playMethod: 'Transcode',
      startOffsetSeconds: isHls ? 0 : (opts.startPositionSeconds ?? 0),
    }
  }

  throw new Error('This item cannot be played by this client.')
}

function collectSubtitles(
  api: JellyfinApi,
  itemId: string,
  source: MediaSourceInfo,
): SubtitleTrack[] {
  const streams = source.MediaStreams ?? []
  return streams
    .filter((s) => s.Type === 'Subtitle')
    .map((s) => {
      const index = s.Index ?? -1
      // Text subtitles can be fetched as VTT; image-based ones (PGS/VOBSUB) cannot.
      const canExtract = s.IsTextSubtitleStream === true && index >= 0
      return {
        index,
        label: s.DisplayTitle ?? s.Language ?? `Track ${index}`,
        language: s.Language ?? undefined,
        isDefault: Boolean(s.IsDefault),
        url: canExtract
          ? api.authedUrl(
              `/Videos/${itemId}/${source.Id}/Subtitles/${index}/0/Stream.vtt`,
            )
          : undefined,
      }
    })
}

/** Audio tracks the user can switch between, for the player's settings menu. */
export function audioTracks(source: MediaSourceInfo): AudioTrack[] {
  return (source.MediaStreams ?? [])
    .filter((s) => s.Type === 'Audio')
    .map((s) => ({
      index: s.Index ?? -1,
      label: s.DisplayTitle ?? s.Language ?? `Track ${s.Index}`,
      language: s.Language ?? undefined,
      channels: s.Channels ?? undefined,
      codec: s.Codec ?? undefined,
      isDefault: Boolean(s.IsDefault),
    }))
}

/**
 * The episodes on either side of this one, in series order. One request covers
 * both, and crossing a season boundary falls out for free.
 */
export async function resolveSiblingEpisodes(
  api: JellyfinApi,
  item: BaseItemDto,
): Promise<{ previous: BaseItemDto | null; next: BaseItemDto | null }> {
  const none = { previous: null, next: null }
  if (item.Type !== 'Episode' || !item.SeriesId || !item.Id) return none

  const all = (await api.episodes(item.SeriesId)).Items ?? []
  const i = all.findIndex((e) => e.Id === item.Id)
  if (i < 0) return none
  return {
    previous: i > 0 ? all[i - 1] : null,
    next: i + 1 < all.length ? all[i + 1] : null,
  }
}

/**
 * What a container's Play button should start: something already part-way
 * through first, then the first unwatched, then the very first episode.
 *
 * Preferring an in-progress episode is what makes the button say Resume rather
 * than restarting a show someone is halfway into.
 */
export function pickPlayableEpisode(episodes?: BaseItemDto[]): BaseItemDto | null {
  if (!episodes?.length) return null
  const fraction = (e: BaseItemDto) => {
    const pct = e.UserData?.PlayedPercentage
    if (typeof pct === 'number' && pct > 0) return Math.min(pct / 100, 1)
    const ticks = e.UserData?.PlaybackPositionTicks
    if (ticks && e.RunTimeTicks) return Math.min(ticks / e.RunTimeTicks, 1)
    return 0
  }
  const inProgress = episodes.find((e) => {
    const f = fraction(e)
    return f > 0.01 && f < 0.95
  })
  return inProgress ?? episodes.find((e) => !e.UserData?.Played) ?? episodes[0]
}

/** First episode of the series — where "repeat all" wraps back to. */
export async function resolveFirstEpisode(
  api: JellyfinApi,
  item: BaseItemDto,
): Promise<BaseItemDto | null> {
  if (item.Type !== 'Episode' || !item.SeriesId) return null
  return (await api.episodes(item.SeriesId)).Items?.[0] ?? null
}
