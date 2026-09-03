import { describe, expect, it } from 'vitest'
import {
  SECRET_MASK,
  applyPluginConfigEdits,
  configDraft,
  configEdited,
  looksLikeSecret,
  pluginConfigForm,
  pluginConfigPath,
  pluginConfigPlan,
  pluginRows,
  pluginSummaryLine,
  pluginToggle,
  pluginTogglePath,
  redactSecrets,
  secretEdit,
  secretInputValue,
  type InstalledPlugin,
} from '../plugins'

const plugin = (partial: Partial<InstalledPlugin>): InstalledPlugin => ({
  Id: 'id-1',
  Name: 'A plugin',
  Version: '1.0.0.0',
  Status: 'Active',
  CanUninstall: true,
  ...partial,
})

// ------------------------------------------------------------------- status

describe('plugin status', () => {
  it('says a NotSupported plugin is installed and not running', () => {
    const [row] = pluginRows([plugin({ Status: 'NotSupported' })])
    expect(row.running).toBe(false)
    expect(row.statusTone).toBe('stopped')
    expect(row.statusLabel).toBe('Not supported')
    expect(row.statusHint).toMatch(/does nothing/i)
  })

  it('separates a restart-pending plugin from one that will never run', () => {
    const [restart] = pluginRows([plugin({ Status: 'Restart' })])
    expect(restart.statusTone).toBe('pending')
    expect(restart.running).toBe(false)

    const [active] = pluginRows([plugin({ Status: 'Active' })])
    expect(active.statusTone).toBe('running')
    expect(active.running).toBe(true)
  })

  it('never claims a status it was not given is running', () => {
    const [missing] = pluginRows([plugin({ Status: undefined })])
    expect(missing.running).toBe(false)
    expect(missing.statusLabel).toBe('Unknown')

    const [invented] = pluginRows([plugin({ Status: 'Curdled' })])
    expect(invented.running).toBe(false)
    expect(invented.statusLabel).toBe('Curdled')
  })

  it('offers removal only where the server said it was allowed', () => {
    expect(pluginRows([plugin({ CanUninstall: true })])[0].canUninstall).toBe(true)
    expect(pluginRows([plugin({ CanUninstall: false })])[0].canUninstall).toBe(false)
    expect(pluginRows([plugin({ CanUninstall: undefined })])[0].canUninstall).toBe(false)
  })

  it('drops a row with no id, since nothing could be done to it', () => {
    expect(pluginRows([plugin({ Id: '  ' }), plugin({ Id: 'ok' })]).map((r) => r.id)).toEqual(['ok'])
  })

  it('sorts by name, and keeps two versions of one plugin apart', () => {
    const rows = pluginRows([
      plugin({ Id: 'b', Name: 'Zeta' }),
      plugin({ Id: 'a', Name: 'Alpha', Version: '2.0' }),
      plugin({ Id: 'a', Name: 'Alpha', Version: '1.0', Status: 'Superseded' }),
    ])
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Alpha', 'Zeta'])
    expect(new Set(rows.map((r) => r.key)).size).toBe(3)
  })

  it('counts what is not running in the summary line', () => {
    expect(pluginSummaryLine(pluginRows([]))).toBe('No plugins installed.')
    expect(pluginSummaryLine(pluginRows([plugin({}), plugin({ Id: 'b' })]))).toBe(
      '2 plugins, all running.',
    )
    expect(
      pluginSummaryLine(pluginRows([plugin({}), plugin({ Id: 'b', Status: 'NotSupported' })])),
    ).toBe('2 plugins · 1 not running')
  })
})

// ------------------------------------------------------------ deriving a form

