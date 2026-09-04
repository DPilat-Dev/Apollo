import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { displayTitle } from '../lib/format'
import { CastIcon, PauseIcon, PlayIcon, NextTrackIcon } from './icons'
import { useDismissOnEscape } from '../lib/useDismissOnEscape'

/**
 * Plays something on another device signed in to the same server.
 *
 * Distinct from the Cast button, which is the browser's own Remote Playback
 * API and talks to a Chromecast. This drives another *Jellyfin* client — a TV,
 * a phone, the official app in another room — through the server.
 */
export function RemoteControl({
  item,
  openedFromMenu = false,
  onClose,
}: {
  item?: BaseItemDto
  /*
    Opened by the item's overflow menu rather than by its own button. The
    trigger is dropped in that case: the menu that opened it *was* the trigger,
    and a second cast button appearing beside the panel is a control that
    cannot be pressed to any effect.
  */
  openedFromMenu?: boolean
  onClose?: () => void
}) {
  const api = useApi()
  const [open, setOpen] = useState(openedFromMenu)
  const [target, setTarget] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sessions = useQuery({
    queryKey: ['controllableSessions'],
    queryFn: () => api.controllableSessions(),
    // Only poll while the picker is open; a background poll every few seconds
    // for a panel nobody is looking at is pure noise on the server.
    refetchInterval: open ? 5000 : false,
    enabled: open,
    staleTime: 0,
  })

  const devices = sessions.data ?? []
  const active = devices.find((s) => s.Id === target) ?? null

  // A device that goes away should not leave the panel driving a ghost.
  useEffect(() => {
    if (target && !sessions.isLoading && !devices.some((s) => s.Id === target)) setTarget(null)
  }, [devices, target, sessions.isLoading])

  const run = (fn: () => Promise<unknown>) => {
    setError(null)
    void fn().catch((e) =>
      setError(e instanceof Error ? e.message : 'That device did not accept the command.'),
    )
  }

  const dismiss = () => {
    setOpen(false)
    onClose?.()
  }

  // Escape leaves the picker exactly as the backdrop does.
  useDismissOnEscape(dismiss)

  return (
    <div className="relative">
      {!openedFromMenu && (
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="Play on another device"
          title="Play on another device"
          className={`p-1.5 transition ${active ? 'text-accent' : 'text-white/80 hover:text-white'}`}
        >
          <CastIcon className="size-5" />
        </button>
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-0" onClick={dismiss} />
          <div className={`absolute z-10 mt-2 w-72 ${openedFromMenu ? 'left-0' : 'right-0'} rounded-lg border border-white/10 bg-ink-soft/98 p-3 shadow-2xl backdrop-blur`}>
            <p className="mb-2 text-sm font-semibold">Play on another device</p>

            {error && (
              <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100/90">
                {error}
              </p>
            )}

            {sessions.isLoading && <p className="text-xs text-white/40">Looking…</p>}

            {!sessions.isLoading && devices.length === 0 && (
              <p className="text-xs text-white/40">
                No other devices are signed in right now. Open Jellyfin on a TV or phone and it
                will appear here.
              </p>
            )}

            <div className="max-h-52 overflow-y-auto">
              {devices.map((s) => (
                <button
                  key={s.Id}
                  onClick={() => setTarget(s.Id ?? null)}
                  className={`block w-full rounded px-2 py-2 text-left transition ${
                    target === s.Id ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                >
                  <span className="block truncate text-sm text-white/90">
                    {s.DeviceName ?? 'Device'}
                  </span>
                  <span className="block truncate text-[11px] text-white/40">
                    {[s.Client, s.UserName].filter(Boolean).join(' · ')}
                    {s.NowPlayingItem && ` — ${displayTitle(s.NowPlayingItem)}`}
                  </span>
                </button>
              ))}
            </div>

            {active && (
              <div className="mt-3 border-t border-white/10 pt-3">
                {item?.Id && (
                  <button
                    onClick={() =>
                      run(() =>
                        api.remotePlay(active.Id!, [item.Id!], {
                          startPositionTicks: item.UserData?.PlaybackPositionTicks ?? undefined,
                        }),
                      )
                    }
                    className="mb-2 flex w-full items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-sm font-semibold transition hover:bg-accent-hot"
                  >
                    <PlayIcon className="size-4" />
                    Play “{displayTitle(item)}” here
                  </button>
                )}

                <div className="flex items-center justify-center gap-1">
                  <button
                    onClick={() => run(() => api.remoteCommand(active.Id!, 'PreviousTrack'))}
                    aria-label="Previous"
                    className="rounded p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                  >
                    <NextTrackIcon className="size-4 rotate-180" />
                  </button>
                  <button
                    onClick={() => run(() => api.remoteCommand(active.Id!, 'PlayPause'))}
                    aria-label="Play or pause"
                    className="rounded p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                  >
                    {active.PlayState?.IsPaused ? (
                      <PlayIcon className="size-4" />
                    ) : (
                      <PauseIcon className="size-4" />
                    )}
                  </button>
                  <button
                    onClick={() => run(() => api.remoteCommand(active.Id!, 'NextTrack'))}
                    aria-label="Next"
                    className="rounded p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
                  >
                    <NextTrackIcon className="size-4" />
                  </button>
                  <button
                    onClick={() => run(() => api.remoteCommand(active.Id!, 'Stop'))}
                    className="ml-1 rounded border border-white/20 px-2 py-1 text-[11px] text-white/70 transition hover:border-white/45"
                  >
                    Stop
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
