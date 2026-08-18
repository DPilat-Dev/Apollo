import { useEffect, useRef } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { scaleForDisplay } from './api'
import { artworkSizes, mediaMetadata, positionState } from './mediaSession'

interface Args {
  item?: BaseItemDto
  /** Square artwork at a given edge length, or null if the item has none. */
  artwork: (edge: number) => string | null
  paused: boolean
  /** Absolute position and duration, already adjusted for transcode offsets. */
  positionSeconds: number
  durationSeconds: number
  playbackRate: number
  onPlay: () => void
  onPause: () => void
  /** Absolute seconds, matching `positionSeconds`. */
  onSeekTo: (seconds: number) => void
  onSeekBy: (delta: number) => void
  onNext?: () => void
  onPrevious?: () => void
}

/** Handlers the browser may not know about; setting one throws if unsupported. */
const ACTIONS = [
  'play',
  'pause',
  'seekto',
  'seekbackward',
  'seekforward',
  'nexttrack',
  'previoustrack',
  'stop',
] as const

function setHandler(action: (typeof ACTIONS)[number], handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler)
  } catch {
    // An action this browser has never heard of. Nothing to do but skip it.
  }
}

/**
 * Publishes what is playing to the operating system.
 *
 * Without this a browser tab is invisible to the OS: the phone lock screen
 * shows nothing, the headphone play button does nothing, and the notification
 * shade has no artwork — all the things a native app gets for free.
 *
 * Every callback is held in a ref and read at call time. The handlers are
 * registered once per player and would otherwise have to be torn down and
 * rebuilt on each render, and re-registering `play` mid-playback makes some
 * OS widgets flicker their buttons.
 */
export function useMediaSession({
  item,
  artwork,
  paused,
  positionSeconds,
  durationSeconds,
  playbackRate,
  onPlay,
  onPause,
  onSeekTo,
  onSeekBy,
  onNext,
  onPrevious,
}: Args) {
  const supported = typeof navigator !== 'undefined' && 'mediaSession' in navigator

  const cbs = useRef({ onPlay, onPause, onSeekTo, onSeekBy, onNext, onPrevious })
  cbs.current = { onPlay, onPause, onSeekTo, onSeekBy, onNext, onPrevious }

  // ------------------------------------------------------------- metadata

  useEffect(() => {
    if (!supported || !item) return
    const meta = mediaMetadata(item, artworkSizes(artwork, scaleForDisplay))
    navigator.mediaSession.metadata = new MediaMetadata(meta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, item?.Id])

  // ---------------------------------------------------------------- state

  useEffect(() => {
    if (!supported) return
    navigator.mediaSession.playbackState = paused ? 'paused' : 'playing'
  }, [supported, paused])

  useEffect(() => {
    if (!supported || !('setPositionState' in navigator.mediaSession)) return
    const state = positionState(durationSeconds, positionSeconds, paused ? 1 : playbackRate)
    if (!state) return
    try {
      navigator.mediaSession.setPositionState(state)
    } catch {
      // Belt and braces: `positionState` already rejects everything the spec
      // rejects, but a browser disagreeing here must not break the clock.
    }
  }, [supported, durationSeconds, positionSeconds, playbackRate, paused])

  // ------------------------------------------------------------- handlers

  useEffect(() => {
    if (!supported) return

    setHandler('play', () => cbs.current.onPlay())
    setHandler('pause', () => cbs.current.onPause())
    setHandler('stop', () => cbs.current.onPause())
    setHandler('seekbackward', (d) => cbs.current.onSeekBy(-(d.seekOffset ?? 10)))
    setHandler('seekforward', (d) => cbs.current.onSeekBy(d.seekOffset ?? 10))
    setHandler('seekto', (d) => {
      if (typeof d.seekTime === 'number') cbs.current.onSeekTo(d.seekTime)
    })

    return () => {
      /*
        Leaving the player has to clear all of this. A stale handler keeps the
        OS showing an episode that is no longer playing, and its play button
        then calls into an unmounted tree.
      */
      for (const action of ACTIONS) setHandler(action, null)
      navigator.mediaSession.metadata = null
      navigator.mediaSession.playbackState = 'none'
    }
  }, [supported])

  /*
    Skip buttons are registered separately because they have to disappear at
    the ends of a series. A handler that is present but does nothing is worse
    than an absent one — the OS draws an enabled button either way.
  */
  const hasNext = Boolean(onNext)
  const hasPrevious = Boolean(onPrevious)
  useEffect(() => {
    if (!supported) return
    setHandler('nexttrack', hasNext ? () => cbs.current.onNext?.() : null)
    setHandler('previoustrack', hasPrevious ? () => cbs.current.onPrevious?.() : null)
  }, [supported, hasNext, hasPrevious])
}
