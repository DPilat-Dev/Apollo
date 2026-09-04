import { useEffect } from 'react'
import { SHORTCUTS } from '../lib/shortcuts'
import { useDialog } from '../lib/useDialog'

/** The help sheet. Its content comes from the same map the handlers use. */
export function ShortcutsModal({ onClose }: { onClose: () => void }) {
  const { titleId, dialogProps } = useDialog({ onClose })

  /*
    `?` closes it as well as opening it, which Escape alone would not give —
    the same key toggling the sheet is how it is documented in the sheet. The
    listener stays on the window for that reason: `?` is a global shortcut and
    this is the one screen where it means something else. Escape belongs to
    `useDialog` and is deliberately not handled twice.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div
        {...dialogProps}
        className="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-white/10 bg-ink-soft shadow-2xl outline-none"
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-white/10 bg-ink-soft/95 px-5 py-4 backdrop-blur">
          <h2 id={titleId} className="text-lg font-semibold">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/80 transition hover:bg-white/20"
          >
            Close
          </button>
        </div>

        <div className="grid gap-6 px-5 py-5 sm:grid-cols-2">
          {SHORTCUTS.map((group) => (
            <section key={group.title}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">
                {group.title}
              </h3>
              <dl className="space-y-1.5">
                {group.shortcuts.map((s) => (
                  <div key={s.description} className="flex items-baseline justify-between gap-3">
                    <dt className="text-sm text-white/75">{s.description}</dt>
                    <dd className="flex shrink-0 items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="rounded border border-white/20 bg-white/8 px-1.5 py-0.5 font-sans text-[11px] text-white/85"
                        >
                          {k}
                        </kbd>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="border-t border-white/10 px-5 py-3 text-xs text-white/40">
          Playback shortcuts apply while something is playing.
        </p>
      </div>
    </div>
  )
}
