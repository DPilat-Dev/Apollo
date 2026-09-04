import { useEffect, useMemo, useRef } from 'react'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { useEpisodes } from '../lib/queries'
import { displayTitle, episodeCode } from '../lib/format'
import { blurhashBackground } from '../lib/blurhash'
import { jumpInQueue, moveInQueue, removeFromQueue, type PlayQueue } from '../lib/queue'
import { ChevronDown, TrashIcon } from './icons'
import { useDismissOnEscape } from '../lib/useDismissOnEscape'

/**
 * The running order, opened from the player.
 *
 * A shuffle is only trustworthy if you can see what it decided, and the moment
 * you can see it you want to argue with it — hence move and remove sitting on
 * every row rather than behind a second gesture.
 *
 * Reordering is explicit up/down buttons and not drag-and-drop on purpose.
 * This panel is used mid-episode, one-handed, over a video that is still
 * playing; a long-press-then-drag competes with the player's own press and tap
 * gestures and misfires constantly on a phone. Two 36px targets do not.
 *
 * Every edit goes through the pure functions in `lib/queue`, so the awkward
 * questions — what plays when you delete the episode you are watching, where
 * the playhead lands when something is moved past it — are answered once, in
 * one place, under test.
 */
export function QueuePanel({
  queue,
  currentId,
  onEdited,
  onPlay,
  onClose,
}: {
  queue: PlayQueue
  currentId?: string
  /** The queue lives in sessionStorage, so the player needs telling it moved. */
  onEdited: () => void
  onPlay: (id: string) => void
  onClose: () => void
}) {
  /*
    One request for the whole series rather than one per row: a shuffle queue
    is by definition a subset of its series' episodes, and the series page has
    usually cached this already.
  */
  const episodes = useEpisodes(queue.seriesId)
  const byId = useMemo(() => {
    const map = new Map<string, BaseItemDto>()
    for (const episode of episodes.data ?? []) if (episode.Id) map.set(episode.Id, episode)
    return map
  }, [episodes.data])

  useDismissOnEscape(onClose)

  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute bottom-full right-0 z-20 mb-3 flex max-h-[60vh] w-[21rem] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg border border-white/10 bg-black/95 backdrop-blur">
        <p className="shrink-0 border-b border-white/8 px-3 py-2 text-[11px] uppercase tracking-wide text-white/35">
          Queue · {queue.ids.length} episode{queue.ids.length === 1 ? '' : 's'}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {queue.ids.map((id, position) => (
            <QueueRow
              key={id}
              episode={byId.get(id)}
              position={position}
              current={id === queue.ids[queue.index]}
              first={position === 0}
              last={position === queue.ids.length - 1}
              onJump={() => {
                const to = jumpInQueue(currentId, id)
                onEdited()
                if (to && to !== currentId) onPlay(to)
                onClose()
              }}
              onMove={(delta) => {
                moveInQueue(currentId, id, delta)
                onEdited()
              }}
              onRemove={() => {
                const to = removeFromQueue(currentId, id)
                onEdited()
                if (to && to !== currentId) onPlay(to)
              }}
            />
          ))}
        </div>
      </div>
    </>
  )
}

function QueueRow({
  episode,
  position,
  current,
  first,
  last,
  onJump,
  onMove,
  onRemove,
}: {
  /** Missing when the episode has left the library since the queue was built. */
  episode?: BaseItemDto
  position: number
  current: boolean
  first: boolean
  last: boolean
  onJump: () => void
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  const api = useApi()
  const still = episode ? api.stillUrl(episode, 240) : null

  /*
    A shuffle of forty episodes opens somewhere in the middle, and scrolling
    to find where you are is the first thing anyone would do by hand.
  */
  const row = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (current) row.current?.scrollIntoView({ block: 'center' })
  }, [current])

  return (
    <div
      ref={row}
      className={`flex items-center gap-2 px-2 py-1.5 transition ${
        current ? 'bg-white/8' : 'hover:bg-white/5'
      }`}
    >
      <button
        onClick={onJump}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        title={current ? 'Playing now' : 'Play this next'}
      >
        <span
          className={`w-4 shrink-0 text-right text-[11px] tabular-nums ${
            current ? 'text-accent' : 'text-white/30'
          }`}
        >
          {position + 1}
        </span>
        <span className="aspect-video w-14 shrink-0 overflow-hidden rounded bg-ink-card">
          {episode && still && (
            <img
              src={still}
              alt=""
              loading="lazy"
              decoding="async"
              style={blurhashBackground(episode, still)}
              className="h-full w-full object-cover"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span
            className={`block truncate text-xs font-medium ${current ? 'text-accent' : 'text-white/85'}`}
          >
            {episode ? (episodeCode(episode) ?? displayTitle(episode)) : 'No longer in the library'}
          </span>
          <span className="block truncate text-[11px] text-white/45">
            {current ? 'Playing now' : (episode?.Name ?? 'Remove it to skip past it')}
          </span>
        </span>
      </button>

      <span className="flex shrink-0 items-center">
        <RowButton label="Move up" disabled={first} onClick={() => onMove(-1)}>
          <ChevronDown className="size-4 rotate-180" />
        </RowButton>
        <RowButton label="Move down" disabled={last} onClick={() => onMove(1)}>
          <ChevronDown className="size-4" />
        </RowButton>
        <RowButton label="Remove from queue" onClick={onRemove}>
          <TrashIcon className="size-4" />
        </RowButton>
      </span>
    </div>
  )
}

/**
 * Deliberately larger than the glyph inside it: these get pressed with a thumb
 * on a phone held in landscape, where a 16px hit area is a coin toss.
 */
function RowButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex size-9 items-center justify-center rounded text-white/55 transition hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-20"
    >
      {children}
    </button>
  )
}
