import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type Hls from 'hls.js'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { useItem, useMediaSegments } from '../lib/queries'
import {
  resolveFirstEpisode,
  resolvePlayableItem,
  resolveSiblingEpisodes,
  resolveStream,
  supportsMediaSource,
  type StreamPlan,
} from '../lib/playback'
import { useProgressReporter } from '../lib/useProgressReporter'
import { useMediaSession } from '../lib/useMediaSession'
import { usePictureInPicture } from '../lib/usePictureInPicture'
import { useTapGestures, type TapFeedback } from '../lib/useTapGestures'
import { useWakeLock } from '../lib/useWakeLock'
import { useSyncPlay } from '../lib/syncplay'
import { creditsStartSeconds, segmentAt, shouldAutoSkip, usableSegments } from '../lib/segments'
import type { MediaSegment } from '../lib/segments'
import { applySubtitleCss, subtitleCss } from '../lib/subtitleStyle'
import { SyncPlayMenu } from '../components/SyncPlayMenu'
import { chapterAt, Scrubber } from '../components/Scrubber'
import { selectTrickplay, trickplaySprite } from '../lib/trickplay'
import { clearQueue, nextInQueue, previousInQueue, queuePosition } from '../lib/queue'
import { UpNext, upNextLeadSeconds } from '../components/UpNext'
import { BITRATE_OPTIONS, useSettings } from '../lib/settings'
import { displayTitle, episodeCode, formatTimecode, ticksToSeconds } from '../lib/format'
import {
  BackIcon,
  CastIcon,
  ExitFullscreenIcon,
  FullscreenIcon,
  GearIcon,
  MuteIcon,
  NextTrackIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  RepeatIcon,
  Skip10Icon,
  SubtitlesIcon,
  VolumeIcon,
} from '../components/icons'

const IDLE_MS = 3000
const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

type RepeatMode = 'off' | 'one' | 'all'
type AspectMode = 'fit' | 'fill' | 'stretch'

const ASPECTS: { value: AspectMode; label: string; hint: string }[] = [
  { value: 'fit', label: 'Fit', hint: 'Show the whole frame' },
  { value: 'fill', label: 'Fill', hint: 'Crop to fill the screen' },
  { value: 'stretch', label: 'Stretch', hint: 'Ignore the aspect ratio' },
]

