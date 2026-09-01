import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import type {
  BaseItemDto,
  LibraryOptions,
  NetworkConfiguration,
  RepositoryInfo,
  UserDto,
  UserPolicy,
} from '@jellyfin/sdk/lib/generated-client/models'
import type { JellyfinApi } from './api'
import { useApi } from './auth'
import { buildTasteProfile } from './taste'
import * as seerr from './jellyseerr'
import { autoConnectError, settleConnect } from './jellyseerrConnect'
import { browsableTypes, isBrowsableLibrary } from './collections'
import { planResumeRemoval } from './continueWatching'
import { PLAYED_QUERY_KEYS, runBulkPlayed, shouldInvalidateAfter } from './bulkPlayed'
import type { BulkPlayedProgress } from './bulkPlayed'

// Genres/Studios/Tags are the facets the match score reads, so every list that
// feeds a card has to carry them or the same title would score differently
// depending on where it appeared.
const STANDARD_FIELDS = [
  'Overview',
  'Genres',
  'Studios',
  'Tags',
  'ParentId',
  'PrimaryImageAspectRatio',
  'ProductionYear',
]

export function useViews() {
  const api = useApi()
  return useQuery({
    queryKey: ['views', api.userId],
    queryFn: async () => (await api.views()).Items ?? [],
    staleTime: 10 * 60 * 1000,
  })
}

export function useResume() {
  const api = useApi()
  return useQuery({
    queryKey: ['resume', api.userId],
    queryFn: async () => (await api.resume()).Items ?? [],
  })
}

export function useNextUp() {
  const api = useApi()
  return useQuery({
    queryKey: ['nextUp', api.userId],
    queryFn: async () => (await api.nextUp()).Items ?? [],
  })
}

export function useLatest(parentId?: string, limit = 20) {
  const api = useApi()
  return useQuery({
    queryKey: ['latest', api.userId, parentId, limit],
    queryFn: () => api.latest({ parentId, limit }),
  })
}

/** Generic /Items row — the workhorse behind most home carousels. */
export function useItemsRow(key: string, query: Record<string, unknown>, enabled = true) {
  const api = useApi()
  return useQuery({
    queryKey: ['itemsRow', api.userId, key, query],
    queryFn: async () =>
      (
        await api.items({
          fields: STANDARD_FIELDS,
          ...(query as Record<string, string | number | boolean | string[]>),
        })
      ).Items ?? [],
    enabled,
  })
}

export function useItem(itemId?: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['item', api.userId, itemId],
    queryFn: () => api.item(itemId!),
    enabled: Boolean(itemId),
  })
}

/**
 * Trailer files on the server. Only fetched when the item says it has some,
 * so the common case costs no request at all.
 */
export function useLocalTrailers(itemId?: string, count = 0) {
  const api = useApi()
  return useQuery({
    queryKey: ['localTrailers', api.userId, itemId],
    queryFn: () => api.localTrailers(itemId!),
    enabled: Boolean(itemId) && count > 0,
    staleTime: 10 * 60 * 1000,
  })
}

/**
 * Skip ranges for the item being played. Failure is silent by design: a
 * server with no segment data must simply show no buttons.
 */
export function useMediaSegments(itemId?: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['segments', itemId],
    queryFn: () => api.mediaSegments(itemId!).catch(() => []),
    enabled: Boolean(itemId),
    staleTime: 30 * 60 * 1000,
    retry: false,
  })
}

/**
 * Every collection (box set) this user can see, in the order a curator would
 * expect to find them.
 *
 * Deliberately one query with no arguments. The home shelf, the nav entry and
 * the collections grid all read it, and they have to agree about whether the
 * server has any at all — a per-caller limit would key them apart and let the
 * nav decide one thing while the shelf decided another.
 */
export function useBoxSets() {
  const api = useApi()
  return useQuery({
    queryKey: ['boxSets', api.userId],
    queryFn: async () =>
      (
        await api.items({
          includeItemTypes: ['BoxSet'],
          recursive: true,
          sortBy: ['SortName'],
          sortOrder: ['Ascending'],
          limit: 100,
          fields: ['ChildCount', 'PrimaryImageAspectRatio'],
        })
      ).Items ?? [],
    staleTime: 5 * 60 * 1000,
  })
}

export function usePlaylists() {
  const api = useApi()
  return useQuery({
    queryKey: ['playlists', api.userId],
    queryFn: () => api.playlists(),
    staleTime: 60 * 1000,
  })
}

