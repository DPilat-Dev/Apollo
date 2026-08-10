import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleConfigRequest, proxyJellyseerr } from './server/runtime.mjs'

/**
 * Gives the dev server the same /__apollo/config endpoint the production
 * server has, so the dashboard behaves identically in both.
 */
function apolloRuntime() {
  return {
    name: 'apollo-runtime',
    configureServer(server: { middlewares: { use: (fn: unknown) => void } }) {
      server.middlewares.use(async (req: never, res: never, next: () => void) => {
        if (await handleConfigRequest(req, res)) return
        if (await proxyJellyseerr(req, res)) return
        next()
      })
    },
  }
}

export default defineConfig({
  // GitHub Pages serves a project site under /<repo>/, so assets need that
  // prefix. Everything else (a container, a reverse proxy) sits at the root.
  base: process.env.VITE_BASE ?? '/',
  build: {
    // The only chunk over the default 500 kB is hls.js, which is now split out
    // and fetched solely when a transcode actually needs it. Raising the limit
    // keeps the warning meaningful for chunks we control.
    chunkSizeWarningLimit: 600,
  },
  plugins: [react(), tailwindcss(), apolloRuntime()],
  server: {
    host: true,
    port: 5173,
  },
})
