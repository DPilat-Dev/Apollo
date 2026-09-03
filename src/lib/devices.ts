/**
 * The devices a Jellyfin server has handed a token to.
 *
 * Not sessions: a session ends when a tab closes, but a *device* row outlives
 * it and keeps its access token until somebody deletes the row. A browser that
 * clears storage comes back as a new device, so the list grows and nothing
 * ever prunes it — the server this was written against had 168 rows, almost
 * all of them the same two browsers signing in again after a wipe. Every one
 * of them is a live bearer credential, which is why this is worth a screen at
 * all rather than being filed under clutter.
 *
 * ── Who may look ──────────────────────────────────────────────────────────
 *
 * `/Devices` is an elevated route on the server (10.11 answers 403 to anyone
 * without administrator rights, whatever `userId` the request carries). So the
 * honest answer for a non-admin is not "your own devices" — it is that the
 * server will not say. `devicesRequest` returns null for them and nothing is
 * sent; the section does not render. An admin chooses between their own and
 * the whole server, because those are two different questions: session hygiene
 * for themselves, and an audit for everyone else.
 *
 * Every decision here — what is stale, what sorts where, which device is the
 * one being used, and what a revoke is allowed to include — is a function so
 * it can be checked without a server. The one that matters most is the last:
 * this device must never be swept up in a bulk sign-out, because the failure
 * is invisible until the app drops to the login screen.
 */

/** As much of the server's `DeviceInfoDto` as a list row needs. */
export interface DeviceInfo {
  Id?: string | null
  Name?: string | null
  AppName?: string | null
  AppVersion?: string | null
  LastUserName?: string | null
  LastUserId?: string | null
  DateLastActivity?: string | null
}

/** Whose devices an admin is looking at. */
export type DeviceScope = 'mine' | 'everyone'

export interface DeviceRow {
  id: string
  name: string
  appName: string
  appVersion: string | null
  lastUserName: string | null
  /** ms epoch, or null when the server gave no usable date. */
  lastActive: number | null
  lastActiveLabel: string
  /** The browser this app is running in — never revoked without saying so. */
  isCurrent: boolean
  stale: boolean
}

export interface DeviceGroup {
  key: string
  appName: string
  devices: DeviceRow[]
  staleCount: number
  containsCurrent: boolean
  lastActive: number | null
}

export interface DeviceOverview {
  rows: DeviceRow[]
  groups: DeviceGroup[]
  current: DeviceRow | null
  total: number
  staleCount: number
}

/**
 * Long enough that a laptop used on holidays is not called stale, short enough
 * that the duplicates a browser leaves behind fall in. Nothing is deleted on
 * this basis — it only decides what the sweep offers to take.
 */
export const STALE_AFTER_DAYS = 30

/** How many rows of a group are drawn before the rest are folded away. */
export const GROUP_PREVIEW = 5

const DAY_MS = 86_400_000

/**
 * The oldest date worth believing. A device the server has never seen active
 * carries `DateTime.MinValue`, which arrives as a perfectly parseable year 1
 * and would otherwise be reported as "2025 years ago" and sorted as the least
 * recently used thing on the server rather than as the unknown it is.
 */
const EARLIEST_PLAUSIBLE = Date.UTC(2010, 0, 1)

/**
 * When a device was last active, as a number, or null if that cannot be known.
 *
 * The Z is the part worth having: these stamps are UTC, and Jellyfin does not
 * always say so. A date-time with no offset is *local* time by spec, so west
 * of Greenwich every device looks hours more recently used than it was — and
 * ahead of it, hours into the future.
 */
export function deviceActivityAt(value: string | null | undefined): number | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const zoned = /T\d\d:\d\d/.test(raw) && !/(Z|[+-]\d\d:?\d\d)$/i.test(raw) ? `${raw}Z` : raw
  const at = Date.parse(zoned)
  if (Number.isNaN(at) || at < EARLIEST_PLAUSIBLE) return null
  return at
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * How long ago, in words. Coarse on purpose: the question a row answers is
 * "could I have forgotten about this one", and to that "3 months ago" is the
 * whole answer.
 */
