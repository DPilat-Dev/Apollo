import { useState } from 'react'
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../../lib/auth'
import {
  useCreateUser,
  useDeleteUser,
  useResetUserPassword,
  useSetUserPassword,
  useUpdateUser,
  useUpdateUserPolicy,
} from '../../lib/queries'
import { ProfilePictureControl } from '../ProfilePictureControl'
import { UserAvatar } from '../UserAvatar'

const POLICY_TOGGLES = [
  { key: 'IsAdministrator', label: 'Administrator', hint: 'Full access to the dashboard' },
  { key: 'IsDisabled', label: 'Disabled', hint: 'Blocks sign-in without deleting the account' },
  { key: 'IsHidden', label: 'Hidden from sign-in', hint: 'Keeps them off the profile picker' },
  { key: 'EnableRemoteAccess', label: 'Remote access', hint: 'Allow use from outside the LAN' },
  { key: 'EnableContentDownloading', label: 'Downloads', hint: 'Allow downloading media' },
  { key: 'EnableMediaPlayback', label: 'Media playback', hint: 'Allow playing anything at all' },
  { key: 'EnableVideoPlaybackTranscoding', label: 'Video transcoding', hint: 'Allow server-side transcodes' },
] as const

type PolicyKey = (typeof POLICY_TOGGLES)[number]['key']

interface Props {
  user: UserDto
  /** The signed-in admin, who must not be able to lock themselves out. */
  currentUserId?: string
  onClose: () => void
}