export function usePlaylistItems(playlistId?: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['playlistItems', api.userId, playlistId],
    queryFn: () => api.playlistItems(playlistId!),
    enabled: Boolean(playlistId),
  })
}

/**
 * Playlist mutations. Every one invalidates both the list and its contents,
 * because adding to a playlist changes its child count as well as its items.
 */
function usePlaylistMutation<T>(fn: (api: JellyfinApi, vars: T) => Promise<unknown>) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: T) => fn(api, vars),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['playlists'] })
      void qc.invalidateQueries({ queryKey: ['playlistItems'] })
    },
  })
}

export const useCreatePlaylist = () =>
  usePlaylistMutation<{ name: string; itemIds?: string[] }>((api, v) =>
    api.createPlaylist(v.name, v.itemIds ?? []),
  )

export const useAddToPlaylist = () =>
  usePlaylistMutation<{ playlistId: string; itemIds: string[] }>((api, v) =>
    api.addToPlaylist(v.playlistId, v.itemIds),
  )

export const useRemoveFromPlaylist = () =>
  usePlaylistMutation<{ playlistId: string; entryIds: string[] }>((api, v) =>
    api.removeFromPlaylist(v.playlistId, v.entryIds),
  )

export const useMovePlaylistItem = () =>
  usePlaylistMutation<{ playlistId: string; entryId: string; newIndex: number }>((api, v) =>
    api.movePlaylistItem(v.playlistId, v.entryId, v.newIndex),
  )

export const useDeletePlaylist = () =>
  usePlaylistMutation<{ playlistId: string }>((api, v) => api.deletePlaylist(v.playlistId))

export function useSimilar(itemId?: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['similar', api.userId, itemId],
    queryFn: async () => (await api.similar(itemId!)).Items ?? [],
    enabled: Boolean(itemId),
  })
}

export function useSeasons(seriesId?: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['seasons', api.userId, seriesId],
    queryFn: async () => (await api.seasons(seriesId!)).Items ?? [],
    enabled: Boolean(seriesId),
  })
}

/** Omitting `seasonId` returns every episode in the series, in order. */
export function useEpisodes(seriesId?: string, seasonId?: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['episodes', api.userId, seriesId, seasonId],
    queryFn: async () => {
      if (!seriesId) return []
      return (await api.episodes(seriesId, seasonId)).Items ?? []
    },
    // Only the series is required — gating on the season too meant a series
    // page could never resolve what its Play button should start.
    enabled: Boolean(seriesId),
  })
}

export function useSearch(term: string) {
  const api = useApi()
  const trimmed = term.trim()
  return useQuery({
    queryKey: ['search', api.userId, trimmed],
    queryFn: async () => {
      // Search hints are fast but thin; re-fetch full items so cards have art + user data.
      const hints = await api.searchHints(trimmed)
      const ids = (hints.SearchHints ?? [])
        .map((h) => h.Id)
        .filter((id): id is string => Boolean(id))
      if (ids.length === 0) return [] as BaseItemDto[]
      const full = await api.items({ ids, fields: STANDARD_FIELDS, limit: ids.length })
      // Preserve relevance order from the hint endpoint.
      const byId = new Map((full.Items ?? []).map((i) => [i.Id, i]))
      return ids.map((id) => byId.get(id)).filter((i): i is BaseItemDto => Boolean(i))
    },
    enabled: trimmed.length > 1,
    staleTime: 60 * 1000,
  })
}

/**
 * Search each library separately so results arrive already grouped.
 *
 * One query fanning out in parallel rather than a query per library: that keeps
 * counts available for the filter chips even while a section is hidden, which
 * a component-per-library arrangement could not do without mounting them all.
 */
export function useSearchByLibrary(term: string) {
  const api = useApi()
  const { data: views, isPending: viewsPending } = useViews()
  const libraries = (views ?? []).filter((v) => isBrowsableLibrary(v.CollectionType))
  const trimmed = term.trim()

  return useQuery({
    queryKey: ['searchByLibrary', api.userId, trimmed, libraries.map((v) => v.Id).join(',')],
    queryFn: async () => {
      const groups = await Promise.all(
        libraries.map(async (view) => {
          const res = await api.items({
            parentId: view.Id,
            searchTerm: trimmed,
            recursive: true,
            includeItemTypes: browsableTypes(view.CollectionType),
            limit: 24,
            fields: STANDARD_FIELDS,
          })
          return { view, items: res.Items ?? [], total: res.TotalRecordCount ?? 0 }
        }),
      )
      return groups.filter((g) => g.items.length > 0)
    },
    enabled: trimmed.length > 1 && !viewsPending && libraries.length > 0,
    staleTime: 60 * 1000,
  })
}