export function Player() {
  const { itemId } = useParams<{ itemId: string }>()
  const [search] = useSearchParams()
  const api = useApi()
  const navigate = useNavigate()
  const settings = useSettings()
  const syncPlay = useSyncPlay()
  const { data: requestedItem } = useItem(itemId)

  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<Hls | null>(null)
  const idleTimer = useRef<number | undefined>(undefined)

  // /watch/:id may point at a series or collection, so step down to a real
  // episode before asking the server how to play it.
  const playable = useQuery({
    queryKey: ['playable', api.userId, itemId],
    queryFn: () => resolvePlayableItem(api, requestedItem!),
    enabled: Boolean(requestedItem),
    staleTime: Infinity,
    retry: false,
  })
  const item = playable.data

  /*
    Track selection. Changing any of these re-resolves the stream, because the
    server decides audio and burned-in subtitles at transcode time.

    Seeded from the query string so a choice made on the detail page is applied
    to the first request — one transcode instead of starting, switching and
    restarting.
  */
  const numberParam = (key: string) => {
    const raw = search.get(key)
    if (raw == null) return undefined
    const value = Number(raw)
    return Number.isFinite(value) ? value : undefined
  }
  const requestedSource = search.get('source') ?? undefined
  const [audioIndex, setAudioIndex] = useState<number | undefined>(() => numberParam('audio'))
  const [burnedSubIndex, setBurnedSubIndex] = useState<number | undefined>(undefined)
  const [bitrateOverride, setBitrateOverride] = useState<number | undefined>()

  const [paused, setPaused] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [volume, setVolume] = useState(1)
  const [muted, setMuted] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [textTrackIndex, setTextTrackIndex] = useState<number | null>(null)
  const [menu, setMenu] = useState<'none' | 'settings' | 'subtitles'>('none')
  const [speed, setSpeed] = useState(1)
  const [aspect, setAspect] = useState<AspectMode>('fit')
  const [repeat, setRepeat] = useState<RepeatMode>('off')
  const [showStats, setShowStats] = useState(false)
  const [castAvailable, setCastAvailable] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)

  /**
   * Where playback should pick up after the next stream (re)load. Seeded from
   * the server's resume point, then overwritten whenever a track change forces
   * a reload so the switch is seamless.
   */
  const resumeTargetRef = useRef(0)
  const seededForRef = useRef<string | undefined>(undefined)
  if (item?.Id && seededForRef.current !== item.Id) {
    seededForRef.current = item.Id
    resumeTargetRef.current = item.UserData?.PlaybackPositionTicks
      ? ticksToSeconds(item.UserData.PlaybackPositionTicks)
      : 0
  }

  /*
    Advancing an episode reuses this component — /watch/:id keeps the same
    instance — so the clock has to be reset by hand. Leaving the previous
    episode's position in state briefly makes the next one look finished, which
    fires the up-next card immediately and skips through the queue.
  */
  useEffect(() => {
    setCurrentTime(0)
    setDuration(0)
    setBuffered(0)
    setDismissedUpNext(null)
    setDismissedSkip(null)
  }, [item?.Id])

  const effectiveBitrate = bitrateOverride ?? settings.maxBitrate

  const streamQuery = useQuery({
    queryKey: [
      'stream',
      item?.Id,
      audioIndex,
      burnedSubIndex,
      effectiveBitrate,
      requestedSource,
    ],
    queryFn: () => {
      // The query is gated on this, but a throw here would be caught by the
      // query rather than crashing the render.
      if (!item?.Id) throw new Error('No playable item.')
      return resolveStream(api, item.Id, {
        startPositionSeconds: resumeTargetRef.current,
        audioStreamIndex: audioIndex,
        subtitleStreamIndex: burnedSubIndex,
        maxStreamingBitrate: effectiveBitrate || undefined,
        mediaSourceId: requestedSource,
      })
    },
    enabled: Boolean(item?.Id),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
  const plan: StreamPlan | null = streamQuery.data ?? null

  const segments = useMediaSegments(item?.Id ?? undefined)

  const siblings = useQuery({
    queryKey: ['siblings', api.userId, item?.Id],
    queryFn: () => resolveSiblingEpisodes(api, item!),
    enabled: Boolean(item?.Id && item?.Type === 'Episode'),
    staleTime: 5 * 60 * 1000,
  })

  /*
    A shuffle queue, when one is running, decides what comes next — otherwise
    "next" would walk the series in order and quietly undo the shuffle.

    The queue lives in sessionStorage, so clearing it needs a render to be
    observed; `shuffleCleared` exists only to force that.
  */
  const [shuffleCleared, setShuffleCleared] = useState(0)
  void shuffleCleared
  const shuffle = queuePosition(item?.Id ?? undefined)
  const nextId = shuffle ? nextInQueue(item?.Id ?? undefined) : siblings.data?.next?.Id
  const previousId = shuffle
    ? previousInQueue(item?.Id ?? undefined)
    : siblings.data?.previous?.Id

  // The card needs the next episode's artwork and title, not just its id.
  const nextEpisode = useQuery({
    queryKey: ['item', api.userId, nextId],
    queryFn: () => api.item(nextId!),
    enabled: Boolean(nextId),
    staleTime: 5 * 60 * 1000,
  })

  const [dismissedUpNext, setDismissedUpNext] = useState<string | null>(null)
  const [dismissedSkip, setDismissedSkip] = useState<string | null>(null)
  const skipTargetRef = useRef<ReturnType<typeof segmentAt>>(null)

  // Absolute media position — transcoded streams restart their clock at zero.
  const offset = plan?.startOffsetSeconds ?? 0
  const absoluteTime = currentTime + offset
  const absoluteDuration = item?.RunTimeTicks
    ? ticksToSeconds(item.RunTimeTicks)
    : duration + offset

  useProgressReporter({
    api,
    itemId: item?.Id ?? undefined,
    plan,
    positionSeconds: () => absoluteTime,
    isPaused: () => paused,
  })

  /** Re-resolve the stream from where we are now, not from the start. */
  const reloadFrom = useCallback(
    (apply: () => void) => {
      resumeTargetRef.current = absoluteTime
      apply()
    },
    [absoluteTime],
  )

  // ------------------------------------------------------------ attach media

  useEffect(() => {
    const video = videoRef.current
    if (!video || !plan) return

    setError(null)
    let cancelled = false

    const seekToTarget = () => {
      if (cancelled) return
      // Non-HLS transcodes are already cut at the requested position.
      if (plan.startOffsetSeconds > 0) return
      const target = resumeTargetRef.current
      if (target > 5 && target < (video.duration || Infinity) - 10) {
        video.currentTime = target
      }
    }

    const playNatively = () => {
      // Safari plays HLS natively; direct/direct-stream is a plain file URL.
      video.src = plan.url
      video.addEventListener('loadedmetadata', seekToTarget, { once: true })
      void video.play().catch(() => {})
    }

    /*
      hls.js is half a megabyte, so it is fetched only when it will actually
      be used — not on direct play, and never on a browser without Media
      Source Extensions, where `Hls.isSupported()` would just return false
      after the download. iPhones fall in that second group, so they were
      paying the whole cost to then play through the native path anyway.
    */
    if (plan.isHls && supportsMediaSource()) {
      void import('hls.js').then(({ default: Hls }) => {
        if (cancelled) return
        if (!Hls.isSupported()) return playNatively()

        const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 })
        hlsRef.current = hls
        hls.loadSource(plan.url)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          seekToTarget()
          void video.play().catch(() => {})
        })
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
          else setError('Playback failed. The server may not be able to transcode this file.')
        })
      }).catch(() => {
        if (!cancelled) setError('The player failed to load. Check your connection and retry.')
      })
    } else {
      playNatively()
    }

    return () => {
      cancelled = true
      hlsRef.current?.destroy()
      hlsRef.current = null
      video.removeAttribute('src')
      video.load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  /*
    The speed the viewer chose, as opposed to the rate the element happens to
    be running at — SyncPlay nudges the latter by a percent or two to close a
    drift. Kept in a ref so drift correction can read it without the group
    re-registering the player every time the speed menu is touched.
  */
  const speedRef = useRef(speed)
  speedRef.current = speed

  /*
    Playback rate is reset by every source change, so reapply it. This also
    deliberately overwrites any drift correction in flight: reaching for the
    speed menu is an intent, and the group defers to it rather than fighting.
  */
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed
  }, [speed, plan])

  // ------------------------------------------------------------ video events

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onTime = () => {
      setCurrentTime(video.currentTime)
      const b = video.buffered
      setBuffered(b.length ? b.end(b.length - 1) : 0)
    }
    const onDuration = () => setDuration(video.duration || 0)
    const onPlay = () => setPaused(false)
    const onPause = () => setPaused(true)
    const onVolume = () => {
      setVolume(video.volume)
      setMuted(video.muted)
    }
    const onWaiting = () => setWaiting(true)
    const onPlaying = () => setWaiting(false)
    const onError = () => setError('This file could not be played.')

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('progress', onTime)
    video.addEventListener('durationchange', onDuration)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('volumechange', onVolume)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('error', onError)

    return () => {
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('progress', onTime)
      video.removeEventListener('durationchange', onDuration)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('volumechange', onVolume)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('error', onError)
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  // Cast / AirPlay availability, via the Remote Playback API. Not every browser
  // implements it, and it rejects outright when the page isn't allowed to cast.
  useEffect(() => {
    const video = videoRef.current
    if (!video || !('remote' in video)) return
    let watchId: number | undefined
    video.remote
      .watchAvailability((available) => setCastAvailable(available))
      .then((id) => {
        watchId = id
      })
      .catch(() => setCastAvailable(false))
    return () => {
      video.remote?.cancelWatchAvailability(watchId).catch(() => {})
    }
  }, [])

  // ----------------------------------------------------------- end behaviour

  const goTo = useCallback(
    (target: BaseItemDto | null | undefined) => {
      if (target?.Id) navigate(`/watch/${target.Id}`, { replace: true })
    },
    [navigate],
  )

  const goToId = useCallback(
    (id?: string | null) => {
      if (id) navigate(`/watch/${id}`, { replace: true })
    },
    [navigate],
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video || !item) return

    const onEnded = async () => {
      if (repeat === 'one') {
        video.currentTime = 0
        void video.play().catch(() => {})
        return
      }
      if (nextId && (repeat === 'all' || settings.autoplayNext)) return goToId(nextId)
      // End of the series with repeat-all on: wrap to the first episode.
      if (repeat === 'all' && !nextId) {
        goTo(await resolveFirstEpisode(api, item).catch(() => null))
      }
    }

    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [api, item, repeat, settings.autoplayNext, nextId, goTo, goToId])

  // --------------------------------------------------------------- controls

  const playLocally = useCallback(() => {
    void videoRef.current?.play().catch(() => {})
  }, [])

  const pauseLocally = useCallback(() => {
    videoRef.current?.pause()
  }, [])

  const seekAbsoluteLocally = useCallback(
    (absolute: number) => {
      const v = videoRef.current
      if (!v || !plan) return
      v.currentTime = Math.max(0, absolute - plan.startOffsetSeconds)
    },
    [plan],
  )

  /*
    In a SyncPlay group the server owns the timeline: these ask it to act and
    the command comes back over the socket for everyone at once. Outside a
    group the same calls fall through to the local player.
  */
  const inGroup = Boolean(syncPlay?.group)

  const requestPlay = useCallback(
    () => (syncPlay ? syncPlay.requestPlay() : playLocally()),
    [syncPlay, playLocally],
  )

  const requestPause = useCallback(
    () => (syncPlay ? syncPlay.requestPause() : pauseLocally()),
    [syncPlay, pauseLocally],
  )

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) requestPlay()
    else requestPause()
  }, [requestPlay, requestPause])

  const seekAbsolute = useCallback(
    (absolute: number) => {
      if (syncPlay && inGroup) return syncPlay.requestSeek(absolute)
      seekAbsoluteLocally(absolute)
    },
    [syncPlay, inGroup, seekAbsoluteLocally],
  )

  const seekBy = useCallback(
    (delta: number) => {
      const v = videoRef.current
      if (!v || !plan) return
      const target = Math.max(
        0,
        Math.min(v.currentTime + delta, v.duration || Infinity) + plan.startOffsetSeconds,
      )
      seekAbsolute(target)
    },
    [plan, seekAbsolute],
  )

  const doSkip = useCallback(() => {
    if (!skipTargetRef.current) return
    seekAbsolute(skipTargetRef.current.skipToSeconds)
  }, [seekAbsolute])

  // ------------------------------------------------------ system integration

  const pip = usePictureInPicture(videoRef)
  const togglePip = pip.toggle

  // The screen is allowed to sleep the moment playback stops, so a paused
  // episode left on the sofa does not burn the battery down.
  useWakeLock(!paused)

  const goNext = useCallback(() => goToId(nextId), [goToId, nextId])
  const goPrevious = useCallback(() => goToId(previousId), [goToId, previousId])
  const squareArtwork = useCallback(
    (edge: number) => (item ? api.coverUrl(item, edge, edge) : null),
    [api, item],
  )

  useMediaSession({
    item,
    artwork: squareArtwork,
    paused,
    // Absolute, so the lock-screen scrubber matches the episode rather than
    // the transcode's own clock.
    positionSeconds: absoluteTime,
    durationSeconds: absoluteDuration,
    playbackRate: speed,
    onPlay: requestPlay,
    onPause: requestPause,
    onSeekTo: seekAbsolute,
    onSeekBy: seekBy,
    onNext: nextId ? goNext : undefined,
    onPrevious: previousId ? goPrevious : undefined,
  })

  // ::cue cannot be styled inline, so it goes through a managed stylesheet
  // that lives only while the player is mounted.
  useEffect(() => {
    applySubtitleCss(subtitleCss(settings))
    return () => applySubtitleCss(null)
  }, [settings])

  // Hand the group a way to drive this player.
  useEffect(() => {
    if (!syncPlay) return
    syncPlay.registerPlayer({
      play: playLocally,
      pause: pauseLocally,
      seekTo: seekAbsoluteLocally,
      position: () => (videoRef.current?.currentTime ?? 0) + (plan?.startOffsetSeconds ?? 0),
      isPlaying: () => !(videoRef.current?.paused ?? true),
      playbackRate: () => videoRef.current?.playbackRate ?? 1,
      chosenRate: () => speedRef.current,
      setPlaybackRate: (rate: number) => {
        if (videoRef.current) videoRef.current.playbackRate = rate
      },
      playlistItemId: item?.Id ?? undefined,
    })
    return () => syncPlay.registerPlayer(null)
  }, [syncPlay, playLocally, pauseLocally, seekAbsoluteLocally, plan, item?.Id])

  // Stalling here has to hold the whole group, not just this screen.
  useEffect(() => {
    syncPlay?.reportBuffering(waiting)
  }, [syncPlay, waiting])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen().catch(() => {})
  }, [])

  const nudgeActivity = useCallback(() => {
    setControlsVisible(true)
    window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => setControlsVisible(false), IDLE_MS)
  }, [])

  useEffect(() => {
    nudgeActivity()
    return () => window.clearTimeout(idleTimer.current)
  }, [nudgeActivity])

  const showControls = controlsVisible || paused || menu !== 'none' || waiting

  /*
    A touch only keeps the controls alive, never summons them. Revealing them
    is the tap gesture's job, and a nudge here would fire first — on the
    `touchstart` half of the very tap being asked to hide them.
  */
  const nudgeOnTouch = useCallback(() => {
    if (controlsVisible) nudgeActivity()
  }, [controlsVisible, nudgeActivity])

  const toggleControls = useCallback(() => {
    if (showControls) {
      window.clearTimeout(idleTimer.current)
      setControlsVisible(false)
    } else {
      nudgeActivity()
    }
  }, [showControls, nudgeActivity])

  /*
    Touch gestures on the video itself: one tap for the controls, two near an
    edge to jump. `seekFlash` exists because a double tap usually happens with
    the chrome hidden, and a jump nothing acknowledges reads as a dropped tap.
  */
  const [seekFlash, setSeekFlash] = useState<TapFeedback | null>(null)
  const flashTimer = useRef<number | undefined>(undefined)
  const showSeekFlash = useCallback((feedback: TapFeedback | null) => {
    setSeekFlash(feedback)
    window.clearTimeout(flashTimer.current)
    if (feedback) flashTimer.current = window.setTimeout(() => setSeekFlash(null), 650)
  }, [])
  useEffect(() => () => window.clearTimeout(flashTimer.current), [])

  const onVideoPointerUp = useTapGestures({
    onSeekBy: seekBy,
    onTogglePlay: togglePlay,
    onSingleTap: toggleControls,
    onFeedback: showSeekFlash,
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return
      nudgeActivity()
      switch (e.key) {
        case ' ':
        case 'k':
          e.preventDefault()
          togglePlay()
          break
        case 'ArrowRight':
          seekBy(e.shiftKey ? 60 : 10)
          break
        case 'ArrowLeft':
          seekBy(e.shiftKey ? -60 : -10)
          break
        case 'ArrowUp':
          if (videoRef.current) videoRef.current.volume = Math.min(1, videoRef.current.volume + 0.1)
          break
        case 'ArrowDown':
          if (videoRef.current) videoRef.current.volume = Math.max(0, videoRef.current.volume - 0.1)
          break
        case 'f':
          toggleFullscreen()
          break
        case 'm':
          if (videoRef.current) videoRef.current.muted = !videoRef.current.muted
          break
        case 'c':
          setTextTrackIndex((i) => (i === null ? (plan?.subtitles.find((s) => s.url)?.index ?? null) : null))
          break
        case 'n':
          goToId(nextId)
          break
        case 'p':
          goToId(previousId)
          break
        // j/l alongside the arrows: the convention every video site shares.
        case 'j':
          seekBy(-10)
          break
        case 'l':
          seekBy(10)
          break
        case 's':
          if (skipTargetRef.current) doSkip()
          break
        case '<':
        case ',':
          setSpeed((v) => SPEEDS[Math.max(0, SPEEDS.indexOf(v) - 1)] ?? v)
          break
        case '>':
        case '.':
          setSpeed((v) => SPEEDS[Math.min(SPEEDS.length - 1, SPEEDS.indexOf(v) + 1)] ?? v)
          break
        case '0':
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
          if (absoluteDuration > 0) seekAbsolute((Number(e.key) / 10) * absoluteDuration)
          break
        // Shift, because a bare `p` is already "previous episode".
        case 'P':
          togglePip()
          break
        case 'i':
          setShowStats((v) => !v)
          break
        case 'Escape':
          if (menu !== 'none') setMenu('none')
          else if (!document.fullscreenElement) navigate(-1)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // `togglePip` and not `pip`: the hook returns a fresh object every render,
    // which would tear down and re-add this listener on every timeupdate.
  }, [togglePlay, seekBy, toggleFullscreen, nudgeActivity, navigate, plan, nextId, previousId, goToId, menu, togglePip])

  /*
    Apply a subtitle chosen on the detail page. Which mechanism depends on the
    track: text subtitles attach client-side, image ones (PGS/VOBSUB) have to be
    burned in by the server, which costs a reload.
  */
  const requestedSub = numberParam('subtitle')
  const seededSubRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!plan || requestedSub == null) return
    if (seededSubRef.current === plan.mediaSource.Id) return
    seededSubRef.current = plan.mediaSource.Id ?? undefined
    const track = plan.subtitles.find((s) => s.index === requestedSub)
    if (!track) return
    if (track.url) setTextTrackIndex(track.index)
    else setBurnedSubIndex(track.index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  // Honour "subtitles on by default", unless the detail page already chose.
  useEffect(() => {
    if (!plan || !settings.subtitlesDefault || requestedSub != null) return
    const preferred =
      plan.subtitles.find((s) => s.isDefault && s.url) ?? plan.subtitles.find((s) => s.url)
    if (preferred) setTextTrackIndex(preferred.index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan])

  // Apply the chosen subtitle track to the <track> elements React rendered.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    Array.from(v.textTracks).forEach((track) => {
      const idx = Number(track.id)
      track.mode = textTrackIndex != null && idx === textTrackIndex ? 'showing' : 'disabled'
    })
  }, [textTrackIndex, plan])

  // Thumbnails for scrubbing. Absent unless the server has generated them for
  // this item, in which case the scrubber quietly shows just a timecode.
  const trickplay = useMemo(
    () => selectTrickplay(item, plan?.mediaSource.Id ?? undefined, 320),
    [item, plan],
  )

  /*
    Show the card only near the end, and only when there is somewhere to go.
    `absoluteDuration > 0` is what stops it flashing before metadata loads —
    an earlier `remaining > 0` did that too, but it also hid the card at exactly
    zero, which is the moment the countdown is supposed to advance.
  */
  const remaining = absoluteDuration - absoluteTime
  /*
    When to show it. Where the server has detected credits the card appears as
    they start, which is the moment the episode is actually over; everywhere
    else a fixed lead stands in. Both are capped, so a misdetected outro cannot
    park the card on screen for half the episode.
  */
  const upNextLead = useMemo(
    () => upNextLeadSeconds(absoluteDuration, creditsStartSeconds(segments.data)),
    [absoluteDuration, segments.data],
  )
  const upNextVisibleBase =
    Boolean(nextId) &&
    absoluteDuration > 0 &&
    remaining <= upNextLead &&
    dismissedUpNext !== item?.Id &&
    menu === 'none' &&
    !showStats

  /*
    Skip ranges. A server that has never run intro detection returns none, and
    everything below simply produces no button.
  */
  const skipTarget = segmentAt(segments.data, absoluteTime)
  const skipVisible =
    Boolean(skipTarget) &&
    dismissedSkip !== skipTarget?.key &&
    menu === 'none' &&
    !showStats &&
    // Up Next owns the end of the episode; two stacked prompts is one too many.
    !upNextVisibleBase

  const upNextVisible = upNextVisibleBase

  /*
    Marker data for the scrubber. Chapters come with the item; skip ranges come
    from the same segments the skip button uses, so the two always agree.
  */
  const chapterStarts = useMemo(
    () =>
      (item?.Chapters ?? [])
        .map((c, i) => ({
          start: ticksToSeconds(c.StartPositionTicks ?? 0),
          name: c.Name?.trim() || `Chapter ${i + 1}`,
        }))
        .sort((a, b) => a.start - b.start),
    [item?.Chapters],
  )
  const segmentRanges = useMemo(
    () =>
      usableSegments(segments.data).map((seg) => ({
        start: ticksToSeconds(seg.StartTicks ?? 0),
        end: ticksToSeconds(seg.EndTicks ?? 0),
      })),
    [segments.data],
  )

  skipTargetRef.current = skipTarget

  /*
    Auto-skip, when the viewer asked for it. Keyed on the segment so it fires
    once per range: without that, seeking back into an intro would skip it
    again and make the player feel like it was fighting you.
  */
  const autoSkippedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!skipVisible || !skipTarget) return
    if (!shouldAutoSkip(skipTarget, settings.autoSkipIntros)) return
    if (autoSkippedRef.current === skipTarget.key) return
    autoSkippedRef.current = skipTarget.key
    seekAbsolute(skipTarget.skipToSeconds)
  }, [skipVisible, skipTarget, settings.autoSkipIntros, seekAbsolute])

  /*
    Something to look at while the stream resolves. A transcode can take several
    seconds to hand over its first frame, and until then this was a black
    rectangle with a spinner on it.

    The browser drops the poster the instant a frame decodes, and puts it back
    on the `load()` in the attach effect's cleanup — so advancing an episode
    shows the next title's art rather than flashing black.

    The same art the Continue Watching row uses — that row is landscape, and
    `MediaCard` resolves landscape to exactly this pair. Matching it means the
    card you clicked and the frame it opens into show the same picture, and
    16:9 art fills a 16:9 player with no bars.

    `backdropUrl` leads with curated Thumb art before any backdrop, and only
    reaches an episode's own screenshot once nothing else exists — so this is
    still cover art in every case where the library has some.
  */
  const posterImage = useMemo(
    () => (item ? (api.backdropUrl(item, 1280) ?? api.posterUrl(item, 780) ?? undefined) : undefined),
    [api, item],
  )

  const asMessage = (e: unknown) => (e instanceof Error ? e.message : null)
  const failure = error ?? asMessage(playable.error) ?? asMessage(streamQuery.error) ?? null

  const title = item ? displayTitle(item) : ''
  const sub = item && item.Type === 'Episode' ? `${episodeCode(item) ?? ''} · ${item.Name}` : null
  const activeSubtitle = plan?.subtitles.find(
    (s) => s.index === (burnedSubIndex ?? textTrackIndex),
  )

  return (
    <div
      className="relative h-dvh w-full select-none overflow-hidden bg-black"
      /*
        Pointer events and not `onMouseMove`: a browser fires a compatibility
        `mousemove` after every touch tap, which summoned the controls again a
        fraction of a second before the tap gesture asked to hide them. They
        flickered and stayed. `pointerType` is the only thing that tells the
        two apart.
      */
      onPointerMove={(e) => (e.pointerType === 'mouse' ? nudgeActivity() : nudgeOnTouch())}
      onPointerDown={(e) => {
        if (e.pointerType !== 'mouse') nudgeOnTouch()
      }}
      style={{ cursor: showControls ? 'default' : 'none' }}
    >
      <video
        ref={videoRef}
        className={`h-full w-full ${
          aspect === 'fill' ? 'object-cover' : aspect === 'stretch' ? 'object-fill' : 'object-contain'
        }`}
        playsInline
        autoPlay
        poster={posterImage}
        /* `touch-manipulation` is what stops a double tap zooming the page
           instead of seeking. */
        style={{ touchAction: 'manipulation' }}
        onPointerUp={(e) => (menu === 'none' ? onVideoPointerUp(e) : setMenu('none'))}
        crossOrigin="anonymous"
      >
        {plan?.subtitles
          .filter((s) => s.url)
          .map((s) => (
            <track
              key={s.index}
              id={String(s.index)}
              kind="subtitles"
              src={s.url}
              srcLang={s.language ?? 'und'}
              label={s.label}
            />
          ))}
      </video>

      {(playable.isLoading || streamQuery.isLoading || waiting) && !failure && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/70">
          <div className="size-14 animate-spin rounded-full border-3 border-white/20 border-t-accent" />
        </div>
      )}

      {/*
        Acknowledgement for a double tap. Deliberately on the side that was
        tapped rather than centre-screen: it confirms the gesture was read as
        "the right edge", which is the part people get wrong at first.
      */}
      {seekFlash && (
        <div
          key={seekFlash.key}
          className={`pointer-events-none absolute top-1/2 z-20 flex -translate-y-1/2 animate-[seek-flash_650ms_ease-out_forwards] items-center gap-2 rounded-full bg-black/60 px-4 py-2.5 text-sm font-semibold backdrop-blur ${
            seekFlash.zone === 'left' ? 'left-6' : 'right-6'
          }`}
        >
          <Skip10Icon className="size-6" back={seekFlash.seconds < 0} />
          {Math.abs(seekFlash.seconds)}s
        </div>
      )}

      {failure && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="max-w-lg text-white/80">{failure}</p>
          <p className="max-w-lg text-xs text-white/40">
            If this keeps happening, the Jellyfin server log will name the cause.
          </p>
          <button
            onClick={() => navigate(-1)}
            className="rounded bg-white px-5 py-2 text-sm font-semibold text-black"
          >
            Go back
          </button>
        </div>
      )}

      {/*
        Up next. Held back until the episode is nearly over, hidden once
        dismissed, and never shown while the menus are open — the countdown
        should not appear over something the viewer is reading.
      */}
      {/*
        Sits above the control bar so it never covers the scrubber, and to the
        right where a thumb reaches it — the same corner every streaming app
        puts it, because muscle memory is the whole point.
      */}
      {skipVisible && skipTarget && (
        <div className="pointer-events-none absolute bottom-28 right-4 z-30 sm:bottom-32 sm:right-8">
          <button
            onClick={doSkip}
            onContextMenu={(e) => {
              e.preventDefault()
              setDismissedSkip(skipTarget.key)
            }}
            className="pointer-events-auto rounded bg-white/95 px-6 py-2.5 text-sm font-bold text-black shadow-2xl transition hover:bg-white"
          >
            {skipTarget.label}
          </button>
        </div>
      )}

      {upNextVisible && nextEpisode.data && (
        <UpNext
          next={nextEpisode.data}
          secondsLeft={absoluteDuration - absoluteTime}
          windowSeconds={upNextLead}
          autoplay={settings.autoplayNext && repeat !== 'one'}
          onPlay={() => goToId(nextId)}
          onDismiss={() => setDismissedUpNext(item?.Id ?? null)}
        />
      )}

      {showStats && plan && (
        <StatsPanel
          plan={plan}
          video={videoRef.current}
          selectedAudioIndex={audioIndex}
          bufferedAhead={Math.max(0, buffered - currentTime)}
          segments={segments.data}
          onClose={() => setShowStats(false)}
        />
      )}

      {/* ----------------------------------------------------------- chrome */}
      <div
        /*
          `invisible` and not just `opacity-0`: the bars keep `pointer-events:
          auto` so their buttons stay clickable, which meant a hidden control
          bar was still swallowing taps aimed at the video behind it — the
          bottom one covers the whole thumb-rest of a phone screen. Visibility
          transitions discretely, so it holds until the fade finishes.
        */
        className={`pointer-events-none absolute inset-0 flex flex-col justify-between transition-[opacity,visibility] duration-300 ${
          showControls ? 'visible opacity-100' : 'invisible opacity-0'
        }`}
      >
        <div className="pointer-events-auto bg-gradient-to-b from-black/80 to-transparent px-4 pb-16 pt-4 sm:px-8">
          <div className="flex items-start gap-4">
            <button
              onClick={() => navigate(-1)}
              aria-label="Back"
              className="rounded-full p-2 transition hover:bg-white/10"
            >
              <BackIcon className="size-7" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-semibold sm:text-2xl">{title}</h1>
              {sub && <p className="truncate text-sm text-white/60">{sub}</p>}
            </div>

            {shuffle && (
              <button
                onClick={() => {
                  clearQueue()
                  setShuffleCleared((n) => n + 1)
                }}
                title="Stop shuffling and return to episode order"
                className="ml-auto shrink-0 rounded-full border border-accent/50 px-3 py-1.5 text-[11px] font-medium text-accent transition hover:bg-accent/10"
              >
                Shuffling {shuffle.position}/{shuffle.total} · stop
              </button>
            )}
          </div>
        </div>

        <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-5 pt-16 sm:px-8">
          <Scrubber
            current={absoluteTime}
            duration={absoluteDuration}
            buffered={buffered + offset}
            onSeek={seekAbsolute}
            chapters={chapterStarts}
            ranges={segmentRanges}
            preview={
              item?.Id && trickplay
                ? (seconds) =>
                    trickplaySprite(api, item.Id!, trickplay, seconds, plan?.mediaSource.Id ?? undefined)
                : undefined
            }
          />

          <div className="mt-2 flex items-center gap-1 sm:gap-2.5">
            {previousId && (
              <IconButton onClick={() => goToId(previousId)} label="Previous episode">
                <NextTrackIcon className="size-6" back />
              </IconButton>
            )}
            <IconButton onClick={() => seekBy(-10)} label="Back 10 seconds">
              <Skip10Icon className="size-7" back />
            </IconButton>
            {/* Play sits between the two skips — the seek pair reads as a unit
                around it, the way most players lay this row out. */}
            <IconButton onClick={togglePlay} label={paused ? 'Play' : 'Pause'}>
              {paused ? <PlayIcon className="size-7" /> : <PauseIcon className="size-7" />}
            </IconButton>
            <IconButton onClick={() => seekBy(10)} label="Forward 10 seconds">
              <Skip10Icon className="size-7" />
            </IconButton>
            {nextId && (
              <IconButton onClick={() => goToId(nextId)} label="Next episode">
                <NextTrackIcon className="size-6" />
              </IconButton>
            )}

            <div className="group/vol flex items-center gap-2">
              <IconButton
                onClick={() => {
                  const v = videoRef.current
                  if (v) v.muted = !v.muted
                }}
                label={muted ? 'Unmute' : 'Mute'}
              >
                {muted || volume === 0 ? (
                  <MuteIcon className="size-7" />
                ) : (
                  <VolumeIcon className="size-7" />
                )}
              </IconButton>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  const v = videoRef.current
                  if (!v) return
                  v.volume = Number(e.target.value)
                  v.muted = Number(e.target.value) === 0
                }}
                aria-label="Volume"
                className="scrubber h-1 w-0 rounded-full bg-white/25 opacity-0 transition-all duration-200 group-hover/vol:w-24 group-hover/vol:opacity-100"
                style={{
                  backgroundImage: `linear-gradient(to right, #fff ${(muted ? 0 : volume) * 100}%, rgba(255,255,255,0.25) ${(muted ? 0 : volume) * 100}%)`,
                }}
              />
            </div>

            <span className="ml-1 hidden text-xs tabular-nums text-white/70 sm:inline sm:text-sm">
              {formatTimecode(absoluteTime)}{' '}
              <span className="text-white/35">/ {formatTimecode(absoluteDuration)}</span>
            </span>

            <div className="ml-auto flex items-center gap-1 sm:gap-2">
              <IconButton
                onClick={() => setRepeat(repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off')}
                label={`Repeat: ${repeat}`}
                active={repeat !== 'off'}
              >
                <RepeatIcon className="size-6" one={repeat === 'one'} />
              </IconButton>

              {pip.supported && (
                <IconButton
                  onClick={pip.toggle}
                  label={pip.active ? 'Exit picture in picture' : 'Picture in picture'}
                  active={pip.active}
                >
                  <PipIcon className="size-6" active={pip.active} />
                </IconButton>
              )}

              {castAvailable && (
                <IconButton
                  onClick={() => videoRef.current?.remote?.prompt().catch(() => {})}
                  label="Cast to a device"
                >
                  <CastIcon className="size-6" />
                </IconButton>
              )}

              <SyncPlayMenu />

              <div className="relative">
                <IconButton
                  onClick={() => setMenu(menu === 'subtitles' ? 'none' : 'subtitles')}
                  label="Subtitles and audio"
                  active={textTrackIndex !== null || burnedSubIndex != null}
                >
                  <SubtitlesIcon className="size-7" />
                </IconButton>
                {menu === 'subtitles' && (
                  <Popover onClose={() => setMenu('none')}>
                    <MenuGroup title="Subtitles">
                      <MenuItem
                        active={textTrackIndex === null && burnedSubIndex == null}
                        onClick={() => {
                          setTextTrackIndex(null)
                          if (burnedSubIndex != null) reloadFrom(() => setBurnedSubIndex(undefined))
                          setMenu('none')
                        }}
                      >
                        Off
                      </MenuItem>
                      {plan?.subtitles.length === 0 && <MenuEmpty>No subtitle tracks</MenuEmpty>}
                      {plan?.subtitles.map((s) => (
                        <MenuItem
                          key={s.index}
                          active={(burnedSubIndex ?? textTrackIndex) === s.index}
                          onClick={() => {
                            if (s.url) {
                              // Text track: swap client-side, no reload needed.
                              if (burnedSubIndex != null)
                                reloadFrom(() => setBurnedSubIndex(undefined))
                              setTextTrackIndex(s.index)
                            } else {
                              // Image-based: the server has to burn it in.
                              setTextTrackIndex(null)
                              reloadFrom(() => setBurnedSubIndex(s.index))
                            }
                            setMenu('none')
                          }}
                          hint={s.url ? undefined : 'burn-in'}
                        >
                          {s.label}
                        </MenuItem>
                      ))}
                    </MenuGroup>

                    <MenuGroup title="Audio">
                      {plan?.audio.length === 0 && <MenuEmpty>No audio tracks</MenuEmpty>}
                      {plan?.audio.map((a) => {
                        const selected =
                          audioIndex != null ? audioIndex === a.index : a.isDefault
                        return (
                          <MenuItem
                            key={a.index}
                            active={selected}
                            onClick={() => {
                              reloadFrom(() => setAudioIndex(a.index))
                              setMenu('none')
                            }}
                            hint={a.channels ? `${a.channels}ch` : undefined}
                          >
                            {a.label}
                          </MenuItem>
                        )
                      })}
                    </MenuGroup>
                  </Popover>
                )}
              </div>

              <div className="relative">
                <IconButton
                  onClick={() => setMenu(menu === 'settings' ? 'none' : 'settings')}
                  label="Playback settings"
                >
                  <GearIcon className="size-6" />
                </IconButton>
                {menu === 'settings' && (
                  <Popover onClose={() => setMenu('none')}>
                    <MenuGroup title="Speed">
                      <div className="flex flex-wrap gap-1 px-3 py-1.5">
                        {SPEEDS.map((s) => (
                          <button
                            key={s}
                            onClick={() => setSpeed(s)}
                            className={`rounded px-2 py-1 text-xs tabular-nums transition ${
                              speed === s
                                ? 'bg-accent text-white'
                                : 'bg-white/8 text-white/70 hover:bg-white/15'
                            }`}
                          >
                            {s}×
                          </button>
                        ))}
                      </div>
                    </MenuGroup>

                    {chapterStarts.length > 1 && (
                      <MenuGroup title="Chapters">
                        <div className="max-h-56 overflow-y-auto">
                          {chapterStarts.map((c) => (
                            <MenuItem
                              key={c.start}
                              active={chapterAt(chapterStarts, absoluteTime) === c.name}
                              onClick={() => {
                                seekAbsolute(c.start)
                                setMenu('none')
                              }}
                            >
                              <span className="flex w-full items-center justify-between gap-3">
                                <span className="truncate">{c.name}</span>
                                <span className="shrink-0 text-[11px] tabular-nums text-white/40">
                                  {formatTimecode(c.start)}
                                </span>
                              </span>
                            </MenuItem>
                          ))}
                        </div>
                      </MenuGroup>
                    )}

                    <MenuGroup title="Quality">
                      <MenuItem
                        active={effectiveBitrate === 0}
                        onClick={() => reloadFrom(() => setBitrateOverride(0))}
                      >
                        Auto (no limit)
                      </MenuItem>
                      {BITRATE_OPTIONS.filter((o) => o.value > 0).map((o) => (
                        <MenuItem
                          key={o.value}
                          active={effectiveBitrate === o.value}
                          onClick={() => reloadFrom(() => setBitrateOverride(o.value))}
                        >
                          {o.label}
                        </MenuItem>
                      ))}
                    </MenuGroup>

                    <MenuGroup title="Aspect ratio">
                      {ASPECTS.map((a) => (
                        <MenuItem
                          key={a.value}
                          active={aspect === a.value}
                          onClick={() => setAspect(a.value)}
                          hint={a.hint}
                        >
                          {a.label}
                        </MenuItem>
                      ))}
                    </MenuGroup>

                    <MenuGroup title="Info">
                      <MenuItem
                        active={showStats}
                        onClick={() => {
                          setShowStats((v) => !v)
                          setMenu('none')
                        }}
                      >
                        Playback info
                      </MenuItem>
                    </MenuGroup>
                  </Popover>
                )}
              </div>

              <IconButton
                onClick={toggleFullscreen}
                label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              >
                {fullscreen ? (
                  <ExitFullscreenIcon className="size-7" />
                ) : (
                  <FullscreenIcon className="size-7" />
                )}
              </IconButton>
            </div>
          </div>

          {/* Quiet status line, so the active choices are visible without a menu. */}
          <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[11px] text-white/35">
            {speed !== 1 && <span>{speed}× speed</span>}
            {activeSubtitle && <span>Subtitles: {activeSubtitle.label}</span>}
            {repeat !== 'off' && <span>Repeat {repeat}</span>}
            {aspect !== 'fit' && <span>{aspect}</span>}
          </p>
        </div>
      </div>
    </div>
  )
}

