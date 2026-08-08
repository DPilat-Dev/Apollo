import { useEffect, useMemo, useRef, useState } from 'react'
import { useApi } from '../../lib/auth'
import { useLogFile, useLogFiles } from '../../lib/queries'

/** Serilog's default line prefix: `[13:42:07] [ERR] [12] Component: message`. */
const LEVEL_RE = /\[(VRB|DBG|INF|WRN|ERR|FTL)\]/

const LEVEL_STYLE: Record<string, string> = {
  ERR: 'text-red-300',
  FTL: 'text-red-300',
  WRN: 'text-amber-300',
  INF: 'text-white/70',
  DBG: 'text-white/40',
  VRB: 'text-white/30',
}

export function LogsPanel() {
  const api = useApi()
  const files = useLogFiles()
  const [selected, setSelected] = useState<string | undefined>()
  const [filter, setFilter] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [follow, setFollow] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Open the newest log by default.
  useEffect(() => {
    if (!selected && files.data?.length) {
      const newest = [...files.data].sort((a, b) =>
        (b.DateModified ?? '').localeCompare(a.DateModified ?? ''),
      )[0]
      setSelected(newest?.Name ?? undefined)
    }
  }, [files.data, selected])

  const log = useLogFile(selected)

  const lines = useMemo(() => {
    if (!log.data) return []
    const all = log.data.split('\n')
    const needle = filter.trim().toLowerCase()
    return all.filter((l) => {
      if (errorsOnly && !/\[(ERR|FTL|WRN)\]/.test(l)) return false
      return needle ? l.toLowerCase().includes(needle) : true
    })
  }, [log.data, filter, errorsOnly])

  // Jump to the end on load, since the interesting part of a log is the tail.
  useEffect(() => {
    if (follow && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines, follow])

  return (
    <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white/70">Log files</h2>
          <button
            onClick={() => void files.refetch()}
            className="text-xs text-white/40 transition hover:text-white"
          >
            Refresh
          </button>
        </div>
        {files.isLoading && <div className="skeleton h-32 rounded-lg" />}
        {files.error && (
          <p className="text-xs text-red-300">
            {files.error instanceof Error ? files.error.message : 'Could not list logs.'}
          </p>
        )}
        <div className="max-h-[28rem] space-y-1 overflow-y-auto">
          {(files.data ?? [])
            .slice()
            .sort((a, b) => (b.DateModified ?? '').localeCompare(a.DateModified ?? ''))
            .map((f) => (
              <button
                key={f.Name}
                onClick={() => setSelected(f.Name ?? undefined)}
                className={`block w-full rounded-lg px-3 py-2 text-left transition ${
                  selected === f.Name ? 'bg-accent/15 text-white' : 'text-white/60 hover:bg-white/6'
                }`}
              >
                <p className="truncate text-xs font-medium">{f.Name}</p>
                <p className="text-[11px] text-white/35">
                  {f.Size != null ? `${(f.Size / 1024).toFixed(0)} KB` : '—'}
                  {f.DateModified ? ` · ${new Date(f.DateModified).toLocaleString()}` : ''}
                </p>
              </button>
            ))}
        </div>
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter lines…"
            className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm outline-none placeholder:text-white/25 focus:border-white/40"
          />
          <Chip active={errorsOnly} onClick={() => setErrorsOnly((v) => !v)}>
            Warnings & errors
          </Chip>
          <Chip active={follow} onClick={() => setFollow((v) => !v)}>
            Follow tail
          </Chip>
          <button
            onClick={() => void log.refetch()}
            disabled={!selected}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20 disabled:opacity-35"
          >
            Reload
          </button>
          {selected && (
            <a
              href={api.authedUrl('/System/Logs/Log', { name: selected })}
              download={selected}
              className="rounded-lg border border-white/20 px-3 py-1.5 text-sm transition hover:border-white/45"
            >
              Download
            </a>
          )}
        </div>

        <div
          ref={bodyRef}
          className="h-[28rem] overflow-auto rounded-lg border border-white/10 bg-black/60 p-3 font-mono text-[11px] leading-relaxed"
        >
          {log.isLoading && <p className="text-white/35">Loading…</p>}
          {log.error && (
            <p className="text-red-300">
              {log.error instanceof Error ? log.error.message : 'Could not read that log.'}
            </p>
          )}
          {!log.isLoading && lines.length === 0 && (
            <p className="text-white/35">
              {log.data ? 'Nothing matches that filter.' : 'Select a log file.'}
            </p>
          )}
          {lines.map((line, i) => {
            const level = line.match(LEVEL_RE)?.[1]
            return (
              <div
                key={i}
                className={`whitespace-pre-wrap break-all ${
                  level ? (LEVEL_STYLE[level] ?? 'text-white/70') : 'text-white/45'
                }`}
              >
                {line || ' '}
              </div>
            )
          })}
        </div>
        <p className="mt-1.5 text-xs text-white/35">
          {lines.length.toLocaleString()} lines shown
        </p>
      </div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-sm transition ${
        active
          ? 'border-accent bg-accent/15 text-white'
          : 'border-white/15 text-white/60 hover:border-white/40'
      }`}
    >
      {children}
    </button>
  )
}
