import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { handleConfigRequest, proxyJellyseerr } from './server/runtime.mjs'

/**
 * The version Apollo reports to Jellyfin, read straight off package.json.
 *
 * It used to be typed out by hand in the client, which meant it read 1.0.0
 * from 1.0.0 all the way through 1.4.0 — every Apollo session on a server's
 * dashboard mislabelled, and nothing in a release ever prompting anyone to
 * fix it. Sourcing it here makes the release bump the only edit.
 *
 * Read rather than imported so no JSON-resolution flag has to be turned on in
 * tsconfig.node.json for a single field.
 */
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

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
  // vitest has no config file of its own and loads this one, so the substitution
  // holds under test too — which is the point: a define that only existed in the
  // app build would let `Version="undefined"` pass every test on its way out.
  define: { __APOLLO_VERSION__: JSON.stringify(version) },
  // GitHub Pages serves a project site under /<repo>/, so assets need that
  // prefix. Everything else (a container, a reverse proxy) sits at the root.
  base: process.env.VITE_BASE ?? '/',
  build: {
    // The only chunk over the default 500 kB is hls.js, which is now split out
    // and fetched solely when a transcode actually needs it. Raising the limit
    // keeps the warning meaningful for chunks we control.
    chunkSizeWarningLimit: 600,
  },
  worker: {
    // JASSUB starts libass with `new Worker(url, { type: 'module' })`, so the
    // file that URL points at has to be an ES module. The default here is an
    // IIFE, which a module worker will not execute.
    format: 'es',
  },
  plugins: [react(), tailwindcss(), apolloRuntime()],
  server: {
    host: true,
    port: 5173,
  },
})
