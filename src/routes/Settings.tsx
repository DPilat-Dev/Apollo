import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { accountsToOffer, loadAccounts } from '../lib/accounts'
import { useAuth } from '../lib/auth'
import { useCurrentUser, useIsAdmin } from '../lib/queries'
import {
  BITRATE_OPTIONS,
  resetSettings,
  setSetting,
  useSettings,
  type Settings as SettingsShape,
} from '../lib/settings'
import { CLIENT_NAME, CLIENT_VERSION, deviceId } from '../lib/api'
import { JellyseerrSection } from '../components/JellyseerrSection'

const SUBTITLE_COLORS = [
  { value: '#ffffff', label: 'White' },
  { value: '#f5e663', label: 'Yellow' },
  { value: '#8ce99a', label: 'Green' },
  { value: '#74c0fc', label: 'Blue' },
  { value: '#ffa8a8', label: 'Red' },
]


export function Settings() {
  const { session, signOut, switchUser } = useAuth()
  const settings = useSettings()
  const { data: me } = useCurrentUser()
  const isAdmin = useIsAdmin()

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-24 sm:px-8 sm:pt-28">
      <h1 className="mb-8 text-3xl font-bold sm:text-4xl">Settings</h1>

      <Section title="Account">
        <Field label="Signed in as" value={session?.userName ?? '—'} />
        <Field label="Server" value={session?.server ?? '—'} />
        <Field label="This device" value={deviceId().slice(0, 8)} mono />
        {isAdmin && (
          <Row label="Server administration" hint="Manage users, tasks, and activity.">
            <Link
              to="/admin"
              className="rounded border border-white/20 px-4 py-2 text-sm transition hover:border-white/50"
            >
              Open dashboard
            </Link>
          </Row>
        )}
        <DeviceProfiles server={session?.server ?? ''} currentUserId={session?.userId} />
        <Row
          label="Switch user"
          hint="Hands the device over. Your profile stays here, so coming back is a tap and a password."
        >
          <button
            onClick={switchUser}
            className="rounded border border-white/20 px-4 py-2 text-sm transition hover:border-white/50"
          >
            Switch user
          </button>
        </Row>
        <Row
          label="Sign out"
          hint="Ends the session and takes your profile off this device's picker."
        >
          <button
            onClick={signOut}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot"
          >
            Sign out
          </button>
        </Row>
      </Section>


      <Section title="Playback">
        <Row
          label="Maximum quality"
          hint="A lower cap makes the server transcode sooner, which helps on slow connections."
        >
          <select
            value={settings.maxBitrate}
            onChange={(e) => setSetting('maxBitrate', Number(e.target.value))}
            className="rounded border border-white/20 bg-ink-soft px-3 py-2 text-sm outline-none transition hover:border-white/40"
          >
            {BITRATE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </Row>

        <Toggle
          name="autoplayNext"
          label="Autoplay next episode"
          hint="Roll straight into the following episode when one finishes."
          checked={settings.autoplayNext}
        />
        <Toggle
          name="subtitlesDefault"
          label="Subtitles on by default"
          hint="Turns on the default subtitle track whenever a title has one."
          checked={settings.subtitlesDefault}
        />
        <Toggle
          name="autoSkipIntros"
          label="Skip intros automatically"
          hint="Jumps past intros and recaps without asking. Credits are never skipped on their own, in case there is a scene after them."
          checked={settings.autoSkipIntros}
        />
        <Toggle
          name="rotateToLandscape"
          label="Rotate to landscape on phones"
          hint="Takes the player fullscreen and turns the picture sideways when playback starts, so a 16:9 film fills the handset. Touchscreens only, and iOS does not allow it at all."
          checked={settings.rotateToLandscape}
        />
      </Section>

      <Section title="Subtitle appearance">
        <Row
          label="Size"
          hint="Relative to the player's default. The preview below updates as you change it."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={50}
              max={300}
              step={5}
              value={settings.subtitleSize}
              onChange={(e) => setSetting('subtitleSize', Number(e.target.value))}
              className="w-40 accent-[var(--color-accent)]"
            />
            <span className="w-12 text-right text-sm tabular-nums text-white/60">
              {settings.subtitleSize}%
            </span>
          </div>
        </Row>

        <Row label="Colour">
          <div className="flex items-center gap-2">
            {SUBTITLE_COLORS.map((c) => (
              <button
                key={c.value}
                onClick={() => setSetting('subtitleColor', c.value)}
                aria-label={c.label}
                title={c.label}
                className={`size-7 rounded-full border-2 transition ${
                  settings.subtitleColor === c.value
                    ? 'border-white scale-110'
                    : 'border-white/25 hover:border-white/60'
                }`}
                style={{ backgroundColor: c.value }}
              />
            ))}
          </div>
        </Row>

        <Row label="Background" hint="A backing plate makes text readable over a bright scene.">
          <select
            value={settings.subtitleBackground}
            onChange={(e) =>
              setSetting('subtitleBackground', e.target.value as SettingsShape['subtitleBackground'])
            }
            className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
          >
            <option value="none">None (outlined text)</option>
            <option value="subtle">Subtle</option>
            <option value="solid">Solid</option>
          </select>
        </Row>

        <div className="px-4 py-5">
          <p className="mb-2 text-xs text-white/40">Preview</p>
          <div className="flex items-end justify-center rounded-lg bg-gradient-to-br from-sky-800 via-slate-700 to-amber-700 p-5">
            <span
              style={{
                fontSize: `${settings.subtitleSize / 100}rem`,
                color: settings.subtitleColor,
                backgroundColor:
                  settings.subtitleBackground === 'none'
                    ? 'transparent'
                    : settings.subtitleBackground === 'solid'
                      ? 'rgba(0,0,0,0.92)'
                      : 'rgba(0,0,0,0.55)',
                textShadow:
                  settings.subtitleBackground === 'none'
                    ? '0 1px 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.8)'
                    : undefined,
              }}
              className="rounded px-2 py-0.5 text-center leading-snug"
            >
              This is what subtitles will look like.
            </span>
          </div>
        </div>
      </Section>

      <JellyseerrSection />

      <Section title="Appearance">
        <Toggle
          name="reduceMotion"
          label="Reduce motion"
          hint="Stops the hero from crossfading and calms card hover effects."
          checked={settings.reduceMotion}
        />
      </Section>

      <Section title="About">
        {/* The same identity the server is told, so a bug report quoting this
            line matches the session the server has on record. */}
        <Field label="Client" value={`${CLIENT_NAME} ${CLIENT_VERSION}`} />
        {me?.Policy?.IsAdministrator != null && (
          <Field label="Role" value={me.Policy.IsAdministrator ? 'Administrator' : 'User'} />
        )}
        <Row label="Reset preferences" hint="Restores every setting on this page to its default.">
          <button
            onClick={resetSettings}
            className="rounded border border-white/20 px-4 py-2 text-sm transition hover:border-white/50"
          >
            Reset
          </button>
        </Row>
      </Section>
    </div>
  )
}