// ------------------------------------------------------------- system/admin

export function useCurrentUser() {
  const api = useApi()
  return useQuery({
    queryKey: ['me', api.userId],
    queryFn: () => api.currentUser(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useIsAdmin(): boolean {
  const { data } = useCurrentUser()
  return Boolean(data?.Policy?.IsAdministrator)
}

/** Admin panels poll, since sessions and task progress change under us. */
export function useSystemInfo() {
  const api = useApi()
  return useQuery({ queryKey: ['systemInfo'], queryFn: () => api.systemInfo() })
}

export function useItemCounts() {
  const api = useApi()
  return useQuery({ queryKey: ['itemCounts'], queryFn: () => api.itemCounts() })
}

export function useAllUsers() {
  const api = useApi()
  return useQuery({ queryKey: ['allUsers'], queryFn: () => api.allUsers() })
}

export function useSessions() {
  const api = useApi()
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.sessions(),
    refetchInterval: 5000,
  })
}

export function useScheduledTasks() {
  const api = useApi()
  return useQuery({
    queryKey: ['scheduledTasks'],
    queryFn: () => api.scheduledTasks(),
    refetchInterval: 5000,
  })
}

export function useActivityLog(limit = 20) {
  const api = useApi()
  return useQuery({
    queryKey: ['activityLog', limit],
    queryFn: async () => (await api.activityLog(limit)).Items ?? [],
    refetchInterval: 30_000,
  })
}

export function useRunTask() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (taskId: string) => api.runTask(taskId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduledTasks'] }),
  })
}

export function useRefreshLibraries() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.refreshLibraries(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scheduledTasks'] }),
  })
}

// --------------------------------------------------------- user management

/** Every user mutation ends the same way: refresh the list. */
function useUserMutation<TArgs>(fn: (api: JellyfinApi, args: TArgs) => Promise<unknown>) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(api, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['allUsers'] })
      qc.invalidateQueries({ queryKey: ['me'] })
    },
  })
}

export const useCreateUser = () =>
  useUserMutation<{ name: string; password?: string }>((api, a) =>
    api.createUser(a.name, a.password),
  )

export const useDeleteUser = () =>
  useUserMutation<{ userId: string }>((api, a) => api.deleteUser(a.userId))

export const useUpdateUser = () =>
  useUserMutation<{ userId: string; user: UserDto }>((api, a) =>
    api.updateUser(a.userId, a.user),
  )

export const useUpdateUserPolicy = () =>
  useUserMutation<{ userId: string; policy: UserPolicy }>((api, a) =>
    api.updateUserPolicy(a.userId, a.policy),
  )

export const useSetUserPassword = () =>
  useUserMutation<{ userId: string; password: string }>((api, a) =>
    api.setUserPassword(a.userId, a.password),
  )

export const useResetUserPassword = () =>
  useUserMutation<{ userId: string }>((api, a) => api.resetUserPassword(a.userId))

// ------------------------------------------------------------ logs, network

export function useLogFiles() {
  const api = useApi()
  return useQuery({ queryKey: ['logFiles'], queryFn: () => api.logFiles() })
}

export function useLogFile(name?: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['logFile', name],
    queryFn: () => api.logFile(name!),
    enabled: Boolean(name),
    // Logs are read for debugging; a stale view is worse than a refetch.
    staleTime: 0,
  })
}

export function useNetworkConfig() {
  const api = useApi()
  return useQuery({ queryKey: ['networkConfig'], queryFn: () => api.networkConfig() })
}

export function useSaveNetworkConfig() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: NetworkConfiguration) => api.saveNetworkConfig(config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['networkConfig'] }),
  })
}

// -------------------------------------------------- server configuration

/**
 * Config sections are all read-modify-write against one document, so each
 * pairs a query with a save mutation that invalidates it.
 */
function useConfigSection<T>(
  key: string,
  read: (api: JellyfinApi) => Promise<T>,
  write: (api: JellyfinApi, value: T) => Promise<unknown>,
) {
  const api = useApi()
  const qc = useQueryClient()
  const query = useQuery({ queryKey: [key], queryFn: () => read(api) })
  const save = useMutation({
    mutationFn: (value: T) => write(api, value),
    onSuccess: () => qc.invalidateQueries({ queryKey: [key] }),
  })
  return { query, save }
}

