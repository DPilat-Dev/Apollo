/**
 * Runtime configuration shared by the dev server and the production server.
 *
 * The Jellyseerr address has to live somewhere the proxy can read at request
 * time, because the browser can never call Jellyseerr directly (no CORS). A
 * file next to the app is that somewhere — editable from the dashboard, but
 * only by someone who proves they are a Jellyfin administrator.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import https from 'node:https'

const CONFIG_PATH = path.resolve(process.cwd(), 'apollo.runtime.json')

const DEFAULTS = {
  jellyseerrTarget: process.env.VITE_JELLYSEERR_TARGET ?? '',
}

let cache = null
let cachedAt = 0

export async function readConfig() {
  // Re-read at most every second: the proxy consults this on every request.
  if (cache && Date.now() - cachedAt < 1000) return cache
  let parsed = {}
  if (existsSync(CONFIG_PATH)) {
    try {
      parsed = JSON.parse(await readFile(CONFIG_PATH, 'utf8'))
    } catch {
      // A corrupt file must not take the whole app down.
      parsed = {}
    }
  }
  cache = { ...DEFAULTS, ...parsed }
  cachedAt = Date.now()
  return cache
}

export async function writeConfig(next) {
  const merged = { ...(await readConfig()), ...next }
  await writeFile(CONFIG_PATH, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
  cache = merged
  cachedAt = Date.now()
  return merged
}

/** Rejects anything that isn't a plain http(s) origin. */
export function normalizeTarget(value) {
  if (typeof value !== 'string' || !value.trim()) return null
  let candidate = value.trim()
  // Only bare host:port gets a scheme prepended. Prefixing something that
  // already declares one turns file:///etc/passwd into http://file — a bad
  // scheme laundered into a valid-looking target.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (!/^https?:\/\//i.test(candidate)) return null
  } else {
    candidate = `http://${candidate}`
  }
  let url
  try {
    url = new URL(candidate)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return `${url.protocol}//${url.host}`
}

/**
 * Confirms the caller is a Jellyfin administrator by asking their own Jellyfin
 * server. We never hold credentials — the client forwards its token and the
 * server it belongs to, and Jellyfin is the authority on both.
 */
export async function isJellyfinAdmin({ server, token }) {
  const origin = normalizeTarget(server)
  if (!origin || !token) return false
  try {
    const res = await fetch(`${origin}/Users/Me`, {
      headers: { Authorization: `MediaBrowser Token="${token}"` },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return false
    const user = await res.json()
    return Boolean(user?.Policy?.IsAdministrator)
  } catch {
    return false
  }
}

/** Handles GET/PUT of the runtime config. Returns true if it took the request. */
export async function handleConfigRequest(req, res) {
  if (!req.url?.startsWith('/__apollo/config')) return false

  if (req.method === 'GET') {
    const config = await readConfig()
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(config))
    return true
  }

  if (req.method === 'PUT') {
    const body = await readBody(req)
    let payload
    try {
      payload = JSON.parse(body || '{}')
    } catch {
      return send(res, 400, { message: 'Invalid JSON.' })
    }

    const admin = await isJellyfinAdmin({
      server: req.headers['x-jellyfin-server'],
      token: req.headers['x-jellyfin-token'],
    })
    if (!admin) {
      return send(res, 403, { message: 'Only a Jellyfin administrator can change this.' })
    }

    const target = normalizeTarget(payload.jellyseerrTarget)
    if (payload.jellyseerrTarget && !target) {
      return send(res, 400, { message: 'That does not look like a valid address.' })
    }

    const saved = await writeConfig({ jellyseerrTarget: target ?? '' })
    return send(res, 200, saved)
  }

  return send(res, 405, { message: 'Method not allowed.' })
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
  return true
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
      // Guard against an unbounded body on an unauthenticated endpoint.
      if (data.length > 10_000) req.destroy()
    })
    req.on('end', () => resolve(data))
    req.on('error', () => resolve(''))
  })
}

/**
 * Forwards /jellyseerr/* to the configured address. Shared by the dev server
 * and the production one so there is a single implementation to reason about.
 * Returns true if it handled the request.
 */
export async function proxyJellyseerr(req, res) {
  if (!req.url?.startsWith('/jellyseerr')) return false

  const { jellyseerrTarget } = await readConfig()
  if (!jellyseerrTarget) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: 'No Jellyseerr address is configured.' }))
    return true
  }

  const target = new URL(jellyseerrTarget)
  const client = target.protocol === 'https:' ? https : http

  // Host has to be the upstream's or Jellyseerr builds wrong absolute URLs.
  const headers = { ...req.headers, host: target.host }
  delete headers['accept-encoding']

  const upstream = client.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: req.url.replace(/^\/jellyseerr/, '') || '/',
      headers,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(res)
    },
  )

  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ message: `Could not reach Jellyseerr: ${err.message}` }))
  })

  req.pipe(upstream)
  return true
}