export function describeActivity(lastActive: number | null, now: number): string {
  if (lastActive === null) return 'Last used: unknown'
  const minutes = Math.floor((now - lastActive) / 60_000)
  // A server whose clock runs ahead of the browser's stamps a session in the
  // future. A negative age falls into this first bucket, which is why nothing
  // here ever says "in 2 hours" — a phrase that reads as a bug in Apollo
  // rather than as two clocks disagreeing.
  if (minutes < 2) return 'Active now'
  if (minutes < 60) return `${plural(minutes, 'minute')} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${plural(hours, 'hour')} ago`
  const days = Math.floor(hours / 24)
  if (days < 31) return `${plural(days, 'day')} ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${plural(months, 'month')} ago`
  return `${plural(Math.floor(days / 365), 'year')} ago`
}

const text = (value: string | null | undefined, fallback: string) => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || fallback
}

function toRow(device: DeviceInfo, currentDeviceId: string, now: number): DeviceRow | null {
  const id = typeof device.Id === 'string' ? device.Id.trim() : ''
  // No id means no `DELETE /Devices?id=`, so the row could only ever be a
  // thing to look at and be unable to act on.
  if (!id) return null

  const lastActive = deviceActivityAt(device.DateLastActivity)
  const isCurrent = id === currentDeviceId
  return {
    id,
    name: text(device.Name, 'Unnamed device'),
    appName: text(device.AppName, 'Unknown app'),
    appVersion: text(device.AppVersion, '') || null,
    lastUserName: text(device.LastUserName, '') || null,
    lastActive,
    lastActiveLabel: isCurrent ? 'Active now' : describeActivity(lastActive, now),
    isCurrent,
    // The device in hand is in use by definition. Left to the date it would
    // qualify — its own activity is only written when the session ends — and
    // the sweep would then quietly include it.
    stale: !isCurrent && (lastActive === null || now - lastActive > STALE_AFTER_DAYS * DAY_MS),
  }
}

/**
 * Most recently used first, undatable last, and ties broken by name.
 *
 * Unknown dates are held out of the arithmetic rather than standing in as zero
 * or as -Infinity: subtracting one absent date from another is NaN, and a
 * comparator that returns NaN leaves the order to whatever the server happened
 * to send.
 */
function byRecency(
  a: { lastActive: number | null; name: string },
  b: { lastActive: number | null; name: string },
): number {
  if (a.lastActive === null || b.lastActive === null) {
    if (a.lastActive === b.lastActive) return a.name.localeCompare(b.name)
    return a.lastActive === null ? 1 : -1
  }
  return b.lastActive - a.lastActive
}

/** The same order for rows, with the device in hand pinned above everything. */
function byRecencyWithCurrentFirst(a: DeviceRow, b: DeviceRow): number {
  if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1
  return byRecency(a, b)
}

/** Everything the devices screen draws, from one list and one id. */
export function summariseDevices(input: {
  devices: readonly DeviceInfo[]
  currentDeviceId: string
  now?: number
}): DeviceOverview {
  const now = input.now ?? Date.now()
  const rows = input.devices
    .map((device) => toRow(device, input.currentDeviceId, now))
    .filter((row): row is DeviceRow => row !== null)
    .sort(byRecencyWithCurrentFirst)

  /*
    Grouped by app, because that is the shape of the mess: 168 rows are not 168
    things, they are two or three apps that have each signed in dozens of
    times. Matched case-insensitively since the same client has spelled itself
    both ways across versions, and a group that splits in half defeats the
    point of grouping at all.
  */
  const groups: DeviceGroup[] = []
  for (const row of rows) {
    const key = row.appName.toLowerCase()
    const group = groups.find((g) => g.key === key)
    if (group) {
      group.devices.push(row)
      group.staleCount += row.stale ? 1 : 0
      group.containsCurrent ||= row.isCurrent
      if (row.lastActive !== null && (group.lastActive ?? -Infinity) < row.lastActive) {
        group.lastActive = row.lastActive
      }
    } else {
      groups.push({
        key,
        appName: row.appName,
        devices: [row],
        staleCount: row.stale ? 1 : 0,
        containsCurrent: row.isCurrent,
        lastActive: row.lastActive,
      })
    }
  }
  groups.sort((a, b) => {
    if (a.containsCurrent !== b.containsCurrent) return a.containsCurrent ? -1 : 1
    return byRecency(
      { lastActive: a.lastActive, name: a.appName },
      { lastActive: b.lastActive, name: b.appName },
    )
  })

  const current = rows.find((row) => row.isCurrent) ?? null
  return {
    rows,
    groups,
    current,
    total: rows.length,
    staleCount: rows.filter((row) => row.stale).length,
  }
}

