/**
 * Jellyseerr client.
 *
 * Everything goes to `/jellyseerr/...` on our own origin, never to Jellyseerr
 * directly: it sends no CORS headers and answers preflight with 405, so a
 * cross-origin call is blocked by the browser before it is even sent. Whatever
 * serves Apollo forwards that path (Vite in dev, your reverse proxy in prod).
 *
 * Being same-origin also means Jellyseerr's `connect.sid` cookie just works, so
 * each person authenticates as themselves and no admin API key touches the
 * client.
 */

const BASE = '/jellyseerr/api/v1'

/** Jellyseerr's MediaStatus enum. */
export const MediaStatus = {
  UNKNOWN: 1,
  PENDING: 2,
  PROCESSING: 3,
  PARTIALLY_AVAILABLE: 4,
  AVAILABLE: 5,
} as const

export interface SeerrMediaInfo {
  status?: number
  status4k?: number
}

export interface SeerrResult {
  id: number
  mediaType: 'movie' | 'tv' | 'person'
  title?: string
  name?: string
  overview?: string
  posterPath?: string
  profilePath?: string
  releaseDate?: string
  firstAirDate?: string
  voteAverage?: number
  mediaInfo?: SeerrMediaInfo
}

export interface SeerrSearchResponse {
  page: number
  totalPages: number
  totalResults: number
  results: SeerrResult[]
}

export interface SeerrUser {
  id: number
  displayName?: string
  email?: string
  requestCount?: number
  /** The Jellyfin account this Jellyseerr user is linked to. */
  jellyfinUserId?: string | null
  jellyfinUsername?: string | null
}

const bareId = (value?: string | null) =>
  value ? value.replace(/-/g, '').toLowerCase() : ''

/**
 * Whether a Jellyseerr session actually belongs to the person signed in here.
 *
 * This matters because the session lives in a cookie, which is per *browser*,
 * not per Apollo user. Without this check, one person connecting and then
 * handing the device over — or simply signing out and letting someone else
 * sign in — would leave the next person filing requests under the first
 * person's account, against their quota.
 *
 * Unverifiable sessions are rejected rather than trusted: being unable to prove
 * whose session it is, is not a reason to use it.
 */
export function sessionBelongsTo(
  user: SeerrUser,
  jellyfin: { userId: string; userName: string },
): boolean {
  if (user.jellyfinUserId) return bareId(user.jellyfinUserId) === bareId(jellyfin.userId)

  // Older Jellyseerr, or an account linked by name only.
  const name = user.jellyfinUsername ?? user.displayName
  if (name) return name.toLowerCase() === jellyfin.userName.toLowerCase()

  return false
}

export class JellyseerrError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/** Distinguishes "no proxy configured" from "Jellyseerr said no". */
export class JellyseerrUnreachable extends JellyseerrError {
  constructor() {
    super(
      'Jellyseerr is not reachable through this app. The /jellyseerr path needs to be forwarded by whatever serves Apollo.',
      0,
    )
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      // Same-origin by construction, but be explicit: the session cookie is
      // the whole authentication mechanism here.
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new JellyseerrUnreachable()
  }

  // A proxy that isn't configured returns Apollo's own index.html, not JSON.
  const contentType = res.headers.get('content-type') ?? ''
  if (res.ok && !contentType.includes('application/json')) {
    throw new JellyseerrUnreachable()
  }

  if (!res.ok) {
    let message = `Jellyseerr request failed (${res.status})`
    try {
      const body = await res.json()
      if (body?.message) message = body.message
    } catch {
      /* keep the status-based message */
    }
    throw new JellyseerrError(message, res.status)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

/** Public settings need no session, so this doubles as a reachability probe. */
export function publicSettings() {
  return call<{ applicationTitle?: string; mediaServerLogin?: boolean; localLogin?: boolean }>(
    '/settings/public',
  )
}

export function currentUser() {
  return call<SeerrUser>('/auth/me')
}

/** Jellyseerr authenticates against the same Jellyfin server we did. */
export function signIn(username: string, password: string) {
  return call<SeerrUser>('/auth/jellyfin', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export function signOut() {
  return call<void>('/auth/logout', { method: 'POST' })
}

export function search(query: string, page = 1) {
  return call<SeerrSearchResponse>(
    `/search?query=${encodeURIComponent(query)}&page=${page}`,
  )
}

export interface RequestPayload {
  mediaType: 'movie' | 'tv'
  mediaId: number
  /** TV only. 'all' or explicit season numbers. */
  seasons?: 'all' | number[]
}

export function requestMedia(payload: RequestPayload) {
  return call<{ id: number; status: number }>('/request', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function myRequests(take = 20) {
  return call<{ results: unknown[]; pageInfo?: { results: number } }>(
    `/request?take=${take}&filter=all&sort=added`,
  )
}

// ------------------------------------------------------------ runtime config

export interface RuntimeConfig {
  jellyseerrTarget: string
}

/** Served by our own dev/production server, not by Jellyseerr. */
export async function runtimeConfig(): Promise<RuntimeConfig> {
  const res = await fetch('/__apollo/config', { headers: { Accept: 'application/json' } })
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) {
    throw new JellyseerrUnreachable()
  }
  return res.json()
}

/**
 * The server verifies the token against Jellyfin and requires an administrator,
 * so this is safe to expose: the client cannot grant itself the right to
 * repoint the proxy.
 */
export async function saveRuntimeConfig(
  config: Partial<RuntimeConfig>,
  auth: { server: string; token: string },
): Promise<RuntimeConfig> {
  const res = await fetch('/__apollo/config', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Jellyfin-Server': auth.server,
      'X-Jellyfin-Token': auth.token,
    },
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new JellyseerrError(body?.message ?? `Could not save (${res.status})`, res.status)
  }
  return res.json()
}

// --------------------------------------------------------------- presentation

export function seerrTitle(r: SeerrResult) {
  return r.title ?? r.name ?? 'Untitled'
}

export function seerrYear(r: SeerrResult) {
  const date = r.releaseDate ?? r.firstAirDate
  return date ? date.slice(0, 4) : null
}

export function seerrPoster(r: SeerrResult, width: 342 | 500 = 342) {
  const path = r.posterPath ?? r.profilePath
  return path ? `https://image.tmdb.org/t/p/w${width}${path}` : null
}

/** What the request button should say, and whether it can be pressed. */
export function availability(r: SeerrResult): { label: string; requestable: boolean } {
  switch (r.mediaInfo?.status) {
    case MediaStatus.AVAILABLE:
      return { label: 'In library', requestable: false }
    case MediaStatus.PARTIALLY_AVAILABLE:
      return { label: 'Partly available', requestable: true }
    case MediaStatus.PROCESSING:
      return { label: 'Downloading', requestable: false }
    case MediaStatus.PENDING:
      return { label: 'Requested', requestable: false }
    default:
      return { label: 'Request', requestable: true }
  }
}
