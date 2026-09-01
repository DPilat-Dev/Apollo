import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models'

/**
 * The people who have signed in on this device, so handing a shared TV or
 * tablet to someone else is a face to tap rather than a blank form.
 *
 * ── What is stored, and what is deliberately not ──────────────────────────
 *
 * Identity only: server, user id, display name, avatar tag. No password, and
 * — the decision worth arguing about — no access token either.
 *
 * Keeping each account's token would make switching instant, and it is what a
 * native TV app does. It is the wrong trade for a browser client. Jellyfin
 * access tokens are bearer credentials that stay valid until somebody revokes
 * them in the dashboard, and anything on this origin can read localStorage: a
 * single XSS, a hostile browser extension, or a plugin that gets script onto
 * the page. With one token stored, that reaches the person currently watching.
 * With every token stored, it reaches every account that has ever used the
 * device — on a family tablet that plausibly includes the admin. The feature
 * exists precisely because the device is shared, which is exactly the setting
 * where widening the blast radius is least acceptable.
 *
 * So switching costs one password. The picker still removes the parts that
 * actually made switching annoying: finding the server address and typing a
 * username. Nothing here is secret in the first place — the same names and
 * avatars come back from /Users/Public to anyone who asks the server.
 */

const KEY = 'apollo.accounts'

export interface StoredAccount {
  server: string
  userId: string
  userName: string
  /** Jellyfin's PrimaryImageTag — enough to build an avatar URL, and public. */
  avatarTag: string | null
  /** ms epoch, so the picker can lead with whoever watched last. */
  lastUsed: number
}

/** One tappable face in the picker. */
export interface Profile {
  server: string
  userId: string
  name: string
  avatarTag: string | null
  /** Has signed in on this device before, so it leads the list. */
  remembered: boolean
  /** The session currently open, when the picker is reached by switching. */
  current: boolean
}

/**
 * Enough for a household, and a bound on a list that would otherwise grow
 * forever on a device in a waiting room.
 */
export const MAX_REMEMBERED = 8

/**
 * Storage that survives a switch. Everything else under `apollo.` goes.
 *
 * The device id belongs to the browser rather than to a person — Jellyfin ties
 * its "devices" list to it, and rotating it on every switch would litter the
 * dashboard with phantom devices. The account list is the feature itself.
 */
export const KEPT_KEYS: readonly string[] = ['apollo.deviceId', KEY]

const PREFIX = 'apollo.'

/**
 * Same address, written differently. A session saved before a trailing slash
 * was trimmed, or with a capitalised hostname, is the same server — matching
 * literally showed the same person twice in the picker.
 */
const serverKey = (server: string) => server.trim().replace(/\/+$/, '').toLowerCase()

/** Jellyfin has handed back ids in both cases across versions. */
const idKey = (userId: string) => userId.trim().toLowerCase()

const sameAccount = (a: { server: string; userId: string }, b: { server: string; userId: string }) =>
  serverKey(a.server) === serverKey(b.server) && idKey(a.userId) === idKey(b.userId)

/**
 * Rebuilds an account from known fields.
 *
 * Every path in and out of storage goes through this, so a token cannot ride
 * along in a spread even if some future caller passes an object that has one.
 * The security property is worth more than the two lines it costs.
 */
function sanitize(input: Partial<StoredAccount>): StoredAccount | null {
  const server = typeof input.server === 'string' ? input.server.trim() : ''
  const userId = typeof input.userId === 'string' ? input.userId.trim() : ''
  if (!server || !userId) return null
  return {
    server,
    userId,
    userName: typeof input.userName === 'string' ? input.userName : '',
    avatarTag: typeof input.avatarTag === 'string' ? input.avatarTag : null,
    lastUsed: typeof input.lastUsed === 'number' ? input.lastUsed : 0,
  }
}

/** Tolerant of anything: a missing key, half-written JSON, an older shape. */
export function parseAccounts(raw: string | null): StoredAccount[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((entry) =>
      entry && typeof entry === 'object' ? sanitize(entry as Partial<StoredAccount>) : null,
    )
    .filter((a): a is StoredAccount => a !== null)
}

/**
 * The list after someone signs in: they move to the front, any earlier record
 * of them is replaced rather than appended, and the oldest fall off the end.
 *
 * Duplicates are collapsed on the way through rather than only being avoided
 * going forward, because a list written by an earlier version — or by two tabs
 * racing — can already contain them.
 */
export function rememberAccount(
  existing: StoredAccount[],
  account: StoredAccount,
): StoredAccount[] {
  const head = sanitize(account)
  if (!head) return dedupe(existing)
  const rest = dedupe(existing)
  // A sign-in through the manual form carries no avatar tag, because nothing
  // in that flow ever asked the server for one. Dropping the picture already
  // known for this account would make the face disappear from the picker.
  const previous = rest.find((a) => sameAccount(a, head))
  const merged = { ...head, avatarTag: head.avatarTag ?? previous?.avatarTag ?? null }
  return [merged, ...rest.filter((a) => !sameAccount(a, head))].slice(0, MAX_REMEMBERED)
}

function dedupe(accounts: StoredAccount[]): StoredAccount[] {
  const out: StoredAccount[] = []
  for (const entry of accounts) {
    const account = sanitize(entry)
    if (!account) continue
    const at = out.findIndex((a) => sameAccount(a, account))
    // The more recent record wins, whichever order the list happens to be in.
    if (at === -1) out.push(account)
    else if (account.lastUsed > out[at].lastUsed) out[at] = account
  }
  return out
}