/** The rows of a group that are drawn, and how many are folded away. */
export function visibleDevices(
  group: DeviceGroup,
  expanded: boolean,
): { rows: DeviceRow[]; hidden: number } {
  if (expanded || group.devices.length <= GROUP_PREVIEW) {
    return { rows: group.devices, hidden: 0 }
  }
  return {
    rows: group.devices.slice(0, GROUP_PREVIEW),
    hidden: group.devices.length - GROUP_PREVIEW,
  }
}

// ------------------------------------------------------------------- asking

/**
 * The query to send, or null when the request must not be made.
 *
 * The gate lives here rather than in whatever renders the list, so that a
 * second caller cannot arrive without it. A non-admin gets null in both
 * scopes: the route is elevated, so `userId` would not buy them access, and an
 * unsent request beats a 403 rendered as a broken panel.
 */
export function devicesRequest(input: {
  isAdmin: boolean
  scope: DeviceScope
  userId: string
}): { userId?: string } | null {
  if (!input.isAdmin) return null
  return input.scope === 'everyone' ? {} : { userId: input.userId }
}

/** Which views to offer. An empty list is how the section stays hidden. */
export function deviceScopes(isAdmin: boolean): DeviceScope[] {
  return isAdmin ? ['mine', 'everyone'] : []
}

// ----------------------------------------------------------------- revoking

export type RevokeSelection =
  | { kind: 'one'; id: string }
  | { kind: 'others' }
  | { kind: 'stale' }

export interface RevokePlan {
  /** In the order they will be sent — this device, if included, comes last. */
  ids: string[]
  /** Set only when the plan ends the session in this browser. */
  currentId: string | null
  prompt: string
}

const describeRow = (row: DeviceRow) => {
  const app = `${row.appName}${row.appVersion ? ` ${row.appVersion}` : ''}`
  return `${row.name} (${app})`
}

/**
 * What a press would actually do, or null when it would do nothing.
 *
 * Returning null for the empty cases is what keeps a dead button off the page:
 * there is no "sign out everything else" on a server whose only device is this
 * one, and no stale sweep when nothing is stale.
 *
 * Only the single-device selection can name this device, and it has to be
 * chosen deliberately from its own row. Neither sweep can reach it — that is
 * the property the whole feature turns on, and the reason both are built by
 * filtering `isCurrent` out rather than by trusting the caller's list.
 */