describe('pluginConfigForm', () => {
  it('reports no configuration when the server had none to give', () => {
    expect(pluginConfigForm(undefined).kind).toBe('none')
    expect(pluginConfigForm(null).kind).toBe('none')
    expect(pluginConfigForm(null).fields).toEqual([])
  })

  it('reports an empty document as empty rather than as a form with no fields', () => {
    const form = pluginConfigForm({})
    expect(form.kind).toBe('empty')
    expect(form.fields).toEqual([])
    expect(form.readOnly).toEqual([])
  })

  it('declines a document that is not an object at all', () => {
    const form = pluginConfigForm(['a', 'b'])
    expect(form.kind).toBe('unusable')
    expect(form.fields).toEqual([])
    expect(form.readOnly).toHaveLength(1)
    expect(form.readOnly[0].preview).toContain('"a"')
  })

  it('turns each primitive into the input its type can survive', () => {
    const form = pluginConfigForm({
      IncludeAdult: false,
      MaxCastMembers: 15,
      PosterSize: 'original',
    })
    expect(form.kind).toBe('fields')
    expect(form.fields.map((f) => [f.key, f.kind, f.value])).toEqual([
      ['IncludeAdult', 'boolean', false],
      ['MaxCastMembers', 'number', 15],
      ['PosterSize', 'text', 'original'],
    ])
  })

  it('keeps a number that arrived as a string a string', () => {
    // A plugin whose C# property is a string writes "15", and sending 15 back
    // is a type the deserialiser may refuse — or may accept and then store
    // differently to how every other client wrote it.
    const form = pluginConfigForm({ MaxCastMembers: '15' })
    expect(form.fields[0].kind).toBe('text')
    expect(form.fields[0].value).toBe('15')
    expect(applyPluginConfigEdits({ MaxCastMembers: '15' }, { MaxCastMembers: '16' })).toEqual({
      MaxCastMembers: '16',
    })
  })

  it('humanises the key into a label without losing the key itself', () => {
    const form = pluginConfigForm({ MaxCastMembers: 1, ID: 'x', enable_hardware: true })
    expect(form.fields.map((f) => f.label)).toEqual(['Max cast members', 'ID', 'Enable hardware'])
    expect(form.fields.map((f) => f.key)).toEqual(['MaxCastMembers', 'ID', 'enable_hardware'])
  })

  it('masks a field whose name looks like a secret, and never carries its value', () => {
    const form = pluginConfigForm({ TmdbApiKey: 'abcd-1234-secret' })
    expect(form.fields[0].kind).toBe('secret')
    expect(form.fields[0].masked).toBe(true)
    expect(form.fields[0].value).toBe(SECRET_MASK)
    expect(JSON.stringify(form)).not.toContain('abcd-1234-secret')
  })

  it('does not mask a secret that is empty — there is nothing to hide', () => {
    const form = pluginConfigForm({ TmdbApiKey: '' })
    expect(form.fields[0].kind).toBe('secret')
    expect(form.fields[0].masked).toBe(false)
    expect(form.fields[0].value).toBe('')
  })

  it('knows a secret by its words, not by a substring', () => {
    expect(looksLikeSecret('TmdbApiKey')).toBe(true)
    expect(looksLikeSecret('Password')).toBe(true)
    expect(looksLikeSecret('client_secret')).toBe(true)
    expect(looksLikeSecret('WebhookToken')).toBe(true)
    // These would all be masked by a naive /key|pass|auth/ test, and a masked
    // field is one nobody can read back — a bad trade for a plain setting.
    expect(looksLikeSecret('Keywords')).toBe(false)
    expect(looksLikeSecret('KeyframeInterval')).toBe(false)
    expect(looksLikeSecret('Passthrough')).toBe(false)
    expect(looksLikeSecret('AuthorName')).toBe(false)
  })

  it('shows a nested object read-only instead of mangling it', () => {
    const form = pluginConfigForm({ Server: { Host: 'localhost', Port: 8080 }, Enabled: true })
    expect(form.fields.map((f) => f.key)).toEqual(['Enabled'])
    expect(form.readOnly.map((r) => r.key)).toEqual(['Server'])
    expect(form.readOnly[0].preview).toContain('localhost')
    expect(form.readOnly[0].reason).toMatch(/nested/i)
  })

  it('shows an array read-only too', () => {
    const form = pluginConfigForm({ Users: [{ Name: 'dave' }], Enabled: true })
    expect(form.fields.map((f) => f.key)).toEqual(['Enabled'])
    expect(form.readOnly.map((r) => r.key)).toEqual(['Users'])
    expect(form.readOnly[0].reason).toMatch(/list/i)
  })

  it('will not guess the type of a null, and says so', () => {
    const form = pluginConfigForm({ ApiUrl: null })
    expect(form.fields).toEqual([])
    expect(form.readOnly[0].key).toBe('ApiUrl')
    expect(form.readOnly[0].reason).toMatch(/type/i)
  })

  it('is still a form when every key is uneditable', () => {
    const form = pluginConfigForm({ Users: [] })
    expect(form.kind).toBe('fields')
    expect(form.fields).toEqual([])
    expect(form.readOnly).toHaveLength(1)
  })
})

