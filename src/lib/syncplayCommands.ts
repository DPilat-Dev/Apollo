import { delayUntil } from './timeSync'

/** A `SendCommand` as it arrives over the socket. */
export interface SendCommand {
  Command?: string
  When?: string
  PositionTicks?: number
  PlaylistItemId?: string
  EmittedAt?: string
}

export type SyncAction = 'play' | 'pause' | 'stop' | 'seek'

export interface CommandPlan {
  action: SyncAction
  /** Wait this long, on the local clock, before acting. */
  delayMs: number
  /** Where the group expects playback to be, in seconds. */
  positionSeconds: number
}

const TICKS_PER_SECOND = 10_000_000

/**
 * Turns a server command into something to do, and when to do it.
 *
 * Kept separate from the player so the timing rules can be tested without a
 * video element: the schedule is the part that has to be right, since every
 * device is deciding independently and they only stay together if they all
 * land on the same instant.
 */
export function planCommand(
  command: SendCommand,
  offsetMs: number,
  now = Date.now(),
): CommandPlan | null {
  const action = normaliseAction(command.Command)
  if (!action) return null

  return {
    action,
    delayMs: command.When ? delayUntil(command.When, offsetMs, now) : 0,
    positionSeconds: Math.max(0, (command.PositionTicks ?? 0) / TICKS_PER_SECOND),
  }
}

function normaliseAction(command: string | undefined): SyncAction | null {
  switch (command) {
    case 'Unpause':
    case 'Play':
      return 'play'
    case 'Pause':
      return 'pause'
    case 'Stop':
      return 'stop'
    case 'Seek':
      return 'seek'
    default:
      return null
  }
}

export const secondsToTicks = (seconds: number) =>
  Math.max(0, Math.round(seconds * TICKS_PER_SECOND))
