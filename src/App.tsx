import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, useEffect, useState } from 'react'
import { TopNav } from './components/TopNav'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAuth } from './lib/auth'
import { useBranding } from './lib/branding'
import { lazyWithReload } from './lib/lazyChunk'
import { ShortcutsModal } from './components/ShortcutsModal'
import { isTypingTarget } from './lib/shortcuts'
import { Home } from './routes/Home'
import { ItemDetail } from './routes/ItemDetail'
import { Library } from './routes/Library'
import { Login } from './routes/Login'
import { Search } from './routes/Search'
import { Browse } from './routes/Browse'
import { Settings } from './routes/Settings'
import { Playlists } from './routes/Playlists'
import { PlaylistDetail } from './routes/PlaylistDetail'

// hls.js is ~500 kB and only the player needs it, so keep it out of the entry chunk.
const Player = lazyWithReload(() =>
  import('./routes/Player').then((m) => ({ default: m.Player })),
)

// The dashboard is ~18% of the entry chunk and one user in twelve opens it.
const Admin = lazyWithReload(() =>
  import('./routes/Admin').then((m) => ({ default: m.Admin })),
)

/**
 * The shortcuts that work anywhere, and the sheet describing them.
 *
 * Anything typed into a field is left alone — a global handler that eats keys
 * inside a text box is the classic way to make a search field unusable.
 */
function useGlobalShortcuts(signedIn: boolean) {
  const [helpOpen, setHelpOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isTypingTarget(e.target)) return

      if (e.key === '?') {
        e.preventDefault()
        setHelpOpen((v) => !v)
        return
      }
      if (signedIn && e.key === '/') {
        e.preventDefault()
        navigate('/search')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [signedIn, navigate])

  return { helpOpen, closeHelp: () => setHelpOpen(false) }
}

function RouteSpinner() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="size-10 animate-spin rounded-full border-3 border-white/15 border-t-accent" />
    </div>
  )
}

/** Browse chrome: nav + scroll reset. The player deliberately opts out of both. */
function BrowseLayout() {
  const { pathname } = useLocation()

  /*
    Block body, deliberately. Written as `useEffect(() => window.scrollTo(0, 0))`
    the arrow returns whatever scrollTo returns, and React treats an effect's
    return value as its cleanup function. Production React only checks that the
    value is not undefined before calling it — it never checks it is callable —
    so on any browser where scrollTo returns something instead of undefined,
    the next navigation threw `is not a function` from the commit phase. That
    unmounted the tree and left a black page.
  */
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])

  return (
    <>
      <ErrorBoundary resetKey="nav">
        <TopNav />
      </ErrorBoundary>
      <main>
        {/* Keyed on the path so navigating away clears a failed screen. */}
        <ErrorBoundary resetKey={pathname}>
          <Suspense fallback={<RouteSpinner />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
    </>
  )
}

export default function App() {
  const { session } = useAuth()
  const { helpOpen, closeHelp } = useGlobalShortcuts(Boolean(session))
  // Keeps the server's custom CSS applied across every signed-in screen.
  useBranding(session?.server)

  if (!session) {
    // Sign-in needs a boundary too. It is the one screen a user cannot
    // navigate away from, so a crash here is a dead end rather than a lost tab.
    return (
      <ErrorBoundary resetKey="login">
        <Routes>
          <Route path="*" element={<Login />} />
        </Routes>
        {helpOpen && <ShortcutsModal onClose={closeHelp} />}
      </ErrorBoundary>
    )
  }

  return (
    <>
      <Routes>
        {/* Fullscreen, chrome-free. */}
        <Route
          path="/watch/:itemId"
          element={
            <Suspense
              fallback={
                <div className="flex h-dvh items-center justify-center bg-black">
                  <div className="size-14 animate-spin rounded-full border-3 border-white/20 border-t-accent" />
                </div>
              }
            >
              <ErrorBoundary>
                <Player />
              </ErrorBoundary>
            </Suspense>
          }
        />

        <Route
          element={
            <ErrorBoundary resetKey="layout">
              <BrowseLayout />
            </ErrorBoundary>
          }
        >
          <Route path="/" element={<Home />} />
          <Route path="/library/:viewId" element={<Library />} />
          <Route path="/item/:itemId" element={<ItemDetail />} />
          <Route path="/search" element={<Search />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/playlists" element={<Playlists />} />
          <Route path="/playlist/:playlistId" element={<PlaylistDetail />} />
          <Route path="/settings" element={<Settings />} />
          {/* Admin gates on the user's policy internally, not on the route. */}
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>

      {helpOpen && <ShortcutsModal onClose={closeHelp} />}
    </>
  )
}
