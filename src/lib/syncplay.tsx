import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './auth'
import { JellyfinSocket, type SocketMessage } from './socket'
import { bestOffsetMs, sampleFromExchange, serverNow, type TimeSample } from './timeSync'
import { planCommand, secondsToTicks, type SendCommand } from './syncplayCommands'
import type { GroupInfoDto, JellyfinApi } from './api'

/**
 * SyncPlay: watching in step with other people.
 *
 * The server owns the timeline. This client never plays or pauses itself while
 * in a group — it asks the server, the server tells everyone when to act, and
 * everyone acts at that instant on their own corrected clock. Acting locally
 * first is what makes group playback drift apart.
 *
 * This first version follows the group and reports readiness. It does not yet
 * correct drift during playback.
 */

/** What the player exposes so the group can drive it. */
export interface SyncPlayerControls {
  play: () => void
  pause: () => void
  seekTo: (seconds: number) => void
  /** Current position in seconds, on the item's own timeline. */
  position: () => number
  isPlaying: () => boolean
  playlistItemId?: string
}

interface SyncPlayValue {
  /** The group this device is in, if any. */
  group: GroupInfoDto | null
  groups: GroupInfoDto[]
  connected: boolean
  /** Clock offset in ms; null until measured. */
  offsetMs: number | null
  error: string | null
  refreshGroups: () => Promise<void>
  createGroup: (name: string) => Promise<void>
  joinGroup: (groupId: string) => Promise<void>
  leaveGroup: () => Promise<void>
  /** Group-aware transport. Falls back to local control when not in a group. */
  requestPlay: () => void
  requestPause: () => void
  requestSeek: (seconds: number) => void
  registerPlayer: (controls: SyncPlayerControls | null) => void
  /**
   * Says whether this device is stalled. The group holds for whoever is
   * slowest, which is the whole point of watching together — without it a
   * device on a weak connection simply falls behind.
   */
  reportBuffering: (buffering: boolean) => void
}

const SyncPlayContext = createContext<SyncPlayValue | null>(null)

const CLOCK_SAMPLES = 5
const RESYNC_MS = 60_000

async function measureOffset(api: JellyfinApi): Promise<{ offsetMs: number; pingMs: number }> {
  const samples: TimeSample[] = []
  for (let i = 0; i < CLOCK_SAMPLES; i++) {
    const t0 = Date.now()
    try {
      const res = await api.utcTime()
      const sample = sampleFromExchange(
        t0,
        res.RequestReceptionTime,
        res.ResponseTransmissionTime,
        Date.now(),
      )
      if (sample) samples.push(sample)
    } catch {
      // A failed sample is not fatal; the others still give an estimate.
    }
  }
  const best = samples.reduce<TimeSample | null>(
    (b, s) => (!b || s.roundTripMs < b.roundTripMs ? s : b),
    null,
  )
  return { offsetMs: bestOffsetMs(samples), pingMs: (best?.roundTripMs ?? 0) / 2 }
}

