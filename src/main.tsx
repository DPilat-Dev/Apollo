import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { AuthProvider } from './lib/auth'
import { SyncPlayProvider } from './lib/syncplay'
import { ErrorBoundary } from './components/ErrorBoundary'
import { registerServiceWorker } from './lib/registerSw'
import { ApiError } from './lib/api'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false,
      /*
        One retry, and only where one could help. A 4xx is the server saying
        it understood and refused — asking again changes nothing, and on a
        token the server has stopped accepting it doubled every failure on the
        page: eleven queries produced twenty-two 401s. 5xx and network faults
        are the ones worth a second go.
      */
      retry: (failureCount, error) =>
        failureCount < 1 &&
        !(error instanceof ApiError && error.status >= 400 && error.status < 500),
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Vite injects BASE_URL from `base`; trailing slash trimmed for the router. */}
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        {/*
          The outermost boundary, and the one that matters most. Everything
          below has its own, but App and AuthProvider did not — so a throw in
          either unmounted the entire tree and left a black page with nothing
          on it and nothing in the UI to report. Reloading was the only way
          out, which is precisely how that failure was described.
        */}
        <ErrorBoundary>
          <AuthProvider>
            <SyncPlayProvider>
              <App />
            </SyncPlayProvider>
          </AuthProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)

registerServiceWorker()