export function UserEditor({ user, currentUserId, onClose }: Props) {
  const api = useApi()
  const [name, setName] = useState(user.Name ?? '')
  const [password, setPassword] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const updateUser = useUpdateUser()
  const updatePolicy = useUpdateUserPolicy()
  const setUserPassword = useSetUserPassword()
  const resetPassword = useResetUserPassword()
  const deleteUser = useDeleteUser()

  const userId = user.Id
  const isSelf = Boolean(userId) && userId === currentUserId
  // The policy must round-trip whole: it carries required fields (auth provider
  // ids) that would be wiped if we posted only the flags shown here.
  const policy = user.Policy

  const busy =
    updateUser.isPending ||
    updatePolicy.isPending ||
    setUserPassword.isPending ||
    resetPassword.isPending ||
    deleteUser.isPending

  const fail = (e: unknown) =>
    setNotice(e instanceof Error ? e.message : 'That change did not go through.')

  const togglePolicy = (key: PolicyKey) => {
    if (!policy || !userId) return
    setNotice(null)
    updatePolicy.mutate({ userId, policy: { ...policy, [key]: !policy[key] } }, { onError: fail })
  }

  const saveName = () => {
    if (!name.trim() || name === user.Name || !userId) return
    setNotice(null)
    updateUser.mutate(
      { userId, user: { ...user, Name: name.trim() } },
      { onSuccess: () => setNotice('Name updated.'), onError: fail },
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/10 bg-ink-soft shadow-2xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-white/10 bg-ink-soft/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-3">
            <UserAvatar
              server={api.server}
              userId={userId}
              name={user.Name}
              tag={user.PrimaryImageTag}
              aspectRatio={user.PrimaryImageAspectRatio}
              className="size-9 rounded-full bg-white/10 font-bold"
            />
            <div>
              <p className="font-semibold">{user.Name}</p>
              <p className="text-xs text-white/40">{isSelf ? 'This is you' : 'User account'}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1 text-white/50 hover:text-white">
            ✕
          </button>
        </div>

        <div className="space-y-6 px-5 py-5">
          {notice && (
            <p className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs text-white/75">
              {notice}
            </p>
          )}

          <Group title="Name">
            <div className="flex gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
              />
              <button
                onClick={saveName}
                disabled={busy || !name.trim() || name === user.Name}
                className="shrink-0 rounded-lg bg-white/10 px-4 text-sm transition hover:bg-white/20 disabled:opacity-35"
              >
                Save
              </button>
            </div>
          </Group>

          <Group title="Profile picture">
            <ProfilePictureControl user={user} />
          </Group>

          <Group title="Permissions">
            <div className="divide-y divide-white/8 rounded-lg border border-white/10">
              {POLICY_TOGGLES.map((t) => {
                // Removing your own admin rights locks you out of this page.
                const locked = isSelf && t.key === 'IsAdministrator'
                const lockedDisable = isSelf && t.key === 'IsDisabled'
                const disabled = busy || locked || lockedDisable || !policy
                return (
                  <div key={t.key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm">{t.label}</p>
                      <p className="text-xs text-white/40">
                        {locked || lockedDisable ? 'Locked — this is your own account' : t.hint}
                      </p>
                    </div>
                    <Switch
                      checked={Boolean(policy?.[t.key])}
                      disabled={disabled}
                      label={t.label}
                      onChange={() => togglePolicy(t.key)}
                    />
                  </div>
                )
              })}
            </div>
          </Group>

          <Group title="Password">
            <div className="flex gap-2">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="New password"
                autoComplete="new-password"
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none placeholder:text-white/25 focus:border-white/40"
              />
              <button
                onClick={() => {
                  if (!userId) return
                  setNotice(null)
                  setUserPassword.mutate(
                    { userId, password },
                    {
                      onSuccess: () => {
                        setPassword('')
                        setNotice('Password changed.')
                      },
                      onError: fail,
                    },
                  )
                }}
                disabled={busy || !password}
                className="shrink-0 rounded-lg bg-white/10 px-4 text-sm transition hover:bg-white/20 disabled:opacity-35"
              >
                Set
              </button>
            </div>
            <button
              onClick={() => {
                if (!userId) return
                setNotice(null)
                resetPassword.mutate(
                  { userId },
                  {
                    onSuccess: () => setNotice('Password cleared — this account now signs in with none.'),
                    onError: fail,
                  },
                )
              }}
              disabled={busy}
              className="mt-2 text-xs text-white/45 underline underline-offset-4 transition hover:text-white/80 disabled:opacity-35"
            >
              Clear password entirely
            </button>
          </Group>

          <Group title="Danger zone">
            {isSelf ? (
              <p className="text-xs text-white/40">
                You cannot delete the account you are signed in with.
              </p>
            ) : !confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg border border-accent/40 px-4 py-2 text-sm text-accent transition hover:bg-accent/10"
              >
                Delete {user.Name}
              </button>
            ) : (
              <div className="rounded-lg border border-accent/40 bg-accent/10 p-3">
                <p className="text-sm text-white/85">
                  Permanently delete <strong>{user.Name}</strong>?
                </p>
                <p className="mt-1 text-xs text-white/50">
                  Their watch history and settings go with them. This cannot be undone.
                </p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() =>
                      userId && deleteUser.mutate({ userId }, { onSuccess: onClose, onError: fail })
                    }
                    disabled={busy}
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-50"
                  >
                    {deleteUser.isPending ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:border-white/45"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </Group>
        </div>
      </div>
    </div>
  )
}

export function NewUserDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createUser = useCreateUser()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-xl border border-white/10 bg-ink-soft p-5 shadow-2xl">
        <h2 className="text-lg font-semibold">Add a user</h2>
        <p className="mt-1 text-xs text-white/45">
          Library access defaults to everything; narrow it afterwards if you need to.
        </p>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Username</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-white/50">Password (optional)</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/40"
            />
          </label>
          {error && <p className="text-xs text-red-300">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:border-white/45"
          >
            Cancel
          </button>
          <button
            onClick={() =>
              createUser.mutate(
                { name: name.trim(), password },
                {
                  onSuccess: onClose,
                  onError: (e) =>
                    setError(e instanceof Error ? e.message : 'Could not create that user.'),
                },
              )
            }
            disabled={!name.trim() || createUser.isPending}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold transition hover:bg-accent-hot disabled:opacity-40"
          >
            {createUser.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">{title}</h3>
      {children}
    </section>
  )
}

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  label: string
  onChange: () => void
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-30 ${
        checked ? 'bg-accent' : 'bg-white/20'
      }`}
    >
      {/* Positioned with `left`, not translate — see Settings.tsx for why. */}
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-white transition-[left] duration-200 ${
          checked ? 'left-[1.375rem]' : 'left-0.5'
        }`}
      />
    </button>
  )
}