export const useServerConfig = () =>
  useConfigSection('serverConfig', (a) => a.serverConfig(), (a, v) => a.saveServerConfig(v))

export const useEncodingConfig = () =>
  useConfigSection('encodingConfig', (a) => a.encodingConfig(), (a, v) => a.saveEncodingConfig(v))

export const useBranding = () =>
  useConfigSection('branding', (a) => a.branding(), (a, v) => a.saveBranding(v))

export function useCultures() {
  const api = useApi()
  return useQuery({
    queryKey: ['cultures'],
    queryFn: () => api.cultures(),
    staleTime: Infinity,
  })
}

export function useCountries() {
  const api = useApi()
  return useQuery({
    queryKey: ['countries'],
    queryFn: () => api.countries(),
    staleTime: Infinity,
  })
}

export function useLocalizationOptions() {
  const api = useApi()
  return useQuery({
    queryKey: ['localizationOptions'],
    queryFn: () => api.localizationOptions(),
    staleTime: Infinity,
  })
}

// ------------------------------------------------------------- libraries

export function useVirtualFolders() {
  const api = useApi()
  return useQuery({ queryKey: ['virtualFolders'], queryFn: () => api.virtualFolders() })
}

function useLibraryMutation<TArgs>(fn: (api: JellyfinApi, args: TArgs) => Promise<unknown>) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(api, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['virtualFolders'] })
      qc.invalidateQueries({ queryKey: ['views'] })
    },
  })
}

export const useAddLibrary = () =>
  useLibraryMutation<{
    name: string
    collectionType?: string
    paths: string[]
    libraryOptions?: LibraryOptions
  }>((api, a) => api.addLibrary(a))

export const useRemoveLibrary = () =>
  useLibraryMutation<{ name: string }>((api, a) => api.removeLibrary(a.name))

export const useRenameLibrary = () =>
  useLibraryMutation<{ name: string; newName: string }>((api, a) =>
    api.renameLibrary(a.name, a.newName),
  )

export const useSaveLibraryOptions = () =>
  useLibraryMutation<{ id: string; libraryOptions: LibraryOptions }>((api, a) =>
    api.saveLibraryOptions(a.id, a.libraryOptions),
  )

export const useAddLibraryPath = () =>
  useLibraryMutation<{ name: string; path: string }>((api, a) => api.addLibraryPath(a.name, a.path))

export const useRemoveLibraryPath = () =>
  useLibraryMutation<{ name: string; path: string }>((api, a) =>
    api.removeLibraryPath(a.name, a.path),
  )

export function useDirectoryContents(path?: string) {
  const api = useApi()
  return useQuery({
    queryKey: ['directory', path],
    queryFn: () => (path ? api.directoryContents(path) : api.drives()),
  })
}

// ------------------------------------------------------- plugins, api keys

export function usePlugins() {
  const api = useApi()
  return useQuery({ queryKey: ['plugins'], queryFn: () => api.plugins() })
}

export function useUninstallPlugin() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (pluginId: string) => api.uninstallPlugin(pluginId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['plugins'] }),
  })
}

export function usePackages() {
  const api = useApi()
  return useQuery({
    queryKey: ['packages'],
    queryFn: () => api.packages(),
    staleTime: 5 * 60 * 1000,
  })
}

export function useInstallPackage() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: {
      name: string
      version?: string
      repositoryUrl?: string
      assemblyGuid?: string
    }) => api.installPackage(args.name, args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plugins'] })
      qc.invalidateQueries({ queryKey: ['systemInfo'] })
    },
  })
}

export function useRepositories() {
  const api = useApi()
  return useQuery({ queryKey: ['repositories'], queryFn: () => api.repositories() })
}

export function useSaveRepositories() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (repos: RepositoryInfo[]) => api.saveRepositories(repos),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repositories'] })
      qc.invalidateQueries({ queryKey: ['packages'] })
    },
  })
}

export function useApiKeys() {
  const api = useApi()
  return useQuery({
    queryKey: ['apiKeys'],
    queryFn: async () => (await api.apiKeys()).Items ?? [],
  })
}

function useApiKeyMutation<TArgs>(fn: (api: JellyfinApi, args: TArgs) => Promise<unknown>) {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (args: TArgs) => fn(api, args),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['apiKeys'] }),
  })
}

