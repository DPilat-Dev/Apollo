import type { MediaSegment } from './segments'
import type {
  ActivityLogEntry,
  AuthenticationInfo,
  BaseItemDto,
  BaseItemDtoQueryResult,
  BrandingOptionsDto,
  CountryInfo,
  CultureDto,
  EncodingOptions,
  FileSystemEntryInfo,
  ItemCounts,
  LibraryOptions,
  LocalizationOption,
  LogFile,
  NetworkConfiguration,
  PlaybackInfoResponse,
  PackageInfo,
  PluginInfo,
  RepositoryInfo,
  SearchHintResult,
  ServerConfiguration,
  SessionInfoDto,
  SystemInfo,
  TaskInfo,
  UserDto,
  UserPolicy,
  VirtualFolderInfo,
} from '@jellyfin/sdk/lib/generated-client/models'

export const CLIENT_NAME = 'Apollo'
export const CLIENT_VERSION = '1.0.0'

/** A SyncPlay group as the server lists it. */
export interface GroupInfoDto {
  GroupId?: string
  GroupName?: string
  State?: 'Idle' | 'Waiting' | 'Paused' | 'Playing'
  Participants?: string[]
  LastUpdatedAt?: string
}

/**
 * What this device reports about itself when the group is waiting.
 *
 * `When` is this device's clock expressed on the server's, which is why the
 * offset has to be measured before any of this is meaningful.
 */
export interface SyncPlayReadyState {
  When: string
  PositionTicks: number
  IsPlaying: boolean
  PlaylistItemId: string
}

const SESSION_KEY = 'apollo.session'
const DEVICE_KEY = 'apollo.deviceId'

export interface Session {
  server: string
  userId: string
  userName: string
  token: string
}

/**
 * A v4 UUID that works outside a secure context.
 *
 * `crypto.randomUUID` is only defined on HTTPS or localhost. Served over plain
 * HTTP on a LAN address it is undefined — and because this is called from
 * `authHeader()`, that threw before any authenticated request was sent. The
 * symptom was bizarre: unauthenticated calls succeeded, everything else
 * silently never happened, and sign-in was impossible.
 *
 * `getRandomValues` has no such restriction, so it is the real fallback.
 */
function randomUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  // Last resort. This only labels a device in Jellyfin's session list; it is
  // not a secret and nothing is authorised by it.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/** Stable per-browser id — Jellyfin ties playback sessions and "device" listings to it. */
export function deviceId(): string {
  let id: string | null = null
  try {
    id = localStorage.getItem(DEVICE_KEY)
  } catch {
    // Private mode with storage blocked — fall through to a fresh id.
  }
  if (!id) {
    id = randomUuid()
    try {
      localStorage.setItem(DEVICE_KEY, id)
    } catch {
      /* not persisting is survivable; the session still works */
    }
  }
  return id
}

export function loadSession(): Session | null {
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Session
    return s.server && s.token && s.userId ? s : null
  } catch {
    return null
  }
}

export function saveSession(s: Session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s))
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY)
}

export function normalizeServer(url: string): string {
  let u = url.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  return u
}

/**
 * Jellyfin's auth scheme. The token is omitted while logging in — the same
 * header carries client identity for unauthenticated calls too.
 */
export function authHeader(token?: string): string {
  const parts = [
    `Client="${CLIENT_NAME}"`,
    `Device="${browserName()}"`,
    `DeviceId="${deviceId()}"`,
    `Version="${CLIENT_VERSION}"`,
  ]
  if (token) parts.push(`Token="${token}"`)
  return `MediaBrowser ${parts.join(', ')}`
}

function browserName(): string {
  const ua = navigator.userAgent
  if (ua.includes('Firefox/')) return 'Firefox'
  if (ua.includes('Edg/')) return 'Edge'
  if (ua.includes('Chrome/')) return 'Chrome'
  if (ua.includes('Safari/')) return 'Safari'
  return 'Browser'
}

export class ApiError extends Error {
  readonly status: number
  /** Raw response body — Jellyfin puts the real reason here on 4xx/5xx. */
  readonly detail: string

  constructor(message: string, status: number, detail = '') {
    super(detail ? `${message}: ${detail}` : message)
    this.status = status
    this.detail = detail
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined | null>

export function buildUrl(server: string, path: string, query: Query = {}): string {
  const url = new URL(path.replace(/^\//, ''), `${server}/`)
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    url.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v))
  }
  return url.toString()
}

/**
 * Requested widths are snapped to these. Jellyfin caches resized images by
 * their exact parameters, so asking for 337px then 341px produces two cache
 * misses and two resizes for what looks like the same picture.
 */
const WIDTH_BUCKETS = [
  160, 240, 320, 384, 480, 640, 800, 960, 1280, 1600, 1920, 2560, 2880, 3840,
]

/**
 * Capped at 2. The official client multiplies by the raw device pixel ratio,
 * but a 3x phone then asks for a 5760px hero — bandwidth far out of proportion
 * to what anyone can see on a handset.
 */
const MAX_PIXEL_RATIO = 2

export function scaleForDisplay(width: number): number {
  const ratio = Math.min(
    typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1),
    MAX_PIXEL_RATIO,
  )
  const target = Math.ceil(width * ratio)
  return WIDTH_BUCKETS.find((bucket) => bucket >= target) ?? WIDTH_BUCKETS.at(-1)!
}

export class JellyfinApi {
  readonly session: Session

