import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Hls from 'hls.js'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { useItem } from '../lib/queries'
import {
  resolveFirstEpisode,
  resolvePlayableItem,
  resolveSiblingEpisodes,
  resolveStream,
  type StreamPlan,
} from '../lib/playback'
import { useProgressReporter } from '../lib/useProgressReporter'
import { selectTrickplay, trickplaySprite } from '../lib/trickplay'
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

  const siblings = useQuery({
    queryKey: ['siblings', api.userId, item?.Id],
    queryFn: () => resolveSiblingEpisodes(api, item!),
    enabled: Boolean(item?.Id && item?.Type === 'Episode'),
    staleTime: 5 * 60 * 1000,
  })

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

    if (plan.isHls && Hls.isSupported()) {
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
    } else {
      // Safari plays HLS natively; direct/direct-stream is a plain file URL.
      video.src = plan.url
      video.addEventListener('loadedmetadata', seekToTarget, { once: true })
      void video.play().catch(() => {})
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

  // Playback rate is reset by every source change, so reapply it.
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

  useEffect(() => {
    const video = videoRef.current
    if (!video || !item) return

    const onEnded = async () => {
      if (repeat === 'one') {
        video.currentTime = 0
        void video.play().catch(() => {})
        return
      }
      const next = siblings.data?.next
      if (next && (repeat === 'all' || settings.autoplayNext)) return goTo(next)
      // End of the series with repeat-all on: wrap to the first episode.
      if (repeat === 'all' && !next) goTo(await resolveFirstEpisode(api, item).catch(() => null))
    }

    video.addEventListener('ended', onEnded)
    return () => video.removeEventListener('ended', onEnded)
  }, [api, item, repeat, settings.autoplayNext, siblings.data, goTo])

  // --------------------------------------------------------------- controls

  const togglePlay = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (v.paused) void v.play().catch(() => {})
    else v.pause()
  }, [])

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, Math.min(v.currentTime + delta, v.duration || Infinity))
  }, [])

  const seekAbsolute = useCallback(
    (absolute: number) => {
      const v = videoRef.current
      if (!v || !plan) return
      v.currentTime = Math.max(0, absolute - plan.startOffsetSeconds)
    },
    [plan],
  )

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
          goTo(siblings.data?.next)
          break
        case 'p':
          goTo(siblings.data?.previous)
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
  }, [togglePlay, seekBy, toggleFullscreen, nudgeActivity, navigate, plan, siblings.data, goTo, menu])

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
      onMouseMove={nudgeActivity}
      onTouchStart={nudgeActivity}
      style={{ cursor: showControls ? 'default' : 'none' }}
    >
      <video
        ref={videoRef}
        className={`h-full w-full ${
          aspect === 'fill' ? 'object-cover' : aspect === 'stretch' ? 'object-fill' : 'object-contain'
        }`}
        playsInline
        autoPlay
        onClick={() => (menu === 'none' ? togglePlay() : setMenu('none'))}
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
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="size-14 animate-spin rounded-full border-3 border-white/20 border-t-accent" />
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

      {showStats && plan && (
        <StatsPanel
          plan={plan}
          video={videoRef.current}
          selectedAudioIndex={audioIndex}
          bufferedAhead={Math.max(0, buffered - currentTime)}
          onClose={() => setShowStats(false)}
        />
      )}

      {/* ----------------------------------------------------------- chrome */}
      <div
        className={`pointer-events-none absolute inset-0 flex flex-col justify-between transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0'
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
          </div>
        </div>

        <div className="pointer-events-auto bg-gradient-to-t from-black/90 via-black/50 to-transparent px-4 pb-5 pt-16 sm:px-8">
          <Scrubber
            current={absoluteTime}
            duration={absoluteDuration}
            buffered={buffered + offset}
            onSeek={seekAbsolute}
            preview={
              item?.Id && trickplay
                ? (seconds) =>
                    trickplaySprite(api, item.Id!, trickplay, seconds, plan?.mediaSource.Id ?? undefined)
                : undefined
            }
          />

          <div className="mt-2 flex items-center gap-1 sm:gap-2.5">
            {siblings.data?.previous && (
              <IconButton onClick={() => goTo(siblings.data?.previous)} label="Previous episode">
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
            {siblings.data?.next && (
              <IconButton onClick={() => goTo(siblings.data?.next)} label="Next episode">
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

              {castAvailable && (
                <IconButton
                  onClick={() => videoRef.current?.remote?.prompt().catch(() => {})}
                  label="Cast to a device"
                >
                  <CastIcon className="size-6" />
                </IconButton>
              )}

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
            {plan && <span className="uppercase tracking-wide">{plan.playMethod}</span>}
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
  onClose,
}: {
  plan: StreamPlan
  video: HTMLVideoElement | null
  selectedAudioIndex?: number
  bufferedAhead: number
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

function Scrubber({
  current,
  duration,
  buffered,
  onSeek,
  preview,
}: {
  current: number
  duration: number
  buffered: number
  onSeek: (seconds: number) => void
  /** Returns the sprite covering a moment, when the server has thumbnails. */
  preview?: (seconds: number) => ReturnType<typeof trickplaySprite>
}) {
  const [hoverX, setHoverX] = useState<number | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const pct = duration > 0 ? (current / duration) * 100 : 0
  const bufferedPct = duration > 0 ? Math.min((buffered / duration) * 100, 100) : 0

  const hoverSeconds =
    hoverX != null && trackRef.current ? (hoverX / trackRef.current.clientWidth) * duration : null

  return (
    <div
      ref={trackRef}
      className="group/track relative h-6 cursor-pointer"
      onMouseMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        setHoverX(e.clientX - rect.left)
      }}
      onMouseLeave={() => setHoverX(null)}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(((e.clientX - rect.left) / rect.width) * duration)
      }}
    >
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25 transition-[height] duration-150 group-hover/track:h-1.5">
        <div className="absolute inset-y-0 left-0 bg-white/35" style={{ width: `${bufferedPct}%` }} />
        <div className="absolute inset-y-0 left-0 bg-accent" style={{ width: `${pct}%` }} />
      </div>

      <div
        className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent opacity-0 transition-opacity group-hover/track:opacity-100"
        style={{ left: `${pct}%` }}
      />

      {hoverSeconds != null && Number.isFinite(hoverSeconds) && (
        <ScrubPreview
          seconds={hoverSeconds}
          x={hoverX ?? 0}
          trackWidth={trackRef.current?.clientWidth ?? 0}
          preview={preview}
        />
      )}
    </div>
  )
}

/**
 * The tooltip that follows the cursor along the scrubber: a trickplay frame
 * where one exists, and the timecode either way.
 *
 * Clamped to the track so a preview near either end doesn't hang off-screen.
 */
function ScrubPreview({
  seconds,
  x,
  trackWidth,
  preview,
}: {
  seconds: number
  x: number
  trackWidth: number
  preview?: (seconds: number) => ReturnType<typeof trickplaySprite>
}) {
  const sprite = preview?.(seconds) ?? null
  const boxWidth = sprite?.width ?? 0
  const half = boxWidth / 2
  const left = boxWidth > 0 && trackWidth > 0 ? Math.min(Math.max(x, half), trackWidth - half) : x

  return (
    <div
      className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2"
      style={{ left: `${left}px` }}
    >
      {sprite && (
        <div
          className="mb-1 overflow-hidden rounded border border-white/20 bg-black shadow-2xl"
          style={{
            width: sprite.width,
            height: sprite.height,
            backgroundImage: `url("${sprite.url}")`,
            backgroundSize: sprite.backgroundSize,
            backgroundPosition: sprite.backgroundPosition,
            backgroundRepeat: 'no-repeat',
          }}
        />
      )}
      <span className="mx-auto block w-fit rounded bg-black/90 px-1.5 py-0.5 text-[11px] tabular-nums text-white">
        {formatTimecode(seconds)}
      </span>
    </div>
  )
}
