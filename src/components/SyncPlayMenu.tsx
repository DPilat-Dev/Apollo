import { useEffect, useState } from 'react'
import { useSyncPlay } from '../lib/syncplay'
import { SyncPlayIcon } from './icons'

/**
 * Group controls for the player.
 *
 * Deliberately small: create a group, join one, leave. Everything about
 * playback itself is already the group's, so there is nothing else to put here
 * — the transport buttons change behaviour rather than gaining new controls.
 */
export function SyncPlayMenu() {
  const sync = useSyncPlay()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) void sync?.refreshGroups()
  }, [open, sync])

  if (!sync) return null

  const { group, groups, connected, offsetMs, error } = sync
  const inGroup = Boolean(group)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={inGroup ? `SyncPlay: in ${group?.GroupName ?? 'a group'}` : 'SyncPlay'}
        title="Watch together"
        className={`relative p-1.5 transition ${
          inGroup ? 'text-accent' : 'text-white/80 hover:text-white'
        }`}
      >
        <SyncPlayIcon className="size-5" />
        {inGroup && (
          <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-accent ring-2 ring-black/60" />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-0" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full right-0 z-10 mb-3 w-72 rounded-lg border border-white/10 bg-ink-soft/98 p-3 shadow-2xl backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold">Watch together</p>
              <span
                className={`text-[11px] ${connected ? 'text-emerald-400' : 'text-white/35'}`}
                title={
                  offsetMs === null
                    ? 'Measuring the clock difference with the server'
                    : `Clock offset ${Math.round(offsetMs)} ms`
                }
              >
                {connected ? 'connected' : 'connecting…'}
              </span>
            </div>

            {error && (
              <p className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100/90">
                {error}
              </p>
            )}

            {inGroup ? (
              <>
                <p className="text-xs text-white/70">
                  In <span className="font-semibold text-white">{group?.GroupName ?? 'group'}</span>
                  {group?.State && <span className="text-white/40"> · {group.State}</span>}
                </p>
                {group?.Participants && group.Participants.length > 0 && (
                  <p className="mt-1 line-clamp-2 text-[11px] text-white/45">
                    {group.Participants.join(', ')}
                  </p>
                )}
                <p className="mt-2 text-[11px] text-white/40">
                  Play, pause and seek now apply to everyone in the group.
                </p>
                <button
                  onClick={() => void sync.leaveGroup()}
                  className="mt-3 w-full rounded border border-white/20 px-3 py-1.5 text-xs transition hover:border-white/50"
                >
                  Leave group
                </button>
              </>
            ) : (
              <>
                {groups.length > 0 ? (
                  <div className="mb-3 max-h-40 overflow-y-auto">
                    {groups.map((g) => (
                      <button
                        key={g.GroupId}
                        onClick={() => g.GroupId && void sync.joinGroup(g.GroupId)}
                        className="block w-full rounded px-2 py-1.5 text-left text-xs transition hover:bg-white/8"
                      >
                        <span className="font-medium text-white/90">{g.GroupName}</span>
                        <span className="ml-1.5 text-white/40">
                          {g.Participants?.length ?? 0} watching
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mb-3 text-[11px] text-white/40">No groups open right now.</p>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    const trimmed = name.trim()
                    if (!trimmed) return
                    void sync.createGroup(trimmed).then(() => setName(''))
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="New group name"
                    className="min-w-0 flex-1 rounded border border-white/15 bg-white/5 px-2 py-1.5 text-xs outline-none placeholder:text-white/30 focus:border-white/40"
                  />
                  <button
                    type="submit"
                    disabled={!name.trim()}
                    className="shrink-0 rounded bg-accent px-3 py-1.5 text-xs font-semibold transition hover:bg-accent-hot disabled:opacity-40"
                  >
                    Create
                  </button>
                </form>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
