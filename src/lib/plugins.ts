/**
 * Plugins — what is installed, whether it is actually running, and its
 * settings.
 *
 * The list Apollo drew before this was a name, a version and an uninstall
 * button, which is a shorter answer than the server gives. Two things were
 * missing and both of them matter on a real server.
 *
 * ── Status ────────────────────────────────────────────────────────────────
 *
 * `Status` is not decoration. On the 10.11.8 server this was written against,
 * seven of twelve plugins report `NotSupported`: they are installed, they
 * appear in every list, and the server never loaded a line of them. Nothing
 * anywhere said so, so the honest reading of that dashboard was "TheTVDB is
 * installed" on a server where TheTVDB does nothing at all. Every status here
 * carries a sentence saying what it means for the person reading it, because
 * "NotSupported" on its own is a word from the server's vocabulary, not theirs.
 *
 * ── Configuration ─────────────────────────────────────────────────────────
 *
 * `GET /Plugins/{id}/Configuration` returns whatever object the plugin
 * serialises — there is no schema, no types, no labels. All that can be known
 * about a setting is the type of the value sitting in it, so that is what the
 * form is derived from: a boolean becomes a switch, a number a number input,
 * a string a text field.
 *
 * Four things make that more delicate than it sounds, and they are the reason
 * the whole derivation lives here rather than in the panel that draws it:
 *
 *   1. The POST *replaces* the document. A body that omits a key does not
 *      leave it alone — it deletes it. So a save is a merge onto everything
 *      that arrived, not a collection of the inputs that were drawn.
 *   2. Configurations hold api keys and tokens. Those are masked, which means
 *      the value in the form is not the value on the server, which means a
 *      naive save writes the mask into the plugin's api key and breaks it
 *      silently. `applyPluginConfigEdits` is where that does not happen.
 *   3. Not every value is a primitive. A nested object or a list cannot be
 *      edited by a form that knows nothing about it, and a form that tries
 *      corrupts it. Those are shown, read-only, exactly as they are stored.
 *   4. A plugin the server has not loaded has no configuration endpoint at
 *      all — the 404 is exact, in both directions, across every plugin on
 *      that server. So the status decides whether to ask, before asking.
 */

// -------------------------------------------------------------------- status

/** As much of the server's `PluginInfo` as any of this needs. */
export interface InstalledPlugin {
  Id?: string | null
  Name?: string | null
  Version?: string | null
  Description?: string | null
  CanUninstall?: boolean | null
  Status?: string | null
}

/**
 * Three states worth telling apart by colour: running, running after a
 * restart, and not running. Everything else the server can say collapses into
 * one of them.
 */
export type PluginStatusTone = 'running' | 'pending' | 'stopped'

export interface PluginStatusReading {
  label: string
  tone: PluginStatusTone
  /** What it means for the reader, in a sentence they did not have to decode. */
  hint: string
}

const STATUSES: Record<string, PluginStatusReading> = {
  Active: {
    label: 'Active',
    tone: 'running',
    hint: 'Loaded and running.',
  },
  Restart: {
    label: 'Restart required',
    tone: 'pending',
    hint: 'Installed, but nothing it does takes effect until the server restarts.',
  },
  Disabled: {
    label: 'Disabled',
    tone: 'stopped',
    hint: 'Turned off here. It stays installed and can be turned back on.',
  },
  NotSupported: {
    label: 'Not supported',
    tone: 'stopped',
    hint:
      'This build of the plugin does not match this version of Jellyfin, so the server ' +
      'refused to load it. It is installed and it does nothing — none of its features ' +
      'are running. An update built for this server version is the only fix.',
  },
  Malfunctioned: {
    label: 'Malfunctioned',
    tone: 'stopped',
    hint: 'It threw while loading, so the server stopped running it. The server log says why.',
  },
  Superseded: {
    label: 'Superseded',
    tone: 'stopped',
    hint: 'A newer version of this plugin is loaded instead of this one.',
  },
  // The server has shipped both spellings. Whichever arrives means the same
  // thing, and a reader should never be shown the typo.
  Superceded: {
    label: 'Superseded',
    tone: 'stopped',
    hint: 'A newer version of this plugin is loaded instead of this one.',
  },
  Deleted: {
    label: 'Removed',
    tone: 'stopped',
    hint: 'Uninstalled. It disappears from this list when the server restarts.',
  },
}

