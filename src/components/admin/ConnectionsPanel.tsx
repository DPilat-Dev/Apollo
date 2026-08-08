import { useState } from 'react'
import {
  useJellyseerrSession,
  useRuntimeConfig,
  useSaveRuntimeConfig,
} from '../../lib/queries'
import { setSetting, useSettings } from '../../lib/settings'
import { publicSettings } from '../../lib/jellyseerr'
import { Section, ToggleRow, ToggleRows, Warning } from './controls'

export function ConnectionsPanel() {
  return (
    <div className="max-w-3xl space-y-8">
      <JellyseerrConnection />
    </div>
  )
}

function JellyseerrConnection() {
  const session = useJellyseerrSession()
  const settings = useSettings()
  const config = useRuntimeConfig()
  const save = useSaveRuntimeConfig()
  const [probe, setProbe] = useState<string | null>(null)
  const [probing, setProbing] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [saveNote, setSaveNote] = useState<string | null>(null)

  const savedTarget = config.data?.jellyseerrTarget ?? ''
  const target = draft ?? savedTarget
  const dirty = draft !== null && draft !== savedTarget
  // Without our own server there is nowhere to persist this.
  const editable = !config.isError

  const reachable = Boolean(session.data?.reachable)
  const user = session.data?.user

  const test = async () => {
    setProbing(true)
    setProbe(null)
    try {
      const info = await publicSettings()
      setProbe(`Reached ${info.applicationTitle ?? 'Jellyseerr'} through /jellyseerr.`)
    } catch (e) {
      setProbe(e instanceof Error ? e.message : 'Could not reach Jellyseerr.')
    } finally {
      setProbing(false)
      void session.refetch()
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Jellyseerr</h2>
          <p className="text-sm text-white/45">Requests for titles that aren't in the library.</p>
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${
            reachable
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-amber-500/15 text-amber-200'
          }`}
        >
          {session.isLoading ? 'Checking…' : reachable ? 'Connected' : 'Not reachable'}
        </span>
      </div>

      <Section title="Status">
        <dl className="divide-y divide-white/8 rounded-lg border border-white/10 text-sm">
          <Detail label="Proxy path" value="/jellyseerr" mono />
          <Detail
            label="Reachable"
            value={session.isLoading ? 'checking…' : reachable ? 'yes' : 'no'}
          />
          <Detail
            label="Requesting as"
            value={
              user
                ? (user.displayName ?? 'this account')
                : session.data?.wrongAccount
                  ? 'nobody — a stale session was cleared'
                  : 'nobody — not signed in'
            }
          />
        </dl>
      </Section>

      <div className="mt-6">
        <Section
          title="Address"
          hint={
            editable
              ? 'Saved on the server and applied immediately — no restart.'
              : undefined
          }
        >
          {editable ? (
            <>
              <div className="flex flex-wrap gap-2">
                <input
                  value={target}
                  onChange={(e) => {
                    setDraft(e.target.value)
                    setSaveNote(null)
                  }}
                  placeholder="jellyseerr.example.com:5055"
                  className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-sm outline-none placeholder:text-white/25 focus:border-white/40"
                />
                <button
                  onClick={() =>
                    save.mutate(
                      { jellyseerrTarget: target },
                      {
                        onSuccess: (saved) => {
                          setDraft(null)
                          setSaveNote(`Now pointing at ${saved.jellyseerrTarget || '(nothing)'}.`)
                          void test()
                        },
                        onError: (e) =>
                          setSaveNote(e instanceof Error ? e.message : 'Could not save.'),
                      },
                    )
                  }
                  disabled={!dirty || save.isPending}
                  className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-35"
                >
                  {save.isPending ? 'Saving…' : 'Save'}
                </button>
                <button
                  onClick={test}
                  disabled={probing}
                  className="shrink-0 rounded-lg bg-white/10 px-4 py-2 text-sm transition hover:bg-white/20 disabled:opacity-40"
                >
                  {probing ? 'Testing…' : 'Test'}
                </button>
              </div>
              {(saveNote || probe) && (
                <p className="mt-2 text-xs text-white/60">{saveNote ?? probe}</p>
              )}
              <p className="mt-2 text-xs text-white/35">
                Changing this needs Jellyfin administrator rights, which the server verifies
                against Jellyfin itself before writing.
              </p>
            </>
          ) : (
            <Warning>
              This build is being served by something that doesn't provide Apollo's config
              endpoint, so the address can only be changed where that server is configured. Run{' '}
              <code className="text-amber-100">npm run serve</code> to make it editable here.
            </Warning>
          )}
        </Section>
      </div>

      <div className="mt-6">
        <Section title="Behaviour" hint="Applies to this browser.">
          <ToggleRows>
            <ToggleRow
              label="Show request results in search"
              hint="Hides the Jellyseerr shelf without disconnecting"
              checked={settings.jellyseerrEnabled}
              onChange={() => setSetting('jellyseerrEnabled', !settings.jellyseerrEnabled)}
            />
            <ToggleRow
              label="Request whole series"
              hint="Off requests only the first season of a show"
              checked={settings.requestAllSeasons}
              onChange={() => setSetting('requestAllSeasons', !settings.requestAllSeasons)}
            />
          </ToggleRows>
        </Section>
      </div>

    </div>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <dt className="text-white/45">{label}</dt>
      <dd className={`truncate text-white/85 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  )
}