  constructor(session: Session) {
    this.session = session
  }

  get server() {
    return this.session.server
  }

  get userId() {
    return this.session.userId
  }

  url(path: string, query: Query = {}) {
    return buildUrl(this.session.server, path, query)
  }

  /** Appends the token as a query param — for <img>/<video> src, which can't set headers. */
  authedUrl(path: string, query: Query = {}) {
    return this.url(path, { ...query, api_key: this.session.token })
  }

  async request<T>(path: string, init: RequestInit & { query?: Query } = {}): Promise<T> {
    const { query, ...rest } = init
    const res = await fetch(this.url(path, query), {
      ...rest,
      headers: {
        Accept: 'application/json',
        Authorization: authHeader(this.session.token),
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...rest.headers,
      },
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new ApiError(
        `${rest.method ?? 'GET'} ${path} failed (${res.status})`,
        res.status,
        detail.slice(0, 400),
      )
    }
    if (res.status === 204 || res.headers.get('content-length') === '0') {
      return undefined as T
    }
    const text = await res.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  // -------------------------------------------------------- remote control

  /**
   * Other devices signed in to this server that accept remote control.
   *
   * `activeWithinSeconds` keeps the list to things plausibly still on — a
   * phone that was used yesterday is not somewhere you want to start playback.
   */
  async controllableSessions(activeWithinSeconds = 600): Promise<SessionInfoDto[]> {
    const sessions = await this.requestArray<SessionInfoDto>('/Sessions', {
      query: { activeWithinSeconds },
    })
    return sessions.filter(
      (s) => s.SupportsRemoteControl && s.DeviceId !== deviceId() && s.Id,
    )
  }

  /** Starts playback of an item on another device. */
  async remotePlay(
    sessionId: string,
    itemIds: string[],
    opts: { startPositionTicks?: number; playCommand?: 'PlayNow' | 'PlayNext' | 'PlayLast' } = {},
  ): Promise<void> {
    await this.request(`/Sessions/${sessionId}/Playing`, {
      method: 'POST',
      query: {
        playCommand: opts.playCommand ?? 'PlayNow',
        itemIds,
        ...(opts.startPositionTicks ? { startPositionTicks: opts.startPositionTicks } : {}),
      },
    })
  }

  /** Transport control for a session this client is driving. */
  async remoteCommand(
    sessionId: string,
    command: 'PlayPause' | 'Pause' | 'Unpause' | 'Stop' | 'NextTrack' | 'PreviousTrack' | 'Seek',
    seekPositionTicks?: number,
  ): Promise<void> {
    await this.request(`/Sessions/${sessionId}/Playing/${command}`, {
      method: 'POST',
      query: seekPositionTicks != null ? { seekPositionTicks } : {},
    })
  }

  /** General commands: volume, mute, and the rest of the device's own controls. */
  async remoteGeneralCommand(
    sessionId: string,
    name: string,
    args: Record<string, string | number> = {},
  ): Promise<void> {
    await this.request(`/Sessions/${sessionId}/Command`, {
      method: 'POST',
      body: JSON.stringify({ Name: name, Arguments: args }),
    })
  }

  // ------------------------------------------------------------- playlists

  /** Playlists this user can see, as ordinary items of type Playlist. */
  async playlists(): Promise<BaseItemDto[]> {
    const res = await this.items({
      includeItemTypes: ['Playlist'],
      recursive: true,
      sortBy: 'SortName',
      sortOrder: 'Ascending',
    })
    return res.Items ?? []
  }

  async playlistItems(playlistId: string): Promise<BaseItemDto[]> {
    const res = await this.request<BaseItemDtoQueryResult>(`/Playlists/${playlistId}/Items`, {
      query: {
        userId: this.userId,
        enableUserData: true,
        enableImageTypes: ['Primary', 'Backdrop', 'Thumb'],
        fields: ['Overview', 'ParentId'],
      },
    })
    return res?.Items ?? []
  }

  async createPlaylist(name: string, itemIds: string[] = []): Promise<{ Id?: string }> {
    return this.request('/Playlists', {
      method: 'POST',
      body: JSON.stringify({ Name: name, Ids: itemIds, UserId: this.userId }),
    })
  }

  async addToPlaylist(playlistId: string, itemIds: string[]): Promise<void> {
    await this.request(`/Playlists/${playlistId}/Items`, {
      method: 'POST',
      query: { ids: itemIds, userId: this.userId },
    })
  }

  /** Removes by playlist entry id, which is not the item id. */
  async removeFromPlaylist(playlistId: string, entryIds: string[]): Promise<void> {
    await this.request(`/Playlists/${playlistId}/Items`, {
      method: 'DELETE',
      query: { entryIds },
    })
  }

  async movePlaylistItem(playlistId: string, entryId: string, newIndex: number): Promise<void> {
    await this.request(`/Playlists/${playlistId}/Items/${entryId}/Move/${newIndex}`, {
      method: 'POST',
    })
  }

  async deletePlaylist(playlistId: string): Promise<void> {
    await this.request(`/Items/${playlistId}`, { method: 'DELETE' })
  }

  // -------------------------------------------------------------- syncplay

  /** Server-side timestamps for the four-timestamp clock exchange. */
  async utcTime(): Promise<{ RequestReceptionTime: string; ResponseTransmissionTime: string }> {
    return this.request('/GetUtcTime')
  }

  async syncPlayGroups(): Promise<GroupInfoDto[]> {
    return (await this.request<GroupInfoDto[]>('/SyncPlay/List')) ?? []
  }

  async syncPlayNew(groupName: string): Promise<void> {
    await this.request('/SyncPlay/New', {
      method: 'POST',
      body: JSON.stringify({ GroupName: groupName }),
    })
  }

  async syncPlayJoin(groupId: string): Promise<void> {
    await this.request('/SyncPlay/Join', {
      method: 'POST',
      body: JSON.stringify({ GroupId: groupId }),
    })
  }

  async syncPlayLeave(): Promise<void> {
    await this.request('/SyncPlay/Leave', { method: 'POST' })
  }

  /*
    The group acts on these rather than the local player: pressing pause asks
    the server to pause everyone, and the resulting command comes back over the
    socket. Acting locally first would put this device out of step.
  */
  async syncPlayPlay(): Promise<void> {
    await this.request('/SyncPlay/Unpause', { method: 'POST' })
  }

  async syncPlayPause(): Promise<void> {
    await this.request('/SyncPlay/Pause', { method: 'POST' })
  }

  async syncPlaySeek(positionTicks: number): Promise<void> {
    await this.request('/SyncPlay/Seek', {
      method: 'POST',
      body: JSON.stringify({ PositionTicks: Math.max(0, Math.round(positionTicks)) }),
    })
  }

  /** Tells the group this device has buffered and is ready to resume. */
  async syncPlayReady(state: SyncPlayReadyState): Promise<void> {
    await this.request('/SyncPlay/Ready', { method: 'POST', body: JSON.stringify(state) })
  }

  /** Tells the group this device stalled, so everyone waits for it. */
  async syncPlayBuffering(state: SyncPlayReadyState): Promise<void> {
    await this.request('/SyncPlay/Buffering', { method: 'POST', body: JSON.stringify(state) })
  }

  /** Reports measured latency so the server can compensate per device. */
  async syncPlayPing(pingMs: number): Promise<void> {
    await this.request('/SyncPlay/Ping', {
      method: 'POST',
      body: JSON.stringify({ Ping: Math.round(pingMs) }),
    })
  }

  /**
   * A request whose response is expected to be a JSON array.
   *
   * Guarantees one. Jellyfin returns a bare array from some endpoints and a
   * QueryResult from others, a 204 from a few, and an error body if something
   * upstream goes wrong — and every caller here immediately does .map or
   * .find, which throws on anything else and takes the screen down with it.
   */
  private async requestArray<T>(
    path: string,
    init: RequestInit & { query?: Query } = {},
  ): Promise<T[]> {
    const res = await this.request<T[] | { Items?: T[] }>(path, init)
    if (Array.isArray(res)) return res
    const items = (res as { Items?: T[] } | undefined)?.Items
    return Array.isArray(items) ? items : []
  }

  // ---------------------------------------------------------------- images

  imageUrl(
    item: Pick<BaseItemDto, 'Id' | 'ImageTags' | 'BackdropImageTags'>,
    type: 'Primary' | 'Backdrop' | 'Thumb' | 'Logo',
    opts: { width?: number; height?: number; quality?: number } = {},
  ): string | null {
    if (!item.Id) return null
    const tag =
      type === 'Backdrop'
        ? item.BackdropImageTags?.[0]
        : (item.ImageTags as Record<string, string> | undefined)?.[type]
    if (!tag) return null
    return this.imageUrlFor(item.Id, type, tag, opts)
  }

  /** Shared by own-image and inherited-image lookups. */
  private imageUrlFor(
    itemId: string,
    type: string,
    tag: string,
    opts: { width?: number; height?: number; quality?: number } = {},
  ): string {
    return this.url(`/Items/${itemId}/Images/${type}`, {
      tag,
      // 96 matches the official client; 90 was visibly softer on flat artwork.
      quality: opts.quality ?? 96,
      fillWidth: opts.width ? scaleForDisplay(opts.width) : undefined,
      fillHeight: opts.height ? scaleForDisplay(opts.height) : undefined,
    })
  }

  /**
   * Falls back through parent ids so episodes can borrow series art.
   *
   * `height` is optional and only worth passing where the consumer needs a
   * known shape rather than a poster — OS media artwork, which is square.
   */
  posterUrl(item: BaseItemDto, width = 400, height?: number): string | null {
    const own = this.imageUrl(item, 'Primary', { width, height })
    if (own) return own
    const parentId = item.SeriesId ?? item.AlbumId ?? item.ParentId
    const parentTag = item.SeriesPrimaryImageTag ?? item.AlbumPrimaryImageTag
    if (parentId && parentTag) {
      return this.inherited(parentId, 'Primary', parentTag, width, height)
    }
    return null
  }

  private inherited(itemId: string, type: string, tag: string, width: number, height?: number) {
    return this.imageUrlFor(itemId, type, tag, { width, height })
  }

  /**
   * Cover art for the *title* an item belongs to, never a frame of it.
   *
   * `posterUrl` prefers an item's own Primary image, and an episode's Primary
   * is its screenshot — so asking it for an episode gets you a picture of a
   * scene, not the show. Anywhere the job is to identify what you are watching
   * rather than where you are in it, this is the one to use.
   */
  coverUrl(item: BaseItemDto, width = 400, height?: number): string | null {
    if (item.Type === 'Episode' && item.SeriesId && item.SeriesPrimaryImageTag) {
      return this.inherited(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag, width, height)
    }
    return this.posterUrl(item, width, height)
  }

  /**
   * Landscape artwork, in the order the official client uses.
   *
   * Thumb comes before Backdrop, and a series' Thumb is inherited — those two
   * details are why shows looked different here: Backdrop is wide *scenery*
   * art, while Thumb is the curated 16:9 image libraries actually set for a
   * show. Checking Backdrop first showed generic art where Jellyfin shows the
   * intended one.
   */
  backdropUrl(item: BaseItemDto, width = 1920): string | null {
    const ownThumb = this.imageUrl(item, 'Thumb', { width })
    if (ownThumb) return ownThumb

    if (item.SeriesId && item.SeriesThumbImageTag) {
      return this.inherited(item.SeriesId, 'Thumb', item.SeriesThumbImageTag, width)
    }
    if (item.ParentThumbItemId && item.ParentThumbImageTag) {
      return this.inherited(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag, width)
    }

    const ownBackdrop = this.imageUrl(item, 'Backdrop', { width })
    if (ownBackdrop) return ownBackdrop

    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0]) {
      return this.inherited(
        item.ParentBackdropItemId,
        'Backdrop',
        item.ParentBackdropImageTags[0],
        width,
      )
    }

    // An episode's own Primary is its 16:9 screenshot — a better landscape
    // fallback than nothing, and specific to that episode.
    if (item.Type === 'Episode') return this.imageUrl(item, 'Primary', { width })
    return null
  }