export const useCreateApiKey = () => useApiKeyMutation<{ app: string }>((a, x) => a.createApiKey(x.app))
export const useRevokeApiKey = () => useApiKeyMutation<{ key: string }>((a, x) => a.revokeApiKey(x.key))

// ---------------------------------------------------------- item metadata

export function useUpdateItem() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, item }: { itemId: string; item: BaseItemDto }) =>
      api.updateItem(itemId, item),
    onSuccess: (_d, { itemId }) => {
      qc.invalidateQueries({ queryKey: ['item', api.userId, itemId] })
      qc.invalidateQueries({ queryKey: ['seasons'] })
      qc.invalidateQueries({ queryKey: ['episodes'] })
      qc.invalidateQueries({ queryKey: ['itemsRow'] })
    },
  })
}

export function useRefreshItem() {
  const api = useApi()
  return useMutation({
    mutationFn: ({
      itemId,
      ...opts
    }: {
      itemId: string
      replaceAllMetadata?: boolean
      replaceAllImages?: boolean
    }) => api.refreshItem(itemId, opts),
  })
}

// ----------------------------------------------------------- taste profile

const TASTE_FIELDS = ['Genres', 'Studios', 'Tags']

/**
 * One fetch of what the user has watched and favourited, folded into a taste
 * profile. Cached for the session — it only shifts as they watch more.
 */
export function useTasteProfile() {
  const api = useApi()
  return useQuery({
    queryKey: ['tasteProfile', api.userId],
    queryFn: async () => {
      const [played, favourites] = await Promise.all([
        api.items({
          includeItemTypes: ['Movie', 'Series'],
          recursive: true,
          isPlayed: true,
          sortBy: ['DatePlayed'],
          sortOrder: ['Descending'],
          limit: 150,
          fields: TASTE_FIELDS,
          enableImages: false,
        }),
        api.items({
          includeItemTypes: ['Movie', 'Series'],
          recursive: true,
          isFavorite: true,
          limit: 100,
          fields: TASTE_FIELDS,
          enableImages: false,
        }),
      ])
      return buildTasteProfile(played.Items ?? [], favourites.Items ?? [])
    },
    staleTime: 15 * 60 * 1000,
  })
}

// -------------------------------------------------------------- jellyseerr

/**
 * Whether Jellyseerr is reachable and whether this browser has a session.
 * Both fail softly: the request UI simply doesn't appear.
 */
export function useJellyseerrSession() {
  const api = useApi()
  return useQuery({
    // Keyed by user: switching accounts must not reuse a cached session.
    queryKey: ['seerrSession', api.userId],
    queryFn: async () => {
      // If sign-in is mid-flight, wait for it. Reading now would see the gap
      // between the old cookie being cleared and the new one arriving, and
      // cache a "not signed in" for someone who is about to be.
      await settleConnect()

      // Public settings need no session, so this separates "not wired up" from
      // "wired up but not signed in".
      await seerr.publicSettings()
      try {
        const user = await seerr.currentUser()

        // The cookie is per-browser. If it belongs to somebody else, drop it
        // rather than letting this person request against their account.
        if (
          !seerr.sessionBelongsTo(user, {
            userId: api.session.userId,
            userName: api.session.userName,
          })
        ) {
          await seerr.signOut().catch(() => {})
          return { reachable: true, user: null, wrongAccount: true, autoError: null }
        }

        return { reachable: true, user, wrongAccount: false, autoError: null }
      } catch {
        // Surface why the automatic attempt failed, if it did — otherwise the
        // prompt to sign in gives no clue what went wrong.
        return {
          reachable: true,
          user: null,
          wrongAccount: false,
          autoError: autoConnectError(),
        }
      }
    },
    retry: false,
    // Short: a cached "not signed in" that outlives the actual state is exactly
    // the failure this had.
    staleTime: 30 * 1000,
  })
}

export function useRuntimeConfig() {
  return useQuery({
    queryKey: ['runtimeConfig'],
    queryFn: () => seerr.runtimeConfig(),
    retry: false,
    staleTime: 60 * 1000,
  })
}

export function useSaveRuntimeConfig() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<seerr.RuntimeConfig>) =>
      seerr.saveRuntimeConfig(config, {
        server: api.session.server,
        token: api.session.token,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runtimeConfig'] })
      qc.invalidateQueries({ queryKey: ['seerrSession'] })
      qc.invalidateQueries({ queryKey: ['seerrSearch'] })
    },
  })
}

