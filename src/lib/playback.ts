import type { BaseItemDto, MediaSourceInfo } from '@jellyfin/sdk/lib/generated-client/models'
import type { JellyfinApi } from './api'
import { secondsToTicks } from './format'
import { assStreamPath, isAssCodec } from './assSubtitles'
import { isPgsCodec, pgsStreamPath } from './pgsSubtitles'

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
  /**
   * The untouched ASS/SSA file, for the tracks libass can do better with than
   * the server's WebVTT conversion. Absent for every other format.
   */
  assUrl?: string
  /**
   * The raw PGS bitmap stream, drawn on a canvas rather than burned into the
   * video by the server. Absent for every other format — and for PGS itself
   * on a server that will not deliver it, which is why the burn-in path is
   * still reachable.
   */
  pgsUrl?: string
  /** As the server names it: `ass`, `subrip`, `pgssub`… */
  codec?: string
  isDefault: boolean
  /**
   * Only the lines a viewer of the original language still needs — signs, and
   * dialogue in a third language. Not what someone asking for subtitles in
   * their own language is after, which is why the two are told apart.
   */
  isForced: boolean
}

/**
 * The same transcode, with the server's uninvited burn-in switched off.
 *
 * A `PlaybackInfo` request that names no subtitle stream does not mean "no
 * subtitles" to Jellyfin — it means "use the file's default", and it will build
 * a transcode that burns that default into the picture. For a file whose
 * default track is a bitmap the result is subtitles nobody asked for, on a
 * viewer who had them switched off, with no way back: choosing Off sends
 * another request that names no stream, and the server defaults again.
 *
 * `SubtitleStreamIndex: -1` in the request body does not help — 10.11.8 ignores
 * it and burns the default in anyway, which is why this happens out here on the
 * URL the server handed back rather than in the question that produced it.
 * Measured against 10.11.8: the same frame of the same episode carries
 * "No, no, wait. Please, please." before this and a clean picture after.
 *
 * `SubtitleMethod` goes with it. Leaving `Encode` next to an index of -1 is a
 * combination nothing was asked to make sense of, and the pair is what the
 * server writes when it does want a burn-in.
 */
export function withoutBurnedInSubtitles(url: string): string {
  try {
    const next = new URL(url)
    // Absent on a transcode of a file with no default subtitle, which is most
    // of them — nothing to switch off, and nothing to rewrite.
    if (!next.searchParams.has('SubtitleStreamIndex')) return url
    next.searchParams.set('SubtitleStreamIndex', '-1')
    next.searchParams.delete('SubtitleMethod')
    return next.toString()
  } catch {
    // A URL that will not parse is one this cannot improve. Handing it back
    // untouched leaves playback exactly as it was rather than breaking it.
    return url
  }
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
    subtitles: subtitleTracks(api, itemId, source),
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
    const built = new URL(source.TranscodingUrl.replace(/^\//, ''), `${api.server}/`).toString()
    /*
      Nobody asked for a burned-in track, so make sure there is not one. The
      server picks the file's default whenever the request names no stream, and
      for a bitmap track that means re-encoding it into the picture.
    */
    const url = opts.subtitleStreamIndex == null ? withoutBurnedInSubtitles(built) : built
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

export function subtitleTracks(
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
      const codec = s.Codec ?? undefined
      /*
        PGS is a picture and so has no VTT, but it does not need one: the
        server hands over the bitmap stream itself once the device profile
        says this client can draw it. VOBSUB has no equivalent here and still
        goes to the server to be burned in.
      */
      const canDrawPgs = isPgsCodec(codec) && index >= 0 && Boolean(source.Id)
      return {
        index,
        label: s.DisplayTitle ?? s.Language ?? `Track ${index}`,
        language: s.Language ?? undefined,
        codec,
        isDefault: Boolean(s.IsDefault),
        isForced: Boolean(s.IsForced),
        url: canExtract
          ? api.authedUrl(
              `/Videos/${itemId}/${source.Id}/Subtitles/${index}/0/Stream.vtt`,
            )
          : undefined,
        /*
          Offered alongside the VTT rather than instead of it. The conversion
          is what plays if libass cannot start, so both have to be here before
          anything decides which one is used.
        */
        assUrl:
          canExtract && isAssCodec(codec) && source.Id
            ? api.authedUrl(assStreamPath(itemId, source.Id, index))
            : undefined,
        pgsUrl: canDrawPgs ? api.authedUrl(pgsStreamPath(itemId, source.Id!, index)) : undefined,
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

/**
 * Whether hls.js could work here at all.
 *
 * It needs Media Source Extensions. Checking before importing avoids fetching
 * half a megabyte on browsers that would only report it unsupported — iPhones
 * below iOS 17 among them, which then play HLS through the native path.
 */
export function supportsMediaSource(): boolean {
  if (typeof window === 'undefined') return false
  return 'MediaSource' in window || 'ManagedMediaSource' in window
}
