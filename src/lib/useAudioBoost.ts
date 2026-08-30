import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { boostGain, sourceSafety } from './audioBoost'

/**
 * The WebAudio graph behind the boost: source -> gain -> destination.
 *
 * Nearly all of this file is about the one-way doors WebAudio puts in the way,
 * because every one of them fails as *silence* rather than as an error:
 *
 *  - `createMediaElementSource` may be called once per element for the lifetime
 *    of that element. A second call throws, and worse, the element's audio is
 *    already captured by then. The graphs therefore live in a module-level
 *    WeakMap keyed by the element rather than in a ref, so a remount, a
 *    StrictMode double-effect or a stream reload cannot ask twice. The player
 *    swaps `video.src` on every quality and audio-track change and the graph
 *    simply stays wired to the element across all of it.
 *
 *  - Capturing an element hands its audio to the graph *permanently*. There is
 *    no uncapture: disconnecting the source silences the element instead of
 *    releasing it, and closing the context silences it too. So teardown here
 *    means "set the gain back to 1 and leave everything connected", and nothing
 *    is ever built speculatively — the graph is created the first time someone
 *    actually asks for more than 100%, and never for the plain volume path.
 *
 *  - A media resource that is not CORS-clean produces silence through the
 *    graph, with no event to catch. `crossOrigin="anonymous"` on the element is
 *    supposed to make that impossible (the load would fail outright instead),
 *    but the consequence of being wrong is unrecoverable dead audio for the
 *    rest of the session, so the source is verified before it is captured.
 *
 *  - An AudioContext starts suspended until a gesture. Capturing an element
 *    into a suspended context is the same dead audio, so the context is
 *    resumed *first* and the graph is only built once it is actually running.
 */

interface Graph {
  ctx: AudioContext
  gain: GainNode
  compressor: DynamicsCompressorNode
  /** Whether the compressor is currently in the path. */
  compressed: boolean
}

/**
 * Keyed by the element, not by the component, because the constraint being
 * defended is the element's. Weak so a discarded element takes its graph with
 * it — which is the only cleanup that is actually possible here.
 */
const graphs = new WeakMap<HTMLMediaElement, Graph>()

/**
 * One context for the whole app. Browsers cap the number of AudioContexts at
 * around six and we can never close one (see above), so a context per player
 * mount would run a viewer out of them in an evening of episode-hopping.
 */
let shared: AudioContext | null = null

function sharedContext(): AudioContext | null {
  if (shared) return shared
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  shared = new Ctor()
  return shared
}

/**
 * Whether this element's audio can be captured without going silent.
 *
 * The canvas probe is the only way to read the element's origin-clean flag from
 * script: `getImageData` throws on a tainted canvas for exactly the same reason
 * WebAudio would go quiet. It needs a decoded frame, so "not yet" and "never"
 * both answer false and the caller simply tries again later.
 */
function safeToCapture(video: HTMLVideoElement): boolean {
  if (sourceSafety(video.currentSrc || video.src, window.location.origin) === 'safe') return true
  if (video.readyState < 2 /* HAVE_CURRENT_DATA */) return false
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')
    if (!context) return false
    context.drawImage(video, 0, 0, 1, 1)
    context.getImageData(0, 0, 1, 1)
    return true
  } catch {
    return false
  }
}

function buildGraph(video: HTMLVideoElement, ctx: AudioContext): Graph | null {
  const existing = graphs.get(video)
  if (existing) return existing
  try {
    const source = ctx.createMediaElementSource(video)
    const gain = ctx.createGain()

    /*
      A compressor, but only in the path while boosting.

      Tripling the gain on something already mastered near full scale clips, and
      clipping is a nastier sound than the quiet dialogue that prompted the
      boost. These settings are a limiter rather than a compressor proper —
      a high ratio, a soft knee, and a threshold that leaves anything not
      already loud completely untouched — so the effect is inaudible until the
      peaks would otherwise have broken up.

      It sits on a switchable branch instead of permanently in the chain
      because the source can never be unwired: leaving it in would mean that
      touching the boost once colours the audio for the rest of the session,
      including all the way back down at 100%. The cost of switching is that
      the compressor's few milliseconds of lookahead come and go with it, which
      is an order of magnitude under anything a viewer can perceive as lip
      sync drift.
    */
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.value = -6
    compressor.knee.value = 12
    compressor.ratio.value = 12
    compressor.attack.value = 0.003
    compressor.release.value = 0.25

    source.connect(gain)
    gain.connect(ctx.destination)

    const graph: Graph = { ctx, gain, compressor, compressed: false }
    graphs.set(video, graph)
    return graph
  } catch {
    // Already captured by something else, or the element is in a state the
    // browser refuses. Either way the plain volume path is untouched.
    return null
  }
}

/** Move the gain node's output between the direct and compressed branches. */
function route(graph: Graph, compressed: boolean) {
  if (graph.compressed === compressed) return
  graph.gain.disconnect()
  if (compressed) {
    graph.gain.connect(graph.compressor)
    graph.compressor.connect(graph.ctx.destination)
  } else {
    graph.compressor.disconnect()
    graph.gain.connect(graph.ctx.destination)
  }
  graph.compressed = compressed
}

function apply(graph: Graph, gain: number) {
  // Ramped rather than assigned: a step change in gain is an audible click,
  // and dragging a slider produces a step change per pixel.
  const now = graph.ctx.currentTime
  graph.gain.gain.setTargetAtTime(gain, now, 0.015)
  route(graph, gain > 1)
}

