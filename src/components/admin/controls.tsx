import { useEffect, useState, type ReactNode } from 'react'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'

export function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: ReactNode
}) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/40">{title}</h3>
      {hint && <p className="mt-1 text-xs text-white/35">{hint}</p>}
      <div className="mt-2">{children}</div>
    </section>
  )
}

export function ToggleRows({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-white/8 rounded-lg border border-white/10">{children}</div>
}

export function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-white/40">{hint}</p>}
      </div>
      <Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  )
}

export function Switch({
  checked,
  label,
  disabled,
  onChange,
}: {
  checked: boolean
  label: string
  disabled?: boolean
  onChange: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-30 ${
        checked ? 'bg-accent' : 'bg-white/20'
      }`}
    >
      {/*
        Positioned with `left`, never `translate-x`. An absolutely positioned
        element with no `left` resolves to its static position inside the
        button, and a translate stacks on top of that — which pushes the knob
        a full knob-width off the track.
      */}
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white transition-[left] duration-200 ${
          checked ? 'left-[1.375rem]' : 'left-0.5'
        }`}
      />
    </button>
  )
}

const inputClass =
  'w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none transition placeholder:text-white/25 focus:border-white/40'

export function Labelled({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-white/50">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-white/35">{hint}</span>}
    </label>
  )
}

export function TextInput({
  label,
  hint,
  value,
  placeholder,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <Labelled label={label} hint={hint}>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
    </Labelled>
  )
}

export function NumberInput({
  label,
  hint,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  hint?: string
  value: number | undefined
  min?: number
  max?: number
  onChange: (v: number) => void
}) {
  return (
    <Labelled label={label} hint={hint}>
      <input
        type="number"
        value={value ?? ''}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        className={`${inputClass} tabular-nums`}
      />
    </Labelled>
  )
}

export function Select({
  label,
  hint,
  value,
  options,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <Labelled label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Labelled>
  )
}

export function TextArea({
  label,
  hint,
  value,
  rows = 4,
  mono,
  placeholder,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  rows?: number
  mono?: boolean
  placeholder?: string
  onChange: (v: string) => void
}) {
  return (
    <Labelled label={label} hint={hint}>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${inputClass} ${mono ? 'font-mono text-xs' : ''}`}
      />
    </Labelled>
  )
}

/**
 * Read-modify-write shell for a configuration document. Edits accumulate in a
 * local draft so nothing reaches the server until Save, and the draft resets
 * whenever the server copy changes underneath.
 */
export function ConfigPanel<T>({
  query,
  save,
  note,
  savedMessage = 'Saved.',
  children,
}: {
  query: UseQueryResult<T>
  save: UseMutationResult<unknown, Error, T>
  note?: ReactNode
  savedMessage?: string
  children: (draft: T, set: <K extends keyof T>(key: K, value: T[K]) => void) => ReactNode
}) {
  const [draft, setDraft] = useState<T | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const serverCopy = query.data
  const [syncedFrom, setSyncedFrom] = useState<T | undefined>(undefined)
  useEffect(() => {
    if (serverCopy && serverCopy !== syncedFrom) {
      setSyncedFrom(serverCopy)
      setDraft(structuredClone(serverCopy))
    }
  }, [serverCopy, syncedFrom])

  if (query.isLoading) return <div className="skeleton h-64 rounded-lg" />
  if (query.error) {
    return (
      <p className="rounded-lg border border-accent/30 bg-accent/10 px-4 py-3 text-sm text-red-200">
        {query.error instanceof Error ? query.error.message : 'Could not load these settings.'}
      </p>
    )
  }
  if (!draft) return null

  const set = <K extends keyof T>(key: K, value: T[K]) => {
    setNotice(null)
    setDraft({ ...draft, [key]: value })
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(serverCopy)

  return (
    <div className="max-w-3xl space-y-6">
      {note}
      {notice && (
        <p className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm text-white/75">
          {notice}
        </p>
      )}

      {children(draft, set)}

      <div className="sticky bottom-4 flex items-center gap-3 rounded-lg border border-white/10 bg-ink-soft/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() =>
            save.mutate(draft, {
              onSuccess: () => setNotice(savedMessage),
              onError: (e) => setNotice(e instanceof Error ? e.message : 'Could not save.'),
            })
          }
          disabled={!dirty || save.isPending}
          className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-35"
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          onClick={() => {
            setDraft(serverCopy ? structuredClone(serverCopy) : null)
            setNotice(null)
          }}
          disabled={!dirty}
          className="rounded-lg border border-white/20 px-5 py-2 text-sm transition hover:border-white/45 disabled:opacity-35"
        >
          Discard
        </button>
        {dirty && <span className="text-xs text-white/40">Unsaved changes</span>}
      </div>
    </div>
  )
}

export function Warning({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
      {children}
    </p>
  )
}