  /**
   * Scenery for the full-bleed hero. Deliberately Backdrop-only: Thumb art is
   * often a title card, which looks wrong stretched across the page.
   */
  heroBackdropUrl(item: BaseItemDto, width = 1920): string | null {
    const own = this.imageUrl(item, 'Backdrop', { width })
    if (own) return own
    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0]) {
      return this.inherited(
        item.ParentBackdropItemId,
        'Backdrop',
        item.ParentBackdropImageTags[0],
        width,
      )
    }
    return this.backdropUrl(item, width)
  }

  /**
   * The still for one item in a list — an episode row, most importantly.
   *
   * Own image first, deliberately the opposite of `backdropUrl`. A row of cards
   * inherits series art so you can recognise the show; a list of episodes
   * inside one season must show each episode's own screenshot, or every row
   * renders the same picture. The official client's list view has the same
   * split: it reads `ImageTags.Primary` before anything inherited.
   */
  stillUrl(item: BaseItemDto, width = 400): string | null {
    for (const type of ['Primary', 'Thumb', 'Backdrop'] as const) {
      const own = this.imageUrl(item, type, { width })
      if (own) return own
    }

    if (item.SeriesId && item.SeriesThumbImageTag) {
      return this.inherited(item.SeriesId, 'Thumb', item.SeriesThumbImageTag, width)
    }
    if (item.ParentThumbItemId && item.ParentThumbImageTag) {
      return this.inherited(item.ParentThumbItemId, 'Thumb', item.ParentThumbImageTag, width)
    }
    if (item.ParentBackdropItemId && item.ParentBackdropImageTags?.[0]) {
      return this.inherited(
        item.ParentBackdropItemId,
        'Backdrop',
        item.ParentBackdropImageTags[0],
        width,
      )
    }
    if (item.SeriesId && item.SeriesPrimaryImageTag) {
      return this.inherited(item.SeriesId, 'Primary', item.SeriesPrimaryImageTag, width)
    }
    return null
  }

  logoUrl(item: BaseItemDto, width = 640): string | null {
    const own = this.imageUrl(item, 'Logo', { width })
    if (own) return own
    if (item.ParentLogoItemId && item.ParentLogoImageTag) {
      return this.inherited(item.ParentLogoItemId, 'Logo', item.ParentLogoImageTag, width)
    }
    return null
  }

  // ------------------------------------------------------------- item reads

  views() {
    return this.request<BaseItemDtoQueryResult>('/UserViews', {
      query: { userId: this.userId },
    })
  }

  item(itemId: string) {
    return this.request<BaseItemDto>(`/Items/${itemId}`, {
      // Trailer fields are not returned unless asked for by name.
      query: {
        userId: this.userId,
        fields: ['RemoteTrailers', 'LocalTrailerCount', 'Chapters'],
      },
    })
  }

  /**
   * Intro, recap and credits ranges, when something has scanned for them.
   * An empty list simply means no skip buttons, never an error.
   */
  async mediaSegments(itemId: string): Promise<MediaSegment[]> {
    const res = await this.request<{ Items?: MediaSegment[] } | MediaSegment[]>(
      `/MediaSegments/${itemId}`,
      { query: { includeSegmentTypes: ['Intro', 'Outro', 'Recap', 'Preview', 'Commercial'] } },
    )
    // Jellyfin returns a QueryResult here, but a bare array elsewhere; accept both.
    return Array.isArray(res) ? res : (res?.Items ?? [])
  }

  /** Trailer files held on the server, playable like any other item. */
  async localTrailers(itemId: string): Promise<BaseItemDto[]> {
    return (
      (await this.request<BaseItemDto[]>(`/Items/${itemId}/LocalTrailers`, {
        query: { userId: this.userId },
      })) ?? []
    )
  }

  items(query: Query) {
    return this.request<BaseItemDtoQueryResult>('/Items', {
      query: {
        userId: this.userId,
        enableUserData: true,
        enableImageTypes: ['Primary', 'Backdrop', 'Thumb', 'Logo'],
        imageTypeLimit: 1,
        ...query,
      },
    })
  }

  resume(query: Query = {}) {
    return this.request<BaseItemDtoQueryResult>('/UserItems/Resume', {
      query: {
        userId: this.userId,
        limit: 20,
        mediaTypes: ['Video'],
        enableUserData: true,
        enableImageTypes: ['Primary', 'Backdrop', 'Thumb', 'Logo'],
        imageTypeLimit: 1,
        fields: ['Overview', 'PrimaryImageAspectRatio', 'ParentId', 'Genres', 'Studios', 'Tags'],
        ...query,
      },
    })
  }

  nextUp(query: Query = {}) {
    return this.request<BaseItemDtoQueryResult>('/Shows/NextUp', {
      query: {
        userId: this.userId,
        limit: 20,
        enableUserData: true,
        enableImageTypes: ['Primary', 'Backdrop', 'Thumb', 'Logo'],
        imageTypeLimit: 1,
        fields: ['Overview', 'ParentId', 'Genres', 'Studios', 'Tags'],
        ...query,
      },
    })
  }

  /** /Items/Latest returns a bare array, not a query result. */
  latest(query: Query = {}) {
    return this.requestArray<BaseItemDto>('/Items/Latest', {
      query: {
        userId: this.userId,
        limit: 20,
        groupItems: true,
        enableUserData: true,
        enableImageTypes: ['Primary', 'Backdrop', 'Thumb', 'Logo'],
        imageTypeLimit: 1,
        fields: ['Overview', 'ParentId', 'Genres', 'Studios', 'Tags'],
        ...query,
      },
    })
  }

  similar(itemId: string, limit = 16) {
    return this.request<BaseItemDtoQueryResult>(`/Items/${itemId}/Similar`, {
      query: {
        userId: this.userId,
        limit,
        enableUserData: true,
        fields: ['Overview'],
      },
    })
  }

  seasons(seriesId: string) {
    return this.request<BaseItemDtoQueryResult>(`/Shows/${seriesId}/Seasons`, {
      query: { userId: this.userId, enableUserData: true },
    })
  }

  episodes(seriesId: string, seasonId?: string) {
    return this.request<BaseItemDtoQueryResult>(`/Shows/${seriesId}/Episodes`, {
      query: {
        userId: this.userId,
        seasonId,
        enableUserData: true,
        fields: ['Overview', 'MediaSources'],
      },
    })
  }

  searchHints(term: string, limit = 40) {
    return this.request<SearchHintResult>('/Search/Hints', {
      query: {
        userId: this.userId,
        searchTerm: term,
        limit,
        includeItemTypes: ['Movie', 'Series', 'Episode', 'BoxSet'],
      },
    })
  }

  // ------------------------------------------------------------ user state

  setFavorite(itemId: string, favorite: boolean) {
    return this.request<unknown>(`/UserFavoriteItems/${itemId}`, {
      method: favorite ? 'POST' : 'DELETE',
      query: { userId: this.userId },
    })
  }

  /**
   * Marks an item watched or unwatched. Pointed at a series or season the
   * server cascades to the episodes inside, which is what makes "mark season
   * watched" a single call.
   */
  setPlayed(itemId: string, played: boolean) {
    return this.request<unknown>(`/UserPlayedItems/${itemId}`, {
      method: played ? 'POST' : 'DELETE',
      query: { userId: this.userId },
    })
  }

  // ------------------------------------------------------------ system/admin

  currentUser() {
    return this.request<UserDto>('/Users/Me')
  }

  systemInfo() {
    return this.request<SystemInfo>('/System/Info')
  }

  itemCounts() {
    return this.request<ItemCounts>('/Items/Counts')
  }

  allUsers() {
    return this.requestArray<UserDto>('/Users')
  }

  /** Sessions seen recently — the server keeps stale ones around otherwise. */
  sessions(activeWithinSeconds = 960) {
    return this.requestArray<SessionInfoDto>('/Sessions', { query: { activeWithinSeconds } })
  }

  scheduledTasks() {
    return this.requestArray<TaskInfo>('/ScheduledTasks', { query: { isHidden: false } })
  }

  runTask(taskId: string) {
    return this.request<void>(`/ScheduledTasks/Running/${taskId}`, { method: 'POST' })
  }

  stopTask(taskId: string) {
    return this.request<void>(`/ScheduledTasks/Running/${taskId}`, { method: 'DELETE' })
  }

  activityLog(limit = 20) {
    return this.request<{ Items?: ActivityLogEntry[]; TotalRecordCount?: number }>(
      '/System/ActivityLog/Entries',
      { query: { limit, startIndex: 0 } },
    )
  }

  refreshLibraries() {
    return this.request<void>('/Library/Refresh', { method: 'POST' })
  }

  // -------------------------------------------------------- user management
  // 10.11 moved most of these: updates POST to /Users?userId=, not
  // /Users/{userId}, and passwords live at /Users/Password.

  createUser(name: string, password?: string) {
    return this.request<UserDto>('/Users/New', {
      method: 'POST',
      body: JSON.stringify({ Name: name, Password: password || undefined }),
    })
  }

  deleteUser(userId: string) {
    return this.request<void>(`/Users/${userId}`, { method: 'DELETE' })
  }

  updateUser(userId: string, user: UserDto) {
    return this.request<void>('/Users', {
      method: 'POST',
      query: { userId },
      body: JSON.stringify(user),
    })
  }

  updateUserPolicy(userId: string, policy: UserPolicy) {
    return this.request<void>(`/Users/${userId}/Policy`, {
      method: 'POST',
      body: JSON.stringify(policy),
    })
  }

  /** Admins may set another user's password without knowing the current one. */
  setUserPassword(userId: string, newPassword: string) {
    return this.request<void>('/Users/Password', {
      method: 'POST',
      query: { userId },
      body: JSON.stringify({ NewPw: newPassword, ResetPassword: false }),
    })
  }

  /** Clears the password entirely — the account then signs in with none. */
  resetUserPassword(userId: string) {
    return this.request<void>('/Users/Password', {
      method: 'POST',
      query: { userId },
      body: JSON.stringify({ ResetPassword: true }),
    })
  }

  // ------------------------------------------------------------------- logs

  logFiles() {
    return this.requestArray<LogFile>('/System/Logs')
  }

  /** Log contents are plain text, not JSON. */
  async logFile(name: string): Promise<string> {
    const res = await fetch(this.url('/System/Logs/Log', { name }), {
      headers: { Authorization: authHeader(this.session.token) },
    })
    if (!res.ok) throw new ApiError(`Could not read ${name} (${res.status})`, res.status)
    return res.text()
  }

  // --------------------------------------------------------- configuration
  // Named config sections live under /System/Configuration/{key}; the root
  // document is the ServerConfiguration itself.

  networkConfig() {
    return this.request<NetworkConfiguration>('/System/Configuration/network')
  }

  saveNetworkConfig(config: NetworkConfiguration) {
    return this.request<void>('/System/Configuration/network', {
      method: 'POST',
      body: JSON.stringify(config),
    })
  }

  serverConfig() {
    return this.request<ServerConfiguration>('/System/Configuration')
  }

  saveServerConfig(config: ServerConfiguration) {
    return this.request<void>('/System/Configuration', {
      method: 'POST',
      body: JSON.stringify(config),
    })
  }

  encodingConfig() {
    return this.request<EncodingOptions>('/System/Configuration/encoding')
  }

  saveEncodingConfig(config: EncodingOptions) {
    return this.request<void>('/System/Configuration/encoding', {
      method: 'POST',
      body: JSON.stringify(config),
    })
  }

  branding() {
    return this.request<BrandingOptionsDto>('/Branding/Configuration')
  }

  saveBranding(options: BrandingOptionsDto) {
    return this.request<void>('/System/Configuration/Branding', {
      method: 'POST',
      body: JSON.stringify(options),
    })
  }

  // ------------------------------------------------------------- libraries

  virtualFolders() {
    return this.requestArray<VirtualFolderInfo>('/Library/VirtualFolders')
  }

  addLibrary(opts: {
    name: string
    collectionType?: string
    paths: string[]
    libraryOptions?: LibraryOptions
  }) {
    return this.request<void>('/Library/VirtualFolders', {
      method: 'POST',
      query: {
        name: opts.name,
        collectionType: opts.collectionType,
        paths: opts.paths,
        refreshLibrary: true,
      },
      body: JSON.stringify({ LibraryOptions: opts.libraryOptions ?? {} }),
    })
  }

  removeLibrary(name: string) {
    return this.request<void>('/Library/VirtualFolders', {
      method: 'DELETE',
      query: { name, refreshLibrary: true },
    })
  }

  renameLibrary(name: string, newName: string) {
    return this.request<void>('/Library/VirtualFolders/Name', {
      method: 'POST',
      query: { name, newName },
    })
  }

  saveLibraryOptions(id: string, libraryOptions: LibraryOptions) {
    return this.request<void>('/Library/VirtualFolders/LibraryOptions', {
      method: 'POST',
      body: JSON.stringify({ Id: id, LibraryOptions: libraryOptions }),
    })
  }

  addLibraryPath(name: string, path: string) {
    return this.request<void>('/Library/VirtualFolders/Paths', {
      method: 'POST',
      body: JSON.stringify({ Name: name, PathInfo: { Path: path } }),
    })
  }

  removeLibraryPath(name: string, path: string) {
    return this.request<void>('/Library/VirtualFolders/Paths', {
      method: 'DELETE',
      query: { name, path, refreshLibrary: true },
    })
  }

  /** Server-side file browser, for picking library folders. */
  directoryContents(path: string) {
    return this.requestArray<FileSystemEntryInfo>('/Environment/DirectoryContents', {
      query: { path, includeDirectories: true, includeFiles: false },
    })
  }

  drives() {
    return this.requestArray<FileSystemEntryInfo>('/Environment/Drives')
  }

  // ------------------------------------------------- plugins, keys, culture

  plugins() {
    return this.requestArray<PluginInfo>('/Plugins')
  }

  uninstallPlugin(pluginId: string) {
    return this.request<void>(`/Plugins/${pluginId}`, { method: 'DELETE' })
  }

  /** The catalogue, aggregated from every enabled repository. */
  packages() {
    return this.requestArray<PackageInfo>('/Packages')
  }

  installPackage(
    name: string,
    opts: { version?: string; repositoryUrl?: string; assemblyGuid?: string } = {},
  ) {
    return this.request<void>(`/Packages/Installed/${encodeURIComponent(name)}`, {
      method: 'POST',
      query: {
        version: opts.version,
        repositoryUrl: opts.repositoryUrl,
        assemblyGuid: opts.assemblyGuid,
      },
    })
  }

  cancelInstall(packageId: string) {
    return this.request<void>(`/Packages/Installing/${packageId}`, { method: 'DELETE' })
  }

  repositories() {
    return this.requestArray<RepositoryInfo>('/Repositories')
  }

  saveRepositories(repositories: RepositoryInfo[]) {
    return this.request<void>('/Repositories', {
      method: 'POST',
      body: JSON.stringify(repositories),
    })
  }

  apiKeys() {
    return this.request<{ Items?: AuthenticationInfo[] }>('/Auth/Keys')
  }

  createApiKey(app: string) {
    return this.request<void>('/Auth/Keys', { method: 'POST', query: { app } })
  }

  revokeApiKey(key: string) {
    return this.request<void>(`/Auth/Keys/${key}`, { method: 'DELETE' })
  }

  cultures() {
    return this.requestArray<CultureDto>('/Localization/Cultures')
  }

  countries() {
    return this.requestArray<CountryInfo>('/Localization/Countries')
  }

  localizationOptions() {
    return this.requestArray<LocalizationOption>('/Localization/Options')
  }

  quickConnectEnabled() {
    return this.request<boolean>('/QuickConnect/Enabled')
  }

  // ------------------------------------------------------- item metadata

  /** Full-item update — the server replaces the record with what we send. */
  updateItem(itemId: string, item: BaseItemDto) {
    return this.request<void>(`/Items/${itemId}`, {
      method: 'POST',
      body: JSON.stringify(item),
    })
  }

  refreshItem(
    itemId: string,
    opts: { replaceAllMetadata?: boolean; replaceAllImages?: boolean } = {},
  ) {
    return this.request<void>(`/Items/${itemId}/Refresh`, {
      method: 'POST',
      query: {
        metadataRefreshMode: 'FullRefresh',
        imageRefreshMode: 'FullRefresh',
        replaceAllMetadata: opts.replaceAllMetadata ?? false,
        replaceAllImages: opts.replaceAllImages ?? false,
      },
    })
  }

  // -------------------------------------------------------------- playback

  /**
   * Everything goes in the body, matching the official client. Splitting these
   * across query string and body is a path the server barely exercises, and
   * 10.11 answers some of those combinations with a 500.
   */
  async playbackInfo(
    itemId: string,
    opts: {
      startTimeTicks?: number
      audioStreamIndex?: number
      subtitleStreamIndex?: number
      maxStreamingBitrate?: number
      mediaSourceId?: string
    } = {},
  ): Promise<PlaybackInfoResponse> {
    const body: Record<string, unknown> = {
      UserId: this.userId,
      StartTimeTicks: opts.startTimeTicks ?? 0,
      MaxStreamingBitrate: opts.maxStreamingBitrate ?? 120_000_000,
      EnableDirectPlay: true,
      EnableDirectStream: true,
      EnableTranscoding: true,
      AllowVideoStreamCopy: true,
      AllowAudioStreamCopy: true,
      AutoOpenLiveStream: true,
      DeviceProfile: deviceProfile(),
    }
    if (opts.audioStreamIndex != null) {
      body.AudioStreamIndex = opts.audioStreamIndex
      /*
        Direct play serves the original file untouched, so the server ignores
        the requested audio track and the browser plays whatever the container
        lists first — picking a second language appeared to do nothing.

        Direct stream (remux) *can* select a track, so only direct play has to
        go; a remux is still far cheaper than a transcode.
      */
      body.EnableDirectPlay = false
    }
    if (opts.subtitleStreamIndex != null) {
      body.SubtitleStreamIndex = opts.subtitleStreamIndex
      // Burning subtitles into the picture means re-encoding it, so neither
      // passthrough mode can serve this.
      body.EnableDirectPlay = false
      body.EnableDirectStream = false
    }
    if (opts.mediaSourceId) body.MediaSourceId = opts.mediaSourceId

    const post = (payload: Record<string, unknown>) =>
      this.request<PlaybackInfoResponse>(`/Items/${itemId}/PlaybackInfo`, {
        method: 'POST',
        body: JSON.stringify(payload),
      })

    try {
      return await post(body)
    } catch (err) {
      // A rejected device profile shouldn't cost the user playback entirely —
      // retry bare and let the server pick its own defaults.
      const { DeviceProfile: _rejected, ...withoutProfile } = body
      console.warn(
        '[playback] PlaybackInfo failed with our device profile, retrying without it.',
        err,
      )
      return await post(withoutProfile)
    }
  }

  reportStart(body: Record<string, unknown>) {
    return this.request<void>('/Sessions/Playing', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  reportProgress(body: Record<string, unknown>) {
    return this.request<void>('/Sessions/Playing/Progress', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }

  reportStopped(body: Record<string, unknown>) {
    return this.request<void>('/Sessions/Playing/Stopped', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  }
}

// ------------------------------------------------------------------- login

/**
 * fetch() rejects with a bare TypeError ("Failed to fetch") for DNS failures,
 * refused connections and mixed content — useless to show a user, so every
 * unauthenticated call routes through here.
 */
async function reachableFetch(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch {
    throw new ApiError(
      'Could not reach that server. Check the address, and that it is running and reachable from this device.',
      0,
    )
  }
}

export async function authenticate(
  serverInput: string,
  username: string,
  password: string,
): Promise<Session> {
  const server = normalizeServer(serverInput)
  const res = await reachableFetch(buildUrl(server, '/Users/AuthenticateByName'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify({ Username: username, Pw: password }),
  })
  if (res.status === 401) throw new ApiError('Incorrect username or password.', 401)
  if (!res.ok) throw new ApiError(`Sign-in failed (${res.status}).`, res.status)

  const data = (await res.json()) as { AccessToken: string; User: UserDto }
  if (!data.AccessToken || !data.User?.Id) {
    throw new ApiError('The server accepted the sign-in but returned no session.', res.status)
  }
  return {
    server,
    token: data.AccessToken,
    userId: data.User.Id,
    userName: data.User.Name ?? username,
  }
}

export async function publicUsers(serverInput: string): Promise<UserDto[]> {
  const server = normalizeServer(serverInput)
  const res = await reachableFetch(buildUrl(server, '/Users/Public'), {
    headers: { Authorization: authHeader() },
  })
  if (!res.ok) throw new ApiError(`Could not list users (${res.status}).`, res.status)
  return res.json()
}

export async function serverInfo(serverInput: string) {
  const server = normalizeServer(serverInput)
  const res = await reachableFetch(buildUrl(server, '/System/Info/Public'))
  if (!res.ok) {
    throw new ApiError(
      `That address answered, but not like a Jellyfin server (${res.status}).`,
      res.status,
    )
  }
  return res.json() as Promise<{ ServerName: string; Version: string; Id: string }>
}

// ----------------------------------------------------------- device profile

/**
 * Tells the server what this browser can play natively so it direct-plays where
 * possible and only transcodes what it must. Codec support is probed at runtime.
 */
function canPlay(type: string): boolean {
  const el = document.createElement('video')
  return el.canPlayType(type) !== ''
}

export function deviceProfile() {
  const supportsHevc =
    canPlay('video/mp4; codecs="hvc1.1.6.L120.90"') ||
    canPlay('video/mp4; codecs="hev1.1.6.L120.90"')
  const supportsAv1 = canPlay('video/mp4; codecs="av01.0.08M.08"')
  const supportsVp9 = canPlay('video/webm; codecs="vp9"')

  const mp4Video = ['h264', ...(supportsHevc ? ['hevc'] : []), ...(supportsAv1 ? ['av1'] : [])]
  const hlsVideo = [...mp4Video]

  return {
    MaxStreamingBitrate: 120_000_000,
    MaxStaticBitrate: 100_000_000,
    MusicStreamingTranscodingBitrate: 384_000,
    DirectPlayProfiles: [
      {
        Container: 'mp4,m4v',
        Type: 'Video',
        VideoCodec: mp4Video.join(','),
        AudioCodec: 'aac,mp3,opus,flac,alac',
      },
      {
        Container: 'webm',
        Type: 'Video',
        VideoCodec: [...(supportsVp9 ? ['vp9'] : []), 'vp8', ...(supportsAv1 ? ['av1'] : [])].join(
          ',',
        ),
        AudioCodec: 'vorbis,opus',
      },
      { Container: 'mp3', Type: 'Audio' },
      { Container: 'aac', Type: 'Audio' },
      { Container: 'm4a', AudioCodec: 'aac', Type: 'Audio' },
      { Container: 'flac', Type: 'Audio' },
      { Container: 'webma', Type: 'Audio' },
      { Container: 'opus', Type: 'Audio' },
    ],
    TranscodingProfiles: [
      {
        Container: 'ts',
        Type: 'Video',
        AudioCodec: 'aac,mp3',
        VideoCodec: hlsVideo.join(','),
        Context: 'Streaming',
        Protocol: 'hls',
        MaxAudioChannels: '2',
        MinSegments: 1,
        BreakOnNonKeyFrames: true,
      },
      {
        Container: 'mp4',
        Type: 'Video',
        AudioCodec: 'aac',
        VideoCodec: 'h264',
        Context: 'Static',
        Protocol: 'http',
      },
      {
        Container: 'mp3',
        Type: 'Audio',
        AudioCodec: 'mp3',
        Context: 'Streaming',
        Protocol: 'http',
        MaxAudioChannels: '2',
      },
    ],
    ContainerProfiles: [],
    CodecProfiles: [
      {
        Type: 'VideoAudio',
        Codec: 'aac',
        Conditions: [
          {
            Condition: 'Equals',
            Property: 'IsSecondaryAudio',
            Value: 'false',
            IsRequired: false,
          },
        ],
      },
      {
        Type: 'Video',
        Codec: 'h264',
        Conditions: [
          { Condition: 'NotEquals', Property: 'IsAnamorphic', Value: 'true', IsRequired: false },
          {
            Condition: 'EqualsAny',
            Property: 'VideoProfile',
            Value: 'high|main|baseline|constrained baseline',
            IsRequired: false,
          },
          { Condition: 'LessThanEqual', Property: 'VideoLevel', Value: '52', IsRequired: false },
          {
            Condition: 'NotEquals',
            Property: 'IsInterlaced',
            Value: 'true',
            IsRequired: false,
          },
        ],
      },
    ],
    SubtitleProfiles: [
      { Format: 'vtt', Method: 'External' },
      { Format: 'ass', Method: 'External' },
      { Format: 'ssa', Method: 'External' },
      { Format: 'subrip', Method: 'External' },
    ],
  }
}