export interface AudioBoostControl {
  /** The multiplier actually in effect. 1 means WebAudio is not in the path. */
  gain: number
  /** Ask for a multiplier. Call from a gesture — it may need to resume audio. */
  setGain: (gain: number) => void
  /** False when boosting cannot work right now, so the UI can stay honest. */
  available: boolean
  /** Why not, for a control that has to explain itself rather than just fail. */
  unavailableReason: 'casting' | 'unsupported' | null
}

export function useAudioBoost(videoRef: RefObject<HTMLVideoElement | null>): AudioBoostControl {
  const [gain, setGainState] = useState(1)
  const [remote, setRemote] = useState(false)
  const [blocked, setBlocked] = useState(false)

  // Read inside `engage`, which is kept stable so the effects below never
  // rebind — a ref rather than a dependency.
  const remoteRef = useRef(false)
  remoteRef.current = remote

  const engage = useCallback(
    async (value: number): Promise<boolean> => {
      const video = videoRef.current
      if (!video) return false

      let graph = graphs.get(video)
      if (!graph) {
        // Nothing above unity was asked for, so there is nothing worth taking
        // a one-way door for. This is the ordinary case and it stays on the
        // element's own volume.
        if (value <= 1) return true

        /*
          Never take that door while the media is being rendered on another
          device. The gain would not be in the path to hear anyway, and
          capturing an element mid-handoff to a Cast or AirPlay receiver is not
          a state worth discovering the hard way when it cannot be undone.
        */
        if (remoteRef.current) return false

        if (!safeToCapture(video)) {
          setBlocked(true)
          return false
        }
        const ctx = sharedContext()
        if (!ctx) {
          setBlocked(true)
          return false
        }
        if (ctx.state !== 'running') {
          try {
            await ctx.resume()
          } catch {
            // Falls through to the state check, which is the real answer.
          }
        }
        // Capturing into a context that never started would leave the viewer
        // with no sound and no way to get it back. Better to have no boost.
        if (ctx.state !== 'running') {
          setBlocked(true)
          return false
        }
        graph = buildGraph(video, ctx) ?? undefined
        if (!graph) {
          setBlocked(true)
          return false
        }
      } else if (graph.ctx.state !== 'running') {
        void graph.ctx.resume().catch(() => {})
      }

      apply(graph, value)
      setBlocked(false)
      return true
    },
    [videoRef],
  )

  const setGain = useCallback(
    (next: number) => {
      const value = boostGain(next)
      const video = videoRef.current
      const settled = value <= 1 || (video ? graphs.has(video) : false)

      /*
        When the graph is already there (or is not needed at all) `engage`
        applies the gain synchronously, so the displayed value can move with
        it. Only the very first push past 100% has to wait — it may need the
        audio context to resume first — and that one is left showing the old
        value until it is actually delivered, rather than showing a boost that
        might never arrive.
      */
      if (settled) setGainState(value)
      void engage(value).then((ok) => setGainState(ok ? value : 1))
    },
    [engage, videoRef],
  )

  /*
    Autoplay policy can suspend the context again long after it started —
    switching tabs on some builds is enough — and a suspended context with a
    captured element is total silence. Nothing here can force a resume without
    a gesture, so every gesture that reaches the document is used as one.
  */
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const resume = () => {
      const graph = graphs.get(video)
      if (graph && graph.ctx.state !== 'running') void graph.ctx.resume().catch(() => {})
    }

    // "Cannot verify this stream yet" and "cannot ever" look identical from
    // here, and the usual cause is simply that no frame has decoded. A new
    // stream is a new chance, so the refusal is not allowed to be permanent.
    const rearm = () => setBlocked(false)

    document.addEventListener('pointerdown', resume)
    document.addEventListener('keydown', resume)
    document.addEventListener('visibilitychange', resume)
    video.addEventListener('play', resume)
    video.addEventListener('loadeddata', rearm)
    return () => {
      document.removeEventListener('pointerdown', resume)
      document.removeEventListener('keydown', resume)
      document.removeEventListener('visibilitychange', resume)
      video.removeEventListener('play', resume)
      video.removeEventListener('loadeddata', rearm)
    }
  }, [videoRef])

  /*
    Casting and AirPlay render the media on the other device, which does its own
    mixing — the gain node is no longer between the file and the speakers, so
    the number on screen would be describing nothing. The control is withdrawn
    and the gain reset for the duration rather than left looking functional.

    Picture-in-Picture needs none of this: the floating window is a view of the
    same element and its audio still comes out of this page, through the graph,
    boost intact.
  */
  useEffect(() => {
    const video = videoRef.current
    if (!video || !('remote' in video) || !video.remote) return
    const target = video.remote

    const onConnect = () => {
      setRemote(true)
      const graph = graphs.get(video)
      if (graph) apply(graph, 1)
      setGainState(1)
    }
    const onDisconnect = () => setRemote(false)

    target.addEventListener('connecting', onConnect)
    target.addEventListener('connect', onConnect)
    target.addEventListener('disconnect', onDisconnect)
    setRemote(target.state === 'connected')
    return () => {
      target.removeEventListener('connecting', onConnect)
      target.removeEventListener('connect', onConnect)
      target.removeEventListener('disconnect', onDisconnect)
    }
  }, [videoRef])

  /*
    Leaving the player resets the gain but deliberately leaves the graph wired.
    Disconnecting it would not release the element — it would only mute it —
    and the next mount finds the same graph through the WeakMap and reuses it.
  */
  useEffect(() => {
    const video = videoRef.current
    return () => {
      if (!video) return
      const graph = graphs.get(video)
      if (graph) apply(graph, 1)
    }
  }, [videoRef])

  return {
    gain,
    setGain,
    available: !remote && !blocked,
    unavailableReason: remote ? 'casting' : blocked ? 'unsupported' : null,
  }
}