// ------------------------------------------------------------------- saving

describe('applyPluginConfigEdits', () => {
  const ten = {
    One: 1,
    Two: 'two',
    Three: true,
    Four: 4.5,
    Five: 'five',
    Six: false,
    Seven: 7,
    Eight: 'eight',
    Nine: null,
    Ten: { nested: true },
  }

  it('sends the whole document when one field of ten changed', () => {
    // POST /Plugins/{id}/Configuration replaces the document. A partial body
    // does not merge — it wipes every key it did not mention.
    const form = pluginConfigForm(ten)
    const draft = { ...configDraft(form), Five: 'changed' }
    const saved = applyPluginConfigEdits(ten, draft)
    expect(Object.keys(saved)).toHaveLength(10)
    expect(saved).toEqual({ ...ten, Five: 'changed' })
  })

  it('hands back the values it cannot edit exactly as they arrived', () => {
    const saved = applyPluginConfigEdits(ten, { Ten: 'clobbered', Nine: 'clobbered' })
    expect(saved.Ten).toBe(ten.Ten)
    expect(saved.Nine).toBeNull()
  })

  it('saves the original secret when the masked field was never touched', () => {
    // The bug this exists to stop: the mask is what the input holds, so a save
    // that trusts the draft writes "••••••••" into the plugin's api key and
    // the plugin stops working with no error anywhere.
    const config = { TmdbApiKey: 'real-key', IncludeAdult: false }
    const draft = configDraft(pluginConfigForm(config))
    expect(draft.TmdbApiKey).toBe(SECRET_MASK)
    expect(applyPluginConfigEdits(config, { ...draft, IncludeAdult: true })).toEqual({
      TmdbApiKey: 'real-key',
      IncludeAdult: true,
    })
  })

  it('saves a secret that was typed over', () => {
    const config = { TmdbApiKey: 'real-key' }
    expect(applyPluginConfigEdits(config, { TmdbApiKey: 'new-key' })).toEqual({
      TmdbApiKey: 'new-key',
    })
  })

  it('lets a secret be cleared', () => {
    expect(applyPluginConfigEdits({ TmdbApiKey: 'real-key' }, { TmdbApiKey: '' })).toEqual({
      TmdbApiKey: '',
    })
  })

  it('only treats the mask as untouched where a mask was ever shown', () => {
    // A plain text field is not masked, so a viewer who typed the mask
    // character into one meant it.
    expect(applyPluginConfigEdits({ Note: 'hi' }, { Note: SECRET_MASK })).toEqual({
      Note: SECRET_MASK,
    })
  })

  it('never invents a key the server did not send', () => {
    expect(applyPluginConfigEdits({ Known: 1 }, { Known: 2, Unknown: 3 })).toEqual({ Known: 2 })
  })

  it('keeps the original when a number field was emptied', () => {
    expect(applyPluginConfigEdits({ MaxCastMembers: 15 }, { MaxCastMembers: '' })).toEqual({
      MaxCastMembers: 15,
    })
    expect(applyPluginConfigEdits({ MaxCastMembers: 15 }, { MaxCastMembers: '20' })).toEqual({
      MaxCastMembers: 20,
    })
  })

  it('preserves the type the server sent, not the one the draft holds', () => {
    expect(applyPluginConfigEdits({ On: true }, { On: 'false' })).toEqual({ On: true })
    expect(applyPluginConfigEdits({ On: true }, { On: false })).toEqual({ On: false })
    expect(applyPluginConfigEdits({ Count: 1 }, { Count: 2 })).toEqual({ Count: 2 })
    // A string stays a string even when what it holds is a number and the
    // draft has one. The plugin's property is a string; sending 8080 to a
    // deserialiser expecting "8080" is a save that fails, or worse, one that
    // succeeds and stores something no other client would write.
    expect(applyPluginConfigEdits({ Port: '8080' }, { Port: 8080 })).toEqual({ Port: '8080' })
  })

  it('returns an equal document when nothing was edited', () => {
    const form = pluginConfigForm(ten)
    expect(applyPluginConfigEdits(ten, configDraft(form))).toEqual(ten)
  })
})