/**
 * Who this device will offer on the login screen.
 *
 * Shown rather than left implicit because a shared device quietly accumulating
 * a list of names is the sort of thing people should be able to see — and
 * because the hint is the honest place to say what is and is not kept. No
 * request is made: `accountsToOffer` with no published users falls back to what
 * is remembered here, which is exactly the question being answered.
 */
function DeviceProfiles({ server, currentUserId }: { server: string; currentUserId?: string }) {
  const profiles = useMemo(
    () => accountsToOffer({ stored: loadAccounts(), publicUsers: [], server, currentUserId }),
    [server, currentUserId],
  )
  if (profiles.length === 0) return null

  return (
    <Row
      label="Profiles remembered here"
      hint="Names and pictures only — never a password, and never an access token. Switching asks for a password."
    >
      <div className="flex max-w-full flex-wrap justify-end gap-1.5">
        {profiles.map((p) => (
          <span
            key={p.userId}
            className={`truncate rounded-full border px-2.5 py-1 text-xs ${
              p.current ? 'border-accent/50 bg-accent/15 text-white' : 'border-white/15 text-white/60'
            }`}
          >
            {p.name}
            {p.current && ' · you'}
          </span>
        ))}
      </div>
    </Row>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/40">{title}</h2>
      <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/10 bg-ink-soft/60">
        {children}
      </div>
    </section>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-white/45">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <Row label={label}>
      <span className={`truncate text-sm text-white/60 ${mono ? 'font-mono' : ''}`}>{value}</span>
    </Row>
  )
}

function Toggle({
  name,
  label,
  hint,
  checked,
}: {
  name: keyof SettingsShape
  label: string
  hint: string
  checked: boolean
}) {
  return (
    <Row label={label} hint={hint}>
      <button
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => setSetting(name, !checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-white/20'
        }`}
      >
        {/*
          Positioned with `left`, not `translate-x`. An absolutely positioned
          element with no `left` resolves to its static position inside the
          button, and a translate then stacks on top of that — which pushed the
          knob a full knob-width off the track.
        */}
        <span
          className={`absolute top-0.5 size-5 rounded-full bg-white transition-[left] duration-200 ${
            checked ? 'left-[1.375rem]' : 'left-0.5'
          }`}
        />
      </button>
    </Row>
  )
}