export function SyncPlayProvider({ children }: { children: ReactNode }) {
  const { session, api } = useAuth()

  const [group, setGroup] = useState<GroupInfoDto | null>(null)
  const [groups, setGroups] = useState<GroupInfoDto[]>([])
  const [connected, setConnected] = useState(false)
  const [offsetMs, setOffsetMs] = useState<number | null>(null)

  const [error, setError] = useState<string | null>(null)

  const socketRef = useRef<JellyfinSocket | null>(null)
  const controlsRef = useRef<SyncPlayerControls | null>(null)
  const offsetRef = useRef<number>(0)
  const groupRef = useRef<GroupInfoDto | null>(null)
  const timers = useRef<number[]>([])

  groupRef.current = group

  const registerPlayer = useCallback((controls: SyncPlayerControls | null) => {
    controlsRef.current = controls
  }, [])

  const clearTimers = () => {
    for (const t of timers.current) window.clearTimeout(t)
    timers.current = []
  }

  /** Runs a command at the instant the group agreed on. */
  const runCommand = useCallback((command: SendCommand) => {
    const plan = planCommand(command, offsetRef.current)
    if (!plan) return

    const execute = () => {
      const controls = controlsRef.current
      if (!controls) return
      switch (plan.action) {
        case 'play':
          // Seek first: a device that joined mid-playback is elsewhere.
          if (Math.abs(controls.position() - plan.positionSeconds) > 1) {
            controls.seekTo(plan.positionSeconds)
          }
          controls.play()
          break
        case 'pause':
          controls.pause()
          controls.seekTo(plan.positionSeconds)
          break
        case 'seek':
          controls.seekTo(plan.positionSeconds)
          break
        case 'stop':
          controls.pause()
          break
      }
    }

    if (plan.delayMs <= 0) execute()
    else timers.current.push(window.setTimeout(execute, plan.delayMs))
  }, [])

  /** Tells the group where this device is, so it can wait or resume. */
  const report = useCallback(
    async (kind: 'ready' | 'buffering') => {
      const controls = controlsRef.current
      if (!api || !controls || !groupRef.current) return
      const state = {
        When: new Date(serverNow(offsetRef.current)).toISOString(),
        PositionTicks: secondsToTicks(controls.position()),
        IsPlaying: controls.isPlaying(),
        PlaylistItemId: controls.playlistItemId ?? '',
      }
      try {
        if (kind === 'ready') await api.syncPlayReady(state)
        else await api.syncPlayBuffering(state)
      } catch {
        // Reporting is best-effort; the group tolerates a missed update.
      }
    },
    [api],
  )

  const refreshGroups = useCallback(async () => {
    if (!api) return
    try {
      setGroups(await api.syncPlayGroups())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not list groups.')
    }
  }, [api])

  // ------------------------------------------------------------------ socket

  useEffect(() => {
    if (!session) return
    const socket = new JellyfinSocket(session)
    socketRef.current = socket

    const off = socket.on((message: SocketMessage) => {
      setConnected(true)
      if (message.MessageType === 'SyncPlayCommand') {
        runCommand(message.Data as SendCommand)
        return
      }
      if (message.MessageType !== 'SyncPlayGroupUpdate') return

      const update = message.Data as { Type?: string; GroupId?: string; Data?: unknown }
      switch (update.Type) {
        case 'GroupJoined':
          setGroup((update.Data as GroupInfoDto) ?? { GroupId: update.GroupId })
          setError(null)
          break
        case 'GroupLeft':
        case 'NotInGroup':
          setGroup(null)
          clearTimers()
          break
        case 'UserJoined':
        case 'UserLeft':
        case 'GroupDoesNotExist':
          void refreshGroups()
          break
        case 'StateUpdate': {
          const state = (update.Data as { State?: GroupInfoDto['State'] })?.State
          setGroup((g) => (g ? { ...g, State: state } : g))
          // The group is holding for slow devices; say whether we are one.
          if (state === 'Waiting') void report('ready')
          break
        }
        case 'LibraryAccessDenied':
          setError('That group is watching something you do not have access to.')
          break
      }
    })

    socket.connect()
    return () => {
      off()
      socket.close()
      socketRef.current = null
      setConnected(false)
      clearTimers()
    }
  }, [session, runCommand, refreshGroups, report])

  // ------------------------------------------------------------------- clock

  useEffect(() => {
    if (!api) return
    let cancelled = false

    const sync = async () => {
      const { offsetMs: measured, pingMs } = await measureOffset(api)
      if (cancelled) return
      offsetRef.current = measured
      setOffsetMs(measured)
      // The server compensates per device using this.
      if (groupRef.current) await api.syncPlayPing(pingMs).catch(() => {})
    }

    void sync()
    // Clocks drift, and a laptop that slept comes back wrong.
    const interval = window.setInterval(() => void sync(), RESYNC_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [api])

  // ------------------------------------------------------------------ groups

  const createGroup = useCallback(
    async (name: string) => {
      if (!api) return
      setError(null)
      try {
        await api.syncPlayNew(name)
        await refreshGroups()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create that group.')
      }
    },
    [api, refreshGroups],
  )

  const joinGroup = useCallback(
    async (groupId: string) => {
      if (!api) return
      setError(null)
      try {
        await api.syncPlayJoin(groupId)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not join that group.')
      }
    },
    [api],
  )

  const leaveGroup = useCallback(async () => {
    if (!api) return
    try {
      await api.syncPlayLeave()
    } catch {
      // Leaving locally matters more than the server acknowledging it.
    }
    setGroup(null)
    clearTimers()
  }, [api])

  /*
    In a group these ask the server and wait for the broadcast. Outside one they
    act directly, so the same controls work either way.
  */
  const requestPlay = useCallback(() => {
    if (!api || !groupRef.current) return controlsRef.current?.play()
    void api.syncPlayPlay().catch(() => controlsRef.current?.play())
  }, [api])

  const requestPause = useCallback(() => {
    if (!api || !groupRef.current) return controlsRef.current?.pause()
    void api.syncPlayPause().catch(() => controlsRef.current?.pause())
  }, [api])

  const requestSeek = useCallback(
    (seconds: number) => {
      if (!api || !groupRef.current) return controlsRef.current?.seekTo(seconds)
      void api
        .syncPlaySeek(secondsToTicks(seconds))
        .catch(() => controlsRef.current?.seekTo(seconds))
    },
    [api],
  )

  const reportBuffering = useCallback(
    (buffering: boolean) => {
      if (!groupRef.current) return
      void report(buffering ? 'buffering' : 'ready')
    },
    [report],
  )

  const value = useMemo<SyncPlayValue>(
    () => ({
      group,
      groups,
      connected,
      offsetMs,
      error,
      refreshGroups,
      createGroup,
      joinGroup,
      leaveGroup,
      requestPlay,
      requestPause,
      requestSeek,
      registerPlayer,
      reportBuffering,
    }),
    [
      group,
      groups,
      connected,
      offsetMs,
      error,
      refreshGroups,
      createGroup,
      joinGroup,
      leaveGroup,
      requestPlay,
      requestPause,
      requestSeek,
      registerPlayer,
      reportBuffering,
    ],
  )

  return <SyncPlayContext.Provider value={value}>{children}</SyncPlayContext.Provider>
}

export function useSyncPlay(): SyncPlayValue | null {
  return useContext(SyncPlayContext)
}
