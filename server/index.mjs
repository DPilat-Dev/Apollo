#!/usr/bin/env node
/**
 * Serves the built app and forwards /jellyseerr to wherever the runtime config
 * points. Running this instead of a bare static host is what makes the
 * Jellyseerr address changeable from the dashboard — nginx cannot be
 * reconfigured by a web page, but this can, behind a Jellyfin admin check.
 *
 *   npm run build && npm run serve
 */
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { handleConfigRequest, proxyJellyseerr, readConfig } from './runtime.mjs'

const PORT = Number(process.env.PORT ?? 4173)
const DIST = process.env.APOLLO_DIST ?? path.resolve(process.cwd(), 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
}

const server = http.createServer(async (req, res) => {
  try {
    if (await handleConfigRequest(req, res)) return
    if (await proxyJellyseerr(req, res)) return
    serveStatic(req, res)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: err?.message ?? 'Server error' }))
  }
})

function serveStatic(req, res) {
  const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
  // Resolve inside DIST and verify — blocks ../ traversal.
  const candidate = path.resolve(DIST, `.${urlPath}`)
  const safe = candidate.startsWith(DIST) ? candidate : DIST

  const file =
    existsSync(safe) && statSync(safe).isFile() ? safe : path.join(DIST, 'index.html')

  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Run `npm run build` first.')
    return
  }

  const ext = path.extname(file)
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    // Hashed assets are immutable; index.html must never be cached.
    'Cache-Control': file.endsWith('index.html')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  })
  createReadStream(file).pipe(res)
}

server.listen(PORT, () => {
  void readConfig().then((c) =>
    console.log(
      `Apollo on http://localhost:${PORT}\n` +
        `  serving    ${DIST}\n` +
        `  Jellyseerr -> ${c.jellyseerrTarget || '(not configured)'}`,
    ),
  )
})
