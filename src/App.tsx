import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'
import { Suspense, lazy, useEffect } from 'react'
import { TopNav } from './components/TopNav'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAuth } from './lib/auth'
import { useBranding } from './lib/branding'
import { Home } from './routes/Home'
import { ItemDetail } from './routes/ItemDetail'
import { Library } from './routes/Library'
import { Login } from './routes/Login'
import { Search } from './routes/Search'
import { Browse } from './routes/Browse'
import { Settings } from './routes/Settings'
import { Admin } from './routes/Admin'

// hls.js is ~500 kB and only the player needs it, so keep it out of the entry chunk.
const Player = lazy(() => import('./routes/Player').then((m) => ({ default: m.Player })))

/** Browse chrome: nav + scroll reset. The player deliberately opts out of both. */
function BrowseLayout() {
  const { pathname } = useLocation()
  useEffect(() => window.scrollTo(0, 0), [pathname])

  return (
    <>
      <ErrorBoundary resetKey="nav">
        <TopNav />
      </ErrorBoundary>
      <main>
        {/* Keyed on the path so navigating away clears a failed screen. */}
        <ErrorBoundary resetKey={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </>
  )
}

export default function App() {
  const { session } = useAuth()
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
      </ErrorBoundary>
    )
  }

  return (
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

      <Route element={<BrowseLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/library/:viewId" element={<Library />} />
        <Route path="/item/:itemId" element={<ItemDetail />} />
        <Route path="/search" element={<Search />} />
        <Route path="/browse" element={<Browse />} />
        <Route path="/settings" element={<Settings />} />
        {/* Admin gates on the user's policy internally, not on the route. */}
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