/**
 * What a status means. An unrecognised one is echoed rather than translated —
 * a status Apollo has never heard of is still a fact about the plugin, and
 * inventing "Active" for it would be the one wrong answer.
 */
export function describePluginStatus(status: string | null | undefined): PluginStatusReading {
  const raw = typeof status === 'string' ? status.trim() : ''
  const known = STATUSES[raw]
  if (known) return known
  return {
    label: raw || 'Unknown',
    tone: 'stopped',
    hint: 'The server did not say whether this plugin is running.',
  }
}

export interface PluginRow {
  /** Identity for a list, since one plugin can appear at two versions. */
  key: string
  id: string
  name: string
  version: string | null
  description: string | null
  /** Exactly what the server said, for the decisions that turn on it. */
  status: string
  statusLabel: string
  statusTone: PluginStatusTone
  statusHint: string
  running: boolean
  canUninstall: boolean
}

const text = (value: string | null | undefined) =>
  (typeof value === 'string' ? value.trim() : '') || null

/** The installed list, ready to draw, in a stable order. */
export function pluginRows(plugins: readonly InstalledPlugin[]): PluginRow[] {
  return plugins
    .map((plugin): PluginRow | null => {
      const id = text(plugin.Id)
      // With no id there is no configuration route, no uninstall and no
      // detail — the row could only ever be looked at.
      if (!id) return null
      const version = text(plugin.Version)
      const status = text(plugin.Status) ?? ''
      const reading = describePluginStatus(status)
      return {
        key: `${id}:${version ?? ''}`,
        id,
        name: text(plugin.Name) ?? 'Unnamed plugin',
        version,
        description: text(plugin.Description),
        status,
        statusLabel: reading.label,
        statusTone: reading.tone,
        statusHint: reading.hint,
        running: status === 'Active',
        // Only when the server said so. A server that did not mention it is
        // not one to offer a removal on behalf of — the plugins that cannot
        // be uninstalled are the ones shipped with the server itself.
        canUninstall: plugin.CanUninstall === true,
      }
    })
    .filter((row): row is PluginRow => row !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.version ?? '').localeCompare(b.version ?? ''))
}

/**
 * The line above the list. It leads with the count that is actually news:
 * how many of these installed plugins are not doing anything.
 */
export function pluginSummaryLine(rows: readonly PluginRow[]): string {
  if (rows.length === 0) return 'No plugins installed.'
  const plugins = `${rows.length} plugin${rows.length === 1 ? '' : 's'}`
  const idle = rows.filter((row) => !row.running).length
  return idle === 0 ? `${plugins}, all running.` : `${plugins} · ${idle} not running`
}

// -------------------------------------------------------------------- asking

/**
 * The path to a plugin's configuration, or null when this caller may not have
 * it.
 *
 * `/Plugins` and everything under it is administrator-only on the server. The
 * gate is here, next to the path, rather than in whatever renders the panel:
 * the panel already lives behind `/admin`, but a route is not a permission,
 * and a second caller arriving from somewhere else would not inherit it.
 *
 * The id is escaped because it goes into a path segment. It comes from the
 * server today, and a value with a slash in it would silently address a
 * different endpoint entirely.
 */
export function pluginConfigPath(input: { isAdmin: boolean; pluginId: string }): string | null {
  if (!input.isAdmin) return null
  const id = input.pluginId.trim()
  if (!id) return null
  return `/Plugins/${encodeURIComponent(id)}/Configuration`
}