describe('configDraft and configEdited', () => {
  it('starts clean and notices a change', () => {
    const config = { IncludeAdult: false, TmdbApiKey: 'real-key' }
    const form = pluginConfigForm(config)
    const draft = configDraft(form)
    expect(configEdited(form, draft)).toBe(false)
    expect(configEdited(form, { ...draft, IncludeAdult: true })).toBe(true)
    expect(configEdited(form, { ...draft, TmdbApiKey: 'typed' })).toBe(true)
  })

  it('holds a number as the text its input contains', () => {
    // Held as a number, an emptied box reports Number('') — a real 0 written
    // into the plugin the moment the field is cleared to be retyped.
    const config = { MaxCastMembers: 15 }
    const form = pluginConfigForm(config)
    expect(configDraft(form)).toEqual({ MaxCastMembers: '15' })
    expect(configEdited(form, { MaxCastMembers: '15' })).toBe(false)
    expect(applyPluginConfigEdits(config, { MaxCastMembers: '' })).toEqual({ MaxCastMembers: 15 })
  })

  it('holds no secret, so nothing renders or logs one', () => {
    const draft = configDraft(pluginConfigForm({ TmdbApiKey: 'real-key' }))
    expect(Object.values(draft)).not.toContain('real-key')
  })
})

describe('the secret input', () => {
  it('shows an empty box rather than the mask, so nothing is typed after it', () => {
    // A box holding •••••••• is a box someone appends to, and the save would
    // then write "••••••••abc" into the plugin's api key.
    expect(secretInputValue(SECRET_MASK)).toBe('')
    expect(secretInputValue('typed')).toBe('typed')
  })

  it('reads an empty box as untouched, not as cleared', () => {
    expect(secretEdit('')).toBe(SECRET_MASK)
    expect(secretEdit('new-key')).toBe('new-key')
    expect(
      applyPluginConfigEdits({ TmdbApiKey: 'real-key' }, { TmdbApiKey: secretEdit('') }),
    ).toEqual({ TmdbApiKey: 'real-key' })
  })
})

describe('redactSecrets', () => {
  it('takes a secret back out of whatever the server said', () => {
    const config = { TmdbApiKey: 'real-key-1234', MaxCastMembers: 15 }
    const message = 'POST failed (400): TmdbApiKey real-key-1234 is not valid'
    expect(redactSecrets(message, config)).toBe(
      `POST failed (400): TmdbApiKey ${SECRET_MASK} is not valid`,
    )
  })

  it('leaves a message that never carried one alone', () => {
    expect(redactSecrets('Could not reach the server.', { TmdbApiKey: 'real-key-1234' })).toBe(
      'Could not reach the server.',
    )
  })

  it('does not redact a value too short to be a secret worth hiding', () => {
    // A one-character api key would otherwise blank every occurrence of that
    // letter in the message.
    expect(redactSecrets('a and b', { Key: 'a' })).toBe('a and b')
  })
})

// -------------------------------------------------------------------- gating

describe('who may read and write a plugin configuration', () => {
  it('gives a non-admin no path, so no request is sent', () => {
    expect(pluginConfigPath({ isAdmin: false, pluginId: 'abc' })).toBeNull()
    expect(pluginTogglePath({ isAdmin: false, pluginId: 'abc', version: '1', enable: true })).toBe(
      null,
    )
  })

  it('builds the path for an admin, escaping the id', () => {
    expect(pluginConfigPath({ isAdmin: true, pluginId: 'abc' })).toBe('/Plugins/abc/Configuration')
    expect(pluginConfigPath({ isAdmin: true, pluginId: '../System' })).toBe(
      '/Plugins/..%2FSystem/Configuration',
    )
  })

  it('refuses a blank id rather than asking about /Plugins//Configuration', () => {
    expect(pluginConfigPath({ isAdmin: true, pluginId: '  ' })).toBeNull()
    expect(pluginTogglePath({ isAdmin: true, pluginId: 'abc', version: '', enable: true })).toBe(
      null,
    )
  })

  it('names the enable and disable routes', () => {
    expect(pluginTogglePath({ isAdmin: true, pluginId: 'abc', version: '1.2', enable: true })).toBe(
      '/Plugins/abc/1.2/Enable',
    )
    expect(pluginTogglePath({ isAdmin: true, pluginId: 'abc', version: '1.2', enable: false })).toBe(
      '/Plugins/abc/1.2/Disable',
    )
  })
})

