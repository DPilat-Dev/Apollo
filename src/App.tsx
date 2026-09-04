import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { Suspense, useEffect, useState } from 'react'
import { TopNav } from './components/TopNav'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAuth } from './lib/auth'
import { useBranding } from './lib/branding'
import { lazyWithReload } from './lib/lazyChunk'
import { useScrollRestoration } from './lib/useScrollRestoration'
import { useReducedMotion } from './lib/useReducedMotion'
import { motionAttribute } from './lib/motion'
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
import { History } from './routes/History'
import { Collections } from './routes/Collections'
import { YearRecap } from './routes/YearRecap'
import { RecapStory } from './routes/RecapStory'
import { PlaylistDetail } from './routes/PlaylistDetail'
import { Person } from './routes/Person'

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

/** Browse chrome: nav + scroll handling. The player deliberately opts out of both. */
function BrowseLayout() {
  const { pathname } = useLocation()

  /*
    Was an unconditional `window.scrollTo(0, 0)` on every path change, which is
    right for following a link and wrong for going back: twenty rows into a
    library, open a show, press back, and you were at the top again. The rules
    now live in `scrollMemory.ts` and the waiting-for-content part, which the
    browser's own scrollRestoration cannot do, in `useScrollRestoration`.
  */
  useScrollRestoration()

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

  /*
    Published once, here, so stylesheets answer the same question the
    components do. They could ask `prefers-reduced-motion` themselves, but then
    a viewer who overrode the system preference would get a calm recap and
    restless skeletons underneath it.
  */
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    document.documentElement.dataset.motion = motionAttribute(reduceMotion)
  }, [reduceMotion])

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

        {/*
          Chrome-free like the player. A story that runs under the nav bar has
          its own controls covered by the app's — the Skip button ended up
          behind the account avatar — and a full-screen run with a header on it
          is not full screen.
        */}
        <Route
          path="/recap/story"
          element={
            <ErrorBoundary resetKey="recap-story">
              <RecapStory />
            </ErrorBoundary>
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
          {/* Keyed by name: /Persons/{name} is the only way to a biography,
              and Jellyfin has no by-id equivalent. The credit's id travels in
              the query, since names are not unique. */}
          <Route path="/person/:name" element={<Person />} />
          <Route path="/playlists" element={<Playlists />} />
          {/* A single collection has no route: it is /browse with a parentId,
              which already does grids of items with paging and sorting. */}
          <Route path="/collections" element={<Collections />} />
          <Route path="/playlist/:playlistId" element={<PlaylistDetail />} />
          <Route path="/history" element={<History />} />
          {/* Always routed, but out of season the page redirects home — the
              seasonal decision belongs to one function, not to the router. */}
          <Route path="/recap" element={<YearRecap />} />
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