// -------------------------------------------------------------- sub-components

function IconButton({
  onClick,
  label,
  active,
  children,
}: {
  onClick: () => void
  label: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`rounded-full p-1.5 transition hover:scale-110 hover:text-white ${
        active ? 'text-accent' : 'text-white/90'
      }`}
    >
      {children}
    </button>
  )
}

function Popover({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full right-0 z-20 mb-3 max-h-[60vh] w-64 overflow-y-auto rounded-lg border border-white/10 bg-black/95 py-1.5 backdrop-blur">
        {children}
      </div>
    </>
  )
}

function MenuGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/8 py-1 last:border-b-0">
      <p className="px-3 py-1 text-[11px] uppercase tracking-wide text-white/35">{title}</p>
      {children}
    </div>
  )
}

function MenuItem({
  active,
  hint,
  onClick,
  children,
}: {
  active: boolean
  hint?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-white/8 ${
        active ? 'text-white' : 'text-white/65'
      }`}
    >
      <span className={`size-1.5 shrink-0 rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`} />
      <span className="truncate">{children}</span>
      {hint && <span className="ml-auto shrink-0 text-[10px] text-white/30">{hint}</span>}
    </button>
  )
}

function MenuEmpty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 py-1.5 text-sm text-white/30">{children}</p>
}

function StatsPanel({
  plan,
  video,
  selectedAudioIndex,
  bufferedAhead,
  segments,
  onClose,
}: {
  plan: StreamPlan
  video: HTMLVideoElement | null
  selectedAudioIndex?: number
  bufferedAhead: number
  segments?: MediaSegment[]
  onClose: () => void
}) {
  const source = plan.mediaSource
  const videoStream = source.MediaStreams?.find((s) => s.Type === 'Video')
  const audioStreams = source.MediaStreams?.filter((s) => s.Type === 'Audio') ?? []
  // Report the track actually playing, not just the first one listed.
  const audioStream =
    (selectedAudioIndex != null
      ? audioStreams.find((s) => s.Index === selectedAudioIndex)
      : audioStreams.find((s) => s.IsDefault)) ?? audioStreams[0]
  const quality = video?.getVideoPlaybackQuality?.()

  // The server doesn't return transcode reasons on the media source; it encodes
  // them into the transcoding URL it hands back.
  const reasons = useMemo(() => {
    if (!source.TranscodingUrl) return []
    const query = source.TranscodingUrl.split('?')[1]
    if (!query) return []
    const raw = new URLSearchParams(query).get('TranscodeReasons')
    return raw ? raw.split(',').filter(Boolean) : []
  }, [source])

  const rows: [string, string | undefined][] = [
    ['Play method', plan.playMethod],
    ['Container', source.Container ?? undefined],
    [
      'Video',
      videoStream
        ? [videoStream.Codec?.toUpperCase(), videoStream.DisplayTitle].filter(Boolean).join(' · ')
        : undefined,
    ],
    [
      'Resolution',
      videoStream?.Width && videoStream.Height
        ? `${videoStream.Width}×${videoStream.Height}`
        : undefined,
    ],
    [
      'Video bitrate',
      videoStream?.BitRate ? `${(videoStream.BitRate / 1_000_000).toFixed(1)} Mbps` : undefined,
    ],
    [
      'Audio',
      audioStream
        ? [audioStream.Codec?.toUpperCase(), audioStream.Channels && `${audioStream.Channels}ch`]
            .filter(Boolean)
            .join(' · ')
        : undefined,
    ],
    ['Size', source.Size ? `${(source.Size / 1_000_000_000).toFixed(2)} GB` : undefined],
    ['Buffered ahead', `${bufferedAhead.toFixed(1)}s`],
    [
      'Dropped frames',
      quality ? `${quality.droppedVideoFrames} / ${quality.totalVideoFrames}` : undefined,
    ],
    ['Play session', plan.playSessionId?.slice(0, 12)],
  ]

  /*
    Whether anything has scanned this item for intros. Without this line a
    missing Skip button is indistinguishable from a library that no detection
    plugin has ever looked at, and there is nowhere else to find out.
  */
  rows.push([
    'Skip ranges',
    segments?.length
      ? segments
          .map((seg) => `${seg.Type ?? 'Segment'} @ ${formatTimecode((seg.StartTicks ?? 0) / 10_000_000)}`)
          .join(', ')
      : 'none — needs an intro-detection plugin',
  ])

  return (
    <div className="absolute right-4 top-20 z-30 w-80 rounded-lg border border-white/10 bg-black/90 p-4 text-xs backdrop-blur sm:right-8">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold uppercase tracking-wide text-white/70">Playback info</p>
        <button onClick={onClose} aria-label="Close playback info" className="text-white/40 hover:text-white">
          ✕
        </button>
      </div>
      <dl className="space-y-1">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex gap-3">
              <dt className="w-28 shrink-0 text-white/40">{k}</dt>
              <dd className="min-w-0 flex-1 truncate text-white/85">{v}</dd>
            </div>
          ))}
      </dl>
      {reasons.length > 0 && (
        <p className="mt-2 border-t border-white/10 pt-2 text-[11px] text-amber-300/80">
          Transcoding because: {reasons.join(', ')}
        </p>
      )}
    </div>
  )
}