describe('pluginConfigPlan', () => {
  const row = (status: string) => pluginRows([plugin({ Status: status })])[0]

  it('asks for the configuration of a plugin the server has loaded', () => {
    expect(pluginConfigPlan(row('Active'))).toEqual({ fetch: true, note: null })
  })

  it('does not ask about a plugin that is not running', () => {
    // Measured against a real 10.11.8 server: every one of its seven
    // NotSupported plugins answers /Configuration with 404, and every Active
    // one answers with a document. The endpoint only exists for a plugin the
    // server actually loaded, so the request is known to fail before it is
    // sent — and a 404 rendered as an error would be the wrong story anyway.
    for (const status of ['NotSupported', 'Malfunctioned', 'Disabled', 'Restart', 'Superseded']) {
      const plan = pluginConfigPlan(row(status))
      expect(plan.fetch).toBe(false)
      expect(plan.note).toBeTruthy()
    }
  })

  it('explains the absence in terms of the status, not of the request', () => {
    expect(pluginConfigPlan(row('NotSupported')).note).toMatch(/not running/i)
    expect(pluginConfigPlan(row('Restart')).note).toMatch(/restart/i)
    expect(pluginConfigPlan(row('Disabled')).note).toMatch(/disabled/i)
  })
})

describe('pluginToggle', () => {
  const row = (status: string, version: string | null = '1.0') =>
    pluginRows([plugin({ Status: status, Version: version ?? undefined })])[0]

  it('offers to turn a running plugin off and a disabled one on', () => {
    expect(pluginToggle(row('Active'))?.enable).toBe(false)
    expect(pluginToggle(row('Active'))?.label).toBe('Disable')
    expect(pluginToggle(row('Disabled'))?.enable).toBe(true)
  })

  it('offers nothing for a status the switch cannot fix', () => {
    // Enabling a NotSupported plugin does not make the server load it, so a
    // button here would only look like a repair that failed.
    expect(pluginToggle(row('NotSupported'))).toBeNull()
    expect(pluginToggle(row('Malfunctioned'))).toBeNull()
    expect(pluginToggle(row('Superseded'))).toBeNull()
  })

  it('offers nothing without a version, since the route needs one', () => {
    expect(pluginToggle(row('Active', null))).toBeNull()
  })
})

/*
  Pinning the behaviour rather than the guard.

  Deleting the `Object.hasOwn` check leaves every test passing, which looks
  like a hole and is not one: an unknown key has no value on the document, so
  `typeof before` matches none of the branches and nothing is written either
  way. The check is a shortcut, not the thing doing the work.

  The behaviour still deserves a test, because the *type switch* is what
  actually holds it, and a later edit that adds an `else` for unknown types
  would open exactly the hole the check appears to close. It matters the moment
  two plugins are opened in one sitting: the draft for the first is still in
  hand when the second's document arrives.
*/
describe('a draft cannot invent a key the plugin does not have', () => {
  it('drops a key the server never sent', () => {
    const saved = applyPluginConfigEdits({ Real: 'kept' }, { Real: 'edited', Stray: 'nonsense' })
    expect(saved).toEqual({ Real: 'edited' })
    expect(Object.hasOwn(saved, 'Stray')).toBe(false)
  })

  it('drops every key of a draft belonging to a different plugin', () => {
    const tmdb = { TmdbApiKey: '', MaxCastMembers: 15 }
    const leftOver = { IncludeAdult: true, EnableImages: false, SomeOtherPluginPort: 9000 }
    expect(applyPluginConfigEdits(tmdb, leftOver)).toEqual(tmdb)
  })

  it('still writes the keys that do belong to it', () => {
    expect(applyPluginConfigEdits({ A: 1, B: 'x' }, { A: 7, Ghost: 'no' })).toEqual({ A: 7, B: 'x' })
  })
})
