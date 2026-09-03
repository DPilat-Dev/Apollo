import { useRef, useState } from 'react'
import type { UserDto } from '@jellyfin/sdk/lib/generated-client/models'
import { useApi } from '../lib/auth'
import { useIsAdmin, useRemoveUserImage, useSetUserImage } from '../lib/queries'
import { AVATAR_TYPES, canEditUserImage, checkAvatarFile } from '../lib/userImages'
import { UserAvatar } from './UserAvatar'

/**
 * Choosing, replacing and removing a profile picture.
 *
 * Shared by Settings, where an account changes its own, and by the user editor,
 * where an administrator changes someone else's — the same control, because
 * they are the same job and only the permission differs. `canEditUserImage`
 * answers that, here and again inside the api, so a screen cannot offer a
 * button the server will refuse.
 *
 * The file is checked before the mutation starts so a rejection is instant and
 * says what was wrong. `prepareAvatarUpload` checks again on its way past —
 * this control is not the only thing that could ever call it.
 */
export function ProfilePictureControl({ user }: { user: UserDto }) {
  const api = useApi()
  const isAdmin = useIsAdmin()
  const setImage = useSetUserImage()
  const removeImage = useRemoveUserImage()
  const fileRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const userId = user.Id
  const mayEdit = canEditUserImage({ isAdmin, targetUserId: userId, currentUserId: api.userId })
  const busy = setImage.isPending || removeImage.isPending

  const fail = (e: unknown) =>
    setNotice(e instanceof Error ? e.message : 'That picture did not go through.')

  const choose = (file: File | undefined) => {
    if (!file || !userId) return
    const check = checkAvatarFile(file)
    if (!check.ok) {
      setNotice(check.message)
      return
    }
    setNotice(null)
    setImage.mutate({ userId, file }, { onError: fail })
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <UserAvatar
        server={api.server}
        userId={userId}
        name={user.Name}
        tag={user.PrimaryImageTag}
        aspectRatio={user.PrimaryImageAspectRatio}
        eager
        className="size-16 shrink-0 rounded-full bg-white/10 text-xl font-bold text-white/75"
      />

      <div className="min-w-0">
        {mayEdit ? (
          <>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                // A filter, not a check: a file picker's "All files" option
                // walks straight past this, which is why the type is decided
                // again on what actually arrives.
                accept={AVATAR_TYPES.join(',')}
                className="hidden"
                onChange={(e) => {
                  choose(e.target.files?.[0])
                  // Cleared so choosing the same file twice still fires.
                  e.target.value = ''
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="rounded-lg bg-white/10 px-4 py-2 text-sm transition hover:bg-white/20 disabled:opacity-35"
              >
                {setImage.isPending ? 'Uploading…' : user.PrimaryImageTag ? 'Replace' : 'Upload'}
              </button>
              {user.PrimaryImageTag && (
                <button
                  onClick={() => {
                    if (!userId) return
                    setNotice(null)
                    removeImage.mutate({ userId }, { onError: fail })
                  }}
                  disabled={busy}
                  className="rounded-lg border border-white/20 px-4 py-2 text-sm transition hover:border-white/45 disabled:opacity-35"
                >
                  {removeImage.isPending ? 'Removing…' : 'Remove'}
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-white/45">
              JPEG, PNG or WebP. Large photos are scaled down before they are sent.
            </p>
          </>
        ) : (
          <p className="text-xs text-white/45">
            Only an administrator can change another account's picture.
          </p>
        )}
        {notice && <p className="mt-2 text-xs text-accent">{notice}</p>}
      </div>
    </div>
  )
}