export function revokePlan(
  rows: readonly DeviceRow[],
  selection: RevokeSelection,
): RevokePlan | null {
  if (selection.kind === 'one') {
    const row = rows.find((r) => r.id === selection.id)
    if (!row) return null
    if (row.isCurrent) {
      return {
        ids: [row.id],
        currentId: row.id,
        prompt:
          `Sign out ${describeRow(row)}?\n\n` +
          'This is the browser you are using right now. Apollo will drop back to ' +
          'the sign-in screen and you will need your password to get in again.',
      }
    }
    const who = row.lastUserName ? ` Last used by ${row.lastUserName},` : ' It was last used'
    return {
      ids: [row.id],
      currentId: null,
      prompt:
        `Sign out ${describeRow(row)}?\n\n` +
        `${who} ${row.lastActiveLabel.toLowerCase()}. Its access token stops working ` +
        'immediately and it will have to sign in again.',
    }
  }

  const targets = rows.filter((row) => !row.isCurrent && (selection.kind === 'others' || row.stale))
  if (targets.length === 0) return null
  const count = `${targets.length} device${targets.length === 1 ? '' : 's'}`
  return {
    ids: targets.map((row) => row.id),
    currentId: null,
    prompt:
      selection.kind === 'others'
        ? `Sign out ${count}?\n\nEverything except the browser you are using now. ` +
          'Anyone watching on one of them is interrupted, and every one of them ' +
          'has to sign in again.'
        : `Sign out ${count} unused for over ${STALE_AFTER_DAYS} days?\n\n` +
          'This browser and anything used recently are left alone.',
  }
}

export interface RevokeOutcome {
  requested: number
  succeeded: number
  failed: number
  cancelled: boolean
  /** The token this app is holding is gone; the app has to return to sign-in. */
  endedSession: boolean
}

/**
 * A few at a time. Sweeping 168 devices one round trip after another is a long
 * wait, and firing all 168 at once is a burst a small server answers by
 * refusing some of them.
 */
const REVOKE_BATCH = 4

/**
 * Carries out a plan.
 *
 * Everything the server does is injected so the order and the outcome can be
 * checked without one. The order is the interesting part: this device goes
 * last, because deleting the device row also kills the token the request is
 * authenticated with, and every delete queued behind it would come back 401.
 */
export async function runDeviceRevoke(input: {
  plan: RevokePlan
  revoke: (id: string) => Promise<unknown>
  confirm: (message: string) => boolean
}): Promise<RevokeOutcome> {
  const { plan, revoke, confirm } = input
  const requested = plan.ids.length
  if (!confirm(plan.prompt)) {
    return { requested, succeeded: 0, failed: 0, cancelled: true, endedSession: false }
  }

  const ordered = [
    ...plan.ids.filter((id) => id !== plan.currentId),
    ...plan.ids.filter((id) => id === plan.currentId),
  ]

  const failedIds: string[] = []
  for (let i = 0; i < ordered.length; i += REVOKE_BATCH) {
    const batch = ordered.slice(i, i + REVOKE_BATCH)
    const results = await Promise.allSettled(batch.map((id) => revoke(id)))
    results.forEach((result, at) => {
      if (result.status === 'rejected') failedIds.push(batch[at])
    })
  }

  return {
    requested,
    succeeded: requested - failedIds.length,
    failed: failedIds.length,
    cancelled: false,
    // Only once the server has confirmed it. Dropping to the sign-in screen
    // after a delete that was refused would look exactly like a revoke that
    // worked, on a device that is still signed in.
    endedSession: plan.currentId !== null && !failedIds.includes(plan.currentId),
  }
}

/** What to say afterwards. A partial run never reads as success. */
export function revokeMessage(outcome: RevokeOutcome): string | null {
  if (outcome.cancelled) return null
  const devices = (n: number) => `${n} device${n === 1 ? '' : 's'}`
  if (outcome.failed === 0) return `Signed out ${devices(outcome.succeeded)}.`
  if (outcome.succeeded === 0) {
    return `The server refused — nothing was signed out of ${devices(outcome.requested)}.`
  }
  return `Signed out ${outcome.succeeded} of ${devices(outcome.requested)}; the rest refused.`
}

/** The line above the list, so the size of the problem is stated once. */
export function deviceSummaryLine(overview: DeviceOverview): string {
  if (overview.total === 0) return 'No devices are registered on this server.'
  const devices = `${overview.total} device${overview.total === 1 ? '' : 's'}`
  if (overview.staleCount === 0) return `${devices}, all used recently.`
  return `${devices} · ${overview.staleCount} unused for over ${STALE_AFTER_DAYS} days`
}
