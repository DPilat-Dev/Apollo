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
  plugins: [react(), tailwindcss(), apolloRuntime()],
  server: {
    host: true,
    port: 5173,
  },
})
