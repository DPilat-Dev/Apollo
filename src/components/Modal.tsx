import { useDialog } from '../lib/useDialog'

/**
 * A dialog: something covering the screen that the rest of the page is not
 * available behind.
 *
 * It lived at the bottom of `admin/LibrariesPanel.tsx` and was imported from
 * there by three other files, which is how it came to be a plain `<div>` — a
 * shell nobody owns is a shell nobody gives a `role` to. Everything that makes
 * it behave like a dialog now comes from `useDialog`: Escape closes it, Tab
 * cycles inside it, it announces itself, and closing returns focus to whatever
 * opened it.
 */
export function Modal({
  title,
  onClose,
  wide,
  children,
}: {
  title: string
  onClose: () => void
  /** For grids of pictures. A column of form fields reads better narrow. */
  wide?: boolean
  children: React.ReactNode
}) {
  const { titleId, dialogProps } = useDialog({ onClose })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Not a button and not focusable: it duplicates the close control, and
          a second Close in the Tab order is noise for anyone who reaches it. */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        {...dialogProps}
        className={`relative max-h-[85vh] w-full overflow-y-auto rounded-xl border border-white/10 bg-ink-soft shadow-2xl outline-none ${
          wide ? 'max-w-4xl' : 'max-w-lg'
        }`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-white/10 bg-ink-soft/95 px-5 py-4 backdrop-blur">
          <p id={titleId} className="font-semibold">
            {title}
          </p>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-white/50 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="space-y-6 px-5 py-5">{children}</div>
      </div>
    </div>
  )
}