/** The same gate for the enable and disable routes, which need the version. */
export function pluginTogglePath(input: {
  isAdmin: boolean
  pluginId: string
  version: string
  enable: boolean
}): string | null {
  if (!input.isAdmin) return null
  const id = input.pluginId.trim()
  const version = input.version.trim()
  if (!id || !version) return null
  return `/Plugins/${encodeURIComponent(id)}/${encodeURIComponent(version)}/${
    input.enable ? 'Enable' : 'Disable'
  }`
}

/**
 * Whether to go and get the configuration, and what to say when not to.
 *
 * The endpoint exists only for a plugin the server has loaded: an instance
 * that was never constructed has no configuration to serialise, so the server
 * answers 404. Measured across all twelve plugins on a live 10.11.8 server the
 * correlation was exact in both directions — every `Active` plugin returned a
 * document, every other one returned 404.
 *
 * So the status answers the question before the network does. Sending the
 * request anyway would cost a round trip per open to learn something already
 * known, and would land a 404 in the query cache where an error is the only
 * thing it could be rendered as — which is the wrong story. The plugin is not
 * broken and nothing failed; it simply is not running.
 */
export function pluginConfigPlan(row: PluginRow): { fetch: boolean; note: string | null } {
  if (row.running) return { fetch: true, note: null }
  return {
    fetch: false,
    note: `This plugin is not running — it is ${row.statusLabel.toLowerCase()} — and the server keeps no settings for a plugin it has not loaded.`,
  }
}

/**
 * The enable/disable offer for a row, or null when there is nothing honest to
 * offer.
 *
 * Only `Active` and `Disabled` get a button, because only those two are the
 * two sides of the switch. Enabling a `NotSupported` plugin does not make the
 * server load it — the flag it clears is not the reason it is stopped — so
 * the button would read as a repair and behave as a no-op, which is worse
 * than no button.
 */
export function pluginToggle(row: PluginRow): PluginToggle | null {
  // No version means no route: `/Plugins/{id}//Enable` is a different
  // endpoint, or none at all.
  if (!row.version) return null
  return TOGGLES[row.status] ?? null
}

export interface PluginToggle {
  enable: boolean
  label: string
  hint: string
}

const TOGGLES: Record<string, PluginToggle> = {
  Active: {
    enable: false,
    label: 'Disable',
    hint: 'Stops the server loading it, without uninstalling it. Takes effect after a restart.',
  },
  Disabled: {
    enable: true,
    label: 'Enable',
    hint: 'Loads it again the next time the server starts.',
  },
}

// ---------------------------------------------------------------- the fields

/**
 * What a masked field holds instead of the secret.
 *
 * The real value never leaves `applyPluginConfigEdits` — it is not put into
 * the draft, into React state, or into the DOM, so it cannot be read out of a
 * form control or shoulder-read off a screen.
 */
export const SECRET_MASK = '••••••••'

/** How long a value has to be before hiding it in a message is worth doing. */
const REDACTABLE_LENGTH = 4

const SECRET_WORDS = new Set([
  'key',
  'keys',
  'apikey',
  'token',
  'tokens',
  'secret',
  'secrets',
  'password',
  'passwd',
  'pwd',
  'pass',
  'credential',
  'credentials',
  'auth',
  'authorization',
  'salt',
  'signature',
])

/** `TmdbApiKey` → `['Tmdb', 'Api', 'Key']`, `enable_hardware` → two words. */
function words(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
}

/**
 * Whether a key's name says it holds a credential.
 *
 * Matched word by word rather than as a substring, which is the difference
 * between masking `TmdbApiKey` and masking `Keywords`, `KeyframeInterval` and
 * `Passthrough` as well. A wrongly masked field is not a small annoyance: it
 * is a setting nobody can read back, on a plugin whose documentation is the
 * only other place its value is written down.
 */
export function looksLikeSecret(key: string): boolean {
  return words(key).some((word) => SECRET_WORDS.has(word.toLowerCase()))
}

/**
 * A key as a label. Sentence case, matching every other label in the admin
 * panels, except for a word that is already all capitals — `ID` and `URL` are
 * how they are written everywhere else, and "Id" reads as a mistake.
 */
