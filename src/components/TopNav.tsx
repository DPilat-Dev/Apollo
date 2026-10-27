import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { usePopupDismiss } from '../lib/usePopupDismiss'
import { useBoxSets, useCurrentUser, useIsAdmin, useRecapLink, useViews } from '../lib/queries'
import { shouldShowCollections } from '../lib/boxSets'
import { MenuIcon, SearchIcon } from './icons'
import { RemoteControl } from './RemoteControl'
import { UserAvatar } from './UserAvatar'

/**
 * Transparent over the billboard, solid once scrolled — the standard streaming
 * app nav treatment.
 */
export function TopNav() {
  const { session, signOut, switchUser } = useAuth()
  const { data: views } = useViews()
  // Already in the cache — `useIsAdmin` reads the same query. The picture
  // comes along with it, so the nav costs no extra request to draw a face.
  const { data: me } = useCurrentUser()
  const isAdmin = useIsAdmin()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()

  const [scrolled, setScrolled] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [term, setTerm] = useState(params.get('q') ?? '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [navOpen, setNavOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  /*
    Both of these used to close only on an outside *click*, which is to say
    that a keyboard could open either one and had no way to shut it again:
    Escape did nothing and Tab walked on through the page with the menu still
    over it. The item ⋮ menu had always had both halves, so the hook is that
    menu's behaviour, moved somewhere all three can share it — Escape, a press
    elsewhere, and the focus handed back to the trigger rather than dropped on
    `<body>`.

    It also replaces the invisible full-screen `<div>` each of these had for
    catching outside clicks. That div caught the *release*, so dismissing a
    menu by pressing on a card behind it also opened the card.
  */
  const navWrap = usePopupDismiss({ open: navOpen, onClose: () => setNavOpen(false) })
  const menuWrap = usePopupDismiss({ open: menuOpen, onClose: () => setMenuOpen(false) })

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /*
    Debounced from the change handler rather than an effect. An effect would
    have to list `navigate` as a dependency, and React Router hands back a new
    `navigate` identity on every location change — so opening a search result
    re-ran the effect and bounced the user straight back to /search.
  */
  const debounce = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(debounce.current), [])

  const onTermChange = (value: string) => {
    setTerm(value)
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(() => {
      const trimmed = value.trim()
      if (trimmed.length < 2) return
      // Push the first time so Back leaves search; replace while refining.
      navigate(`/search?q=${encodeURIComponent(trimmed)}`, {
        replace: location.pathname === '/search',
      })
    }, 300)
  }

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  // Any navigation closes both menus — including one triggered from elsewhere.
  useEffect(() => {
    setNavOpen(false)
    setMenuOpen(false)
  }, [location.pathname, location.search])

  // Every library the user can see, named as they named it on the server.
  // Live TV needs a tuner/guide UI this client doesn't have, so it's the only
  // thing held back; mixed and custom libraries browse fine through /Items.
  const browsable = (views ?? []).filter((v) => v.CollectionType !== 'livetv')

  // Collections are not a library, so nothing here lists them — but a server
  // that has none must show no entry at all, not an empty one, and not one
  // that appears a beat after the rest of the bar has settled.
  const boxSets = useBoxSets()
  const showCollections = shouldShowCollections(boxSets)

  const recap = useRecapLink()

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) =>
    `block px-3 py-2.5 text-sm transition-colors ${
      isActive ? 'bg-white/10 font-semibold text-white' : 'text-white/80 hover:bg-white/5'
    }`

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `shrink-0 whitespace-nowrap text-sm transition-colors ${
      isActive ? 'font-semibold text-white' : 'text-white/65 hover:text-white'
    }`

  return (
    /*
      `on-media` in both states, and deliberately.

      Unscrolled, this bar floats over the home page's hero — a photograph —
      and its links have to be legible against it. Scrolled, it is its own dark
      surface. Following the page's palette instead would put dark links on a
      dark photograph the moment anyone opened the home page in the light
      theme, which is precisely what this exists to avoid.
    */
    <nav
      /* `pr-[var(--dialog-scrollbar-gap,0px)]`: while a dialog holds the page
         still, the viewport is as much wider as the scrollbar it hid, and
         anything `fixed` to it — this bar's right-hand controls, the letter
         rail — slides out with it. `useDialog` publishes the width; this gives
         it back. 0px at every other moment, which is to say almost always. */
      className={`on-media fixed inset-x-0 top-0 z-50 pr-[var(--dialog-scrollbar-gap,0px)] transition-colors duration-300 ${
        scrolled ? 'bg-ink/95 backdrop-blur-md shadow-lg shadow-black/40' : 'bg-gradient-to-b from-black/80 to-transparent'
      }`}
    >
      <div className="flex h-14 items-center gap-3 px-4 sm:h-16 sm:gap-7 sm:px-14">
        {/* Below `sm` the library row has nowhere to go, so it moves behind an
            explicit menu button. It used to live inside the account menu,
            where nobody thinks to look for navigation. */}
        <div ref={navWrap} className="relative sm:hidden">
          <button
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Browse libraries"
            aria-haspopup="menu"
            aria-expanded={navOpen}
            className="-ml-2 flex size-11 items-center justify-center text-white/85 transition hover:text-white"
          >
            <MenuIcon className="size-6" />
          </button>
          {navOpen && (
            /* `role="menu"` and `menuitem` links, the same as the ⋮ menu: a
               popup that is announced as a stack of links in a div says
               nothing about being a popup, and nothing about having closed. */
            <div
              role="menu"
              className="absolute left-0 z-10 mt-1 max-h-[70vh] w-56 overflow-y-auto rounded border border-white/10 bg-ink-soft/98 py-1 shadow-2xl backdrop-blur"
            >
              <NavLink
                to="/"
                end
                role="menuitem"
                onClick={() => setNavOpen(false)}
                className={mobileLinkClass}
              >
                Home
              </NavLink>
              <NavLink
                to="/playlists"
                role="menuitem"
                onClick={() => setNavOpen(false)}
                className={mobileLinkClass}
              >
                Playlists
              </NavLink>
              {showCollections && (
                <NavLink
                  to="/collections"
                  role="menuitem"
                  onClick={() => setNavOpen(false)}
                  className={mobileLinkClass}
                >
                  Collections
                </NavLink>
              )}
              {browsable.map((v) => (
                <NavLink
                  key={v.Id}
                  to={`/library/${v.Id}`}
                  role="menuitem"
                  onClick={() => setNavOpen(false)}
                  className={mobileLinkClass}
                >
                  {v.Name}
                </NavLink>
              ))}
            </div>
          )}
        </div>

        <Link to="/" className="shrink-0 text-xl font-black tracking-tight text-accent sm:text-2xl">
          APOLLO
        </Link>

        {/* Scrolls rather than wraps, so a long library list can't push the
            search and account controls off the bar. */}
        <div className="scrollbar-none hidden min-w-0 flex-1 items-center gap-5 overflow-x-auto sm:flex">
          <NavLink to="/" end className={linkClass}>
            Home
          </NavLink>
          {browsable.map((v) => (
            <NavLink key={v.Id} to={`/library/${v.Id}`} className={linkClass}>
              {v.Name}
            </NavLink>
          ))}
          {showCollections && (
            <NavLink to="/collections" className={linkClass}>
              Collections
            </NavLink>
          )}
          <NavLink to="/playlists" className={linkClass}>
            Playlists
          </NavLink>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <div className="flex items-center">
            {searchOpen ? (
              <div className="flex items-center gap-2 rounded border border-white/30 bg-black/70 px-2.5 py-1.5">
                <SearchIcon className="size-4 shrink-0 text-white/70" />
                <input
                  ref={inputRef}
                  value={term}
                  onChange={(e) => onTermChange(e.target.value)}
                  onBlur={() => !term && setSearchOpen(false)}
                  onKeyDown={(e) => e.key === 'Escape' && setSearchOpen(false)}
                  placeholder="Titles, people, genres"
                  className="w-36 bg-transparent text-sm text-white outline-none placeholder:text-white/40 sm:w-56"
                />
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Search"
                className="p-1.5 text-white/80 transition hover:text-white"
              >
                <SearchIcon className="size-5" />
              </button>
            )}
          </div>

          <RemoteControl />

          <div ref={menuWrap} className="relative">
            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="flex size-8 items-center justify-center rounded"
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <UserAvatar
                server={session?.server ?? ''}
                userId={session?.userId}
                name={me?.Name ?? session?.userName}
                tag={me?.PrimaryImageTag}
                aspectRatio={me?.PrimaryImageAspectRatio}
                eager
                className="size-8 rounded bg-accent text-sm font-bold text-white"
              />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 z-10 mt-2 w-52 rounded border border-white/10 bg-ink-soft/98 py-1 shadow-2xl backdrop-blur"
              >
                {/* Not a menu item: it is the one line in here that cannot be
                    chosen. `presentation` keeps it out of the item list a
                    screen reader walks while leaving its text readable. */}
                <p role="presentation" className="truncate px-3 py-2 text-xs text-white/45">
                  Signed in as{' '}
                  <span className="font-medium text-white/80">{session?.userName}</span>
                </p>
                <div role="separator" className="my-1 h-px bg-white/10" />
                {/* Only ever rendered in December and January, and only for
                    an account with something in that year — `useRecapLink`
                    returns nothing otherwise, so the entry is absent rather
                    than hidden. */}
                {recap && (
                  <Link
                    to={recap.href}
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm font-medium text-accent hover:bg-white/5"
                  >
                    {recap.label}
                  </Link>
                )}
                {/* In the account menu rather than the library bar: history
                    is a fact about this account, not somewhere to browse,
                    and the bar already scrolls on a server with many
                    libraries. */}
                <Link
                  to="/history"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm text-white/80 hover:bg-white/5"
                >
                  Watch history
                </Link>
                <Link
                  to="/settings"
                  role="menuitem"
                  onClick={() => setMenuOpen(false)}
                  className="block px-3 py-2 text-sm text-white/80 hover:bg-white/5"
                >
                  Settings
                </Link>
                {isAdmin && (
                  <Link
                    to="/admin"
                    role="menuitem"
                    onClick={() => setMenuOpen(false)}
                    className="block px-3 py-2 text-sm text-white/80 hover:bg-white/5"
                  >
                    Dashboard
                  </Link>
                )}
                <div role="separator" className="my-1 h-px bg-white/10" />
                {/* Above Sign out, because on a shared device it is the one
                    people reach for, and the two are one slip apart. */}
                <button
                  role="menuitem"
                  onClick={switchUser}
                  className="block w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"
                >
                  Switch user
                </button>
                <button
                  role="menuitem"
                  onClick={signOut}
                  className="block w-full px-3 py-2 text-left text-sm text-white/80 hover:bg-white/5"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </nav>
  )
}
