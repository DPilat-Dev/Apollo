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
 *
 * `bottom` is the same dialog anchored to the bottom edge instead of floating
 * in the middle of the screen, for the one case that is phone-only: a centred
 * card on a handset puts its close control at the top of a 844px-tall screen,
 * which is the one place a thumb holding the phone cannot reach. It is a
 * placement, not a second kind of overlay — same chrome, same border, same
 * close ✕ — because a second overlay shape in the app would be one more thing
 * to keep in step for no stated gain.
 *
 * The page behind it does not move either, which is the other half of "not
 * available" and was missing from every dialog in the app: `index.css` locks
 * `overflow-x` on `body` and nothing locked `overflow-y`, so a drag on the
 * backdrop scrolled the page underneath. That lock is in `useDialog` with the
 * rest of it, because this component is only six of the ten dialogs — the
 * other four build the same overlay around the same hook.
 */
export function Modal({
  title,
  onClose,
  wide,
  bottom,
  children,
}: {
  title: string
  onClose: () => void
  /** For grids of pictures. A column of form fields reads better narrow. */
  wide?: boolean
  /** Anchored to the bottom edge, full width. For handset-only dialogs. */
  bottom?: boolean
  children: React.ReactNode
}) {
  const { titleId, dialogProps } = useDialog({ onClose })

  return (
    <div
      className={`fixed inset-0 z-50 flex justify-center ${bottom ? 'items-end' : 'items-center p-4'}`}
    >
      {/* Not a button and not focusable: it duplicates the close control, and
          a second Close in the Tab order is noise for anyone who reaches it. */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        {...dialogProps}
        className={`relative max-h-[85vh] w-full overflow-y-auto border border-white/10 bg-ink-soft shadow-2xl outline-none ${
          bottom
            ? // The home-bar inset, so the last control is not sitting under it.
              'rounded-t-xl pb-[env(safe-area-inset-bottom)]'
            : `rounded-xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`
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