export function useJellyseerrSignIn() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      seerr.signIn(username, password),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seerrSession'] }),
  })
}

export function useJellyseerrSignOut() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => seerr.signOut(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seerrSession'] }),
  })
}

export function useJellyseerrSearch(term: string, enabled: boolean) {
  const trimmed = term.trim()
  return useQuery({
    queryKey: ['seerrSearch', trimmed],
    queryFn: () => seerr.search(trimmed),
    enabled: enabled && trimmed.length > 1,
    retry: false,
    staleTime: 60 * 1000,
  })
}

export function useRequestMedia() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: seerr.RequestPayload) => seerr.requestMedia(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['seerrSearch'] }),
  })
}

/**
 * Marking anything played changes counts and progress across the whole app —
 * home rows, next up, the episode list — so this invalidates broadly rather
 * than trying to predict what moved.
 */
export function useTogglePlayed() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, played }: { itemId: string; played: boolean }) =>
      api.setPlayed(itemId, played),
    onSuccess: () => {
      for (const key of PLAYED_QUERY_KEYS) {
        qc.invalidateQueries({ queryKey: [key] })
      }
    },
  })
}

/**
 * Marking every episode of a season or a series in one press.
 *
 * There is no bulk playstate route, so this is a fan-out: fetch the episode
 * list, work out which of them actually need writing, then send them a few at
 * a time. All of the decisions — what to skip, how to batch, whether to ask
 * first, what to say afterwards — live in `bulkPlayed.ts` where they are
 * tested; nothing here chooses anything.
 *
 * The mutation resolves to an outcome rather than throwing on failure, because
 * "40 of 62 worked" is a result the viewer has to see, not an error to swallow.
 * The caches are refetched on a partial run for the same reason: the badges
 * must show the half-marked truth rather than an optimistic guess.
 */
export function useBulkPlayed() {
  const api = useApi()
  const qc = useQueryClient()
  const [progress, setProgress] = useState<BulkPlayedProgress | null>(null)

  const mutation = useMutation({
    mutationFn: ({ item, played }: { item: BaseItemDto; played: boolean }) =>
      runBulkPlayed({
        item,
        played,
        listEpisodes: async (seriesId, seasonId) =>
          (await api.episodes(seriesId, seasonId)).Items ?? [],
        mark: (id, next) => api.setPlayed(id, next),
        confirm: (message) => globalThis.confirm(message),
        onProgress: setProgress,
      }),
    onSettled: (outcome) => {
      setProgress(null)
      if (!shouldInvalidateAfter(outcome)) return
      for (const key of PLAYED_QUERY_KEYS) {
        qc.invalidateQueries({ queryKey: [key] })
      }
    },
  })

  return { ...mutation, progress }
}

/**
 * Taking something off Continue Watching.
 *
 * Optimistic because the row is the whole point of the button: a round trip
 * plus a refetch is long enough that the card is still there when the pointer
 * leaves, and the only reading of that is that nothing happened. The snapshot
 * taken before the write is what puts the card back — in its old position —
 * if the server refuses.
 *
 * Invalidation is deliberately narrow. Only the resume position changed, so
 * Next Up (a different query, answering "what episode is next" from played
 * state) must not be disturbed, and nor must anything that shows watched
 * badges. `useTogglePlayed` invalidates broadly for the opposite reason: it
 * really does change counts everywhere.
 */
export function useRemoveFromResume() {
  const api = useApi()
  const qc = useQueryClient()
  const key = ['resume', api.userId]

  return useMutation({
    mutationFn: (itemId: string) => api.clearResumePosition(itemId),
    onMutate: async (itemId: string) => {
      // A resume fetch already in flight would land after the optimistic write
      // and put the dismissed card straight back.
      await qc.cancelQueries({ queryKey: key })
      const plan = planResumeRemoval(qc.getQueryData<BaseItemDto[]>(key), itemId)
      if (plan.changed) qc.setQueryData(key, plan.next)
      return plan
    },
    onError: (_err, _itemId, plan) => {
      if (plan?.changed) qc.setQueryData(key, plan.rollback)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key })
    },
  })
}

export function useToggleFavorite() {
  const api = useApi()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, favorite }: { itemId: string; favorite: boolean }) =>
      api.setFavorite(itemId, favorite),
    onSuccess: (_data, { itemId }) => {
      qc.invalidateQueries({ queryKey: ['item', api.userId, itemId] })
      qc.invalidateQueries({ queryKey: ['itemsRow'] })
    },
  })
}