export function fieldLabel(key: string): string {
  const parts = words(key)
  if (parts.length === 0) return key
  return parts
    .map((word, at) => {
      if (word === word.toUpperCase() && word.length > 1) return word
      const lower = word.toLowerCase()
      return at === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

export type PluginFieldKind = 'boolean' | 'number' | 'text' | 'secret'

export interface PluginConfigField {
  key: string
  label: string
  kind: PluginFieldKind
  /** For a masked secret this is the mask, never the stored value. */
  value: boolean | number | string
  masked: boolean
}

export interface PluginConfigReadOnly {
  key: string
  label: string
  /** Why the form will not touch it. */
  reason: string
  /** The value as it is stored, for reading. */
  preview: string
}

export interface PluginConfigForm {
  /**
   * `none` — the plugin has no configuration; `empty` — it has one with
   * nothing in it; `unusable` — the server sent something that is not a
   * settings object; `fields` — there is a document to show.
   */
  kind: 'none' | 'empty' | 'unusable' | 'fields'
  fields: PluginConfigField[]
  readOnly: PluginConfigReadOnly[]
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const preview = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    // A configuration the server sent cannot contain a cycle — it arrived as
    // JSON — but nothing here is worth throwing a render away for.
    return String(value)
  }
}

/**
 * Every field a configuration document can be drawn as, and everything in it
 * that will only be shown.
 *
 * Order is the server's. A plugin author wrote these properties in an order
 * that usually groups them sensibly, and sorting alphabetically throws that
 * away for nothing.
 */
export function pluginConfigForm(config: unknown): PluginConfigForm {
  if (config === null || config === undefined) return { kind: 'none', fields: [], readOnly: [] }
  if (!isPlainObject(config)) {
    return {
      kind: 'unusable',
      fields: [],
      readOnly: [
        {
          key: '',
          label: 'Configuration',
          reason:
            'The server sent something other than a settings object, so there is no safe way ' +
            'to lay it out as a form. It is shown here exactly as it is stored.',
          preview: preview(config),
        },
      ],
    }
  }

  const entries = Object.entries(config)
  if (entries.length === 0) return { kind: 'empty', fields: [], readOnly: [] }

  const fields: PluginConfigField[] = []
  const readOnly: PluginConfigReadOnly[] = []

  for (const [key, value] of entries) {
    const label = fieldLabel(key)
    if (typeof value === 'boolean') {
      fields.push({ key, label, kind: 'boolean', value, masked: false })
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      fields.push({ key, label, kind: 'number', value, masked: false })
      continue
    }
    if (typeof value === 'string') {
      // Only strings are ever masked. A boolean called `EnableAuth` is not a
      // credential, and hiding it would hide the one thing about it worth
      // seeing.
      const secret = looksLikeSecret(key)
      const masked = secret && value !== ''
      fields.push({
        key,
        label,
        kind: secret ? 'secret' : 'text',
        value: masked ? SECRET_MASK : value,
        masked,
      })
      continue
    }
    if (value === null) {
      readOnly.push({
        key,
        label,
        reason:
          'Empty, and the server did not say what type belongs here. Writing a guess back ' +
          'would store the wrong type, so this one is left as it is.',
        preview: 'null',
      })
      continue
    }
    readOnly.push({
      key,
      label,
      reason: Array.isArray(value)
        ? 'A list. Its entries have a shape this form knows nothing about, so it is shown ' +
          'as it is stored rather than flattened into something that would not survive a save.'
        : 'A nested group of settings. Editing it here could not preserve its structure, so ' +
          'it is shown as it is stored.',
      preview: preview(value),
    })
  }

  return { kind: 'fields', fields, readOnly }
}

/**
 * What a secret input shows. Never the mask itself: a box containing eight
 * bullet characters is a box someone types after, and `••••••••abc` is what
 * would then be saved into the plugin's api key.
 */
export function secretInputValue(value: boolean | number | string): string {
  return value === SECRET_MASK ? '' : String(value)
}

/**
 * What was typed, as the draft records it. An empty box means the stored
 * value is being left alone rather than being cleared — which is the safe
 * reading, since the box starts empty for a value nobody is allowed to see.
 */
export function secretEdit(typed: string): string {
  return typed === '' ? SECRET_MASK : typed
}

/** What the form's inputs hold. Keyed by configuration key. */
export type ConfigDraft = Record<string, boolean | number | string>

/**
 * The starting state of the inputs — masks included, secrets not.
 *
 * A number is held as the text an input actually contains. Kept as a number it
 * could not represent an empty box: the box would report `Number('')`, which
 * is zero, and clearing a field to retype it would write a real 0 into the
 * plugin's settings the moment focus moved on.
 */
export function configDraft(form: PluginConfigForm): ConfigDraft {
  return Object.fromEntries(
    form.fields.map((field) => [
      field.key,
      field.kind === 'number' ? String(field.value) : field.value,
    ]),
  )
}

/** Whether anything has been typed since the document was loaded. */
export function configEdited(form: PluginConfigForm, draft: ConfigDraft): boolean {
  const initial = configDraft(form)
  return form.fields.some((field) => draft[field.key] !== initial[field.key])
}

/**
 * The document to POST: everything that arrived, with the edits laid over it.
 *
 * Three things are load-bearing here, and each of them is a way settings get
 * destroyed rather than saved.
 *
 * The result starts as a copy of the whole original because the POST replaces
 * the stored document outright. Sending only the fields the form drew would
 * delete every nested object, every list and every null in the configuration,
 * with a 204 in reply and no sign anywhere that a plugin had just been reset.
 *
 * A masked field that was never touched still holds the mask, and writing the
 * mask into an api key is a plugin that stops working with nothing to show
 * for it. So the mask, on a key whose name says credential, means "unchanged"
 * — never a value.
 *
 * And each value keeps the type the server sent. Every input hands back a
 * string; a plugin whose property is a `string` that happens to hold "15"
 * gets "16" back, not 16.
 */
export function applyPluginConfigEdits(config: unknown, draft: ConfigDraft): Record<string, unknown> {
  const original = isPlainObject(config) ? config : {}
  const merged: Record<string, unknown> = { ...original }

  for (const [key, edit] of Object.entries(draft)) {
    // A key the server did not send is a key the plugin does not have. It can
    // only have come from a draft left over from a different document.
    if (!Object.hasOwn(merged, key)) continue
    const before = merged[key]

    if (typeof before === 'boolean') {
      merged[key] = typeof edit === 'boolean' ? edit : before
      continue
    }
    if (typeof before === 'number') {
      const next = typeof edit === 'number' ? edit : Number(String(edit).trim())
      // An emptied number input reads as NaN, which JSON.stringify writes as
      // null — a cleared box would otherwise erase the setting.
      merged[key] = typeof edit !== 'boolean' && String(edit).trim() !== '' && Number.isFinite(next)
        ? next
        : before
      continue
    }
    if (typeof before === 'string') {
      if (looksLikeSecret(key) && before !== '' && edit === SECRET_MASK) continue
      merged[key] = String(edit)
      continue
    }
    // null, objects and lists are never drawn as inputs, so nothing in the
    // draft can have anything to say about them.
  }

  return merged
}

/**
 * A message with any credential from this configuration taken back out.
 *
 * Jellyfin puts the reason for a 4xx in the response body and `ApiError` folds
 * it into the message, so a plugin that validates its api key and complains
 * about it by name hands the value straight back — and Apollo would print it
 * on the screen next to a field that was masked precisely so it would not be.
 * Short values are left alone: a two-character key would blank every
 * occurrence of those characters in the sentence.
 */
export function redactSecrets(message: string, config: unknown): string {
  if (!isPlainObject(config)) return message
  let out = message
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || value.length < REDACTABLE_LENGTH) continue
    if (!looksLikeSecret(key)) continue
    out = out.split(value).join(SECRET_MASK)
  }
  return out
}