/** Signing out means "take me off this device", so the profile goes too. */
export function forgetAccount(
  existing: StoredAccount[],
  server: string,
  userId: string,
): StoredAccount[] {
  return dedupe(existing).filter((a) => !sameAccount(a, { server, userId }))
}

/**
 * Where to point the login screen when no server is configured at build time.
 * Without this, switching users on a self-hosted deployment means retyping the
 * server address — the very thing the picker is supposed to remove.
 */
export function lastUsedServer(existing: StoredAccount[]): string | null {
  const [most] = [...dedupe(existing)].sort((a, b) => b.lastUsed - a.lastUsed)
  return most?.server ?? null
}

/**
 * The faces to show, given what this device remembers and what the server is
 * willing to publish.
 *
 * The two lists disagree in both directions. An account can be remembered but
 * gone from the server (deleted, or hidden from the login screen) — offering
 * it leads to a sign-in that cannot succeed, so it is dropped. And a server
 * user can exist that nobody here has used, which is the whole point on a new
 * device. An *empty* published list is the case to be careful with: it means
 * the server hides its users, not that nobody exists, so remembered accounts
 * are kept rather than treated as all deleted.
 */
export function accountsToOffer(input: {
  stored: StoredAccount[]
  publicUsers: UserDto[]
  server: string
  currentUserId?: string | null
}): Profile[] {
  const server = input.server
  const mine = dedupe(input.stored)
    .filter((a) => serverKey(a.server) === serverKey(server))
    .sort((a, b) => b.lastUsed - a.lastUsed)

  const published = input.publicUsers
    .filter((u) => u.Id)
    .map((u) => ({ userId: u.Id as string, name: u.Name ?? '', avatarTag: u.PrimaryImageTag ?? null }))

  const onServer = new Map(published.map((u) => [idKey(u.userId), u]))
  const knownToServer = published.length > 0

  const profiles: Profile[] = []
  for (const account of mine) {
    const live = onServer.get(idKey(account.userId))
    if (knownToServer && !live) continue
    profiles.push({
      server,
      userId: live?.userId ?? account.userId,
      // The server is authoritative on names and avatars: a rename or a new
      // picture should show up here without needing a fresh sign-in.
      name: live?.name || account.userName,
      avatarTag: live ? live.avatarTag : account.avatarTag,
      remembered: true,
      current: false,
    })
  }

  const newcomers = published
    .filter((u) => !profiles.some((p) => idKey(p.userId) === idKey(u.userId)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map<Profile>((u) => ({
      server,
      userId: u.userId,
      name: u.name,
      avatarTag: u.avatarTag,
      remembered: false,
      current: false,
    }))

  const current = input.currentUserId ? idKey(input.currentUserId) : null
  // Whoever is signed in stays in the list, flagged rather than removed: on a
  // switch screen their own face is how a person confirms they are looking at
  // the right device, and tapping it is a legitimate "never mind".
  return [...profiles, ...newcomers].map((p) => ({ ...p, current: idKey(p.userId) === current }))
}

/**
 * Which storage keys belong to the person leaving.
 *
 * Deny by default: everything Apollo owns is purged unless it is explicitly
 * kept. The alternative — listing what to purge — fails silently the first
 * time someone adds a key and forgets to update this, and the failure mode is
 * one person's Continue Watching showing up in front of another.
 */
export function keysToPurgeOnSwitch(keys: readonly string[]): string[] {
  return keys.filter((key) => key.startsWith(PREFIX) && !KEPT_KEYS.includes(key))
}

// ------------------------------------------------------------ storage edges

export function loadAccounts(): StoredAccount[] {
  try {
    return parseAccounts(localStorage.getItem(KEY))
  } catch {
    // Storage blocked (private mode); the picker degrades to whatever the
    // server publishes, which is still better than a blank form.
    return []
  }
}

export function saveAccounts(accounts: StoredAccount[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(accounts))
  } catch {
    /* not remembering is survivable — sign-in still works */
  }
}

/** Records a successful sign-in. Called with a session, never with a password. */
export function rememberSignIn(account: Omit<StoredAccount, 'lastUsed'>) {
  saveAccounts(rememberAccount(loadAccounts(), { ...account, lastUsed: Date.now() }))
}

export function forgetSignIn(server: string, userId: string) {
  saveAccounts(forgetAccount(loadAccounts(), server, userId))
}

/**
 * Wipes the outgoing person's traces from both stores.
 *
 * Both, because the two are used for different lifetimes but the same thing
 * leaks from either: the play queue lives in sessionStorage and a tab handed
 * over mid-shuffle keeps it otherwise.
 */
export function purgeDeviceState() {
  // Reached through a function rather than named directly: touching
  // `localStorage` at all throws in some private-browsing modes, and taking
  // both references up front would let the first failure skip the second store.
  for (const open of [() => localStorage, () => sessionStorage]) {
    try {
      const store = open()
      // Listed through key(i) rather than Object.keys, and listed in full
      // before anything is removed: removing while walking the store shifts
      // every index after it, which silently skips half the keys.
      const keys: string[] = []
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (key !== null) keys.push(key)
      }
      for (const key of keysToPurgeOnSwitch(keys)) store.removeItem(key)
    } catch {
      /* storage blocked — nothing was persisted to leak in the first place */
    }
  }
}
