/**
 * Profile pictures — the ones Jellyfin has stored all along and this client
 * never asked for.
 *
 * Every avatar here was the first letter of a name in a coloured square, in
 * six different places, each with its own idea of the letter. The picture is
 * one route, `/UserImage`, and one flag: a `UserDto` with no `PrimaryImageTag`
 * has no picture, which is how the fallback is decided without asking for an
 * image and reading a 404 as an answer.
 *
 * ── The tag is the cache key ───────────────────────────────────────────────
 *
 * `/UserImage` is served with strong caching headers when a `tag` is supplied,
 * exactly like item artwork (see the README's *Image request parameters*). So
 * the URL has to be built from the tag the server most recently reported, and
 * an upload has to end with the lists that carry that tag being asked again —
 * `AVATAR_QUERY_KEYS`. Get that wrong and the upload appears to do nothing:
 * the request succeeds, the picture on the server changes, and the browser
 * goes on drawing the old one out of its cache with no error anywhere.
 *
 * ── Why the upload is resized here ─────────────────────────────────────────
 *
 * The one thing `/UserImage` will not do is resize. Item images take
 * `fillWidth`/`quality` and the server renders to fit; against 10.11.8 the
 * user-image route takes `userId`, `tag` and `format` and nothing else. So
 * whatever is uploaded is what every viewer downloads, in full, to draw at
 * 32 pixels. A phone photo is several megabytes of that, forever, which is why
 * the file is scaled down to `AVATAR_MAX_EDGE` before it is sent rather than
 * merely being checked against a ceiling.
 *
 * The ceiling is still here, above the resize, because decoding is not free
 * either: a 60-megapixel file has to be read into memory before it can be
 * scaled, and refusing it with a sentence beats a tab that stops responding.
 */

/**
 * What a browser can be trusted to decode into a canvas *and* to redisplay
 * inertly. SVG is the reason this is a list rather than an `image/*` test: it
 * is a scriptable document, and it would be served back from the server's own
 * origin. GIF is left out for a duller reason — the canvas resize below would
 * flatten an animated one to its first frame without saying so.
 *
 * The check is on the type, never the name. An extension is a claim made by
 * whoever named the file.
 */
export const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Beyond this a file is refused rather than decoded. Well above any camera
 * photo, which the resize handles; low enough to keep a video renamed to .jpg
 * out of memory.
 */
export const AVATAR_MAX_BYTES = 10 * 1024 * 1024

/**
 * The longest edge that leaves the server. An avatar is drawn between 32 and
 * 80 pixels, so this is already several times what any screen here can show —
 * the margin is for the profile-picture preview and for HiDPI.
 */
export const AVATAR_MAX_EDGE = 480

/** Every query that carries a `PrimaryImageTag`, and so goes stale on upload. */
export const AVATAR_QUERY_KEYS = ['me', 'allUsers'] as const

export interface AvatarInput {
  /** Absolute server URL. The sign-in picker has one before it has an api. */
  server: string
  userId?: string | null
  name?: string | null
  /** `PrimaryImageTag` — its absence *is* "this user has no picture". */
  tag?: string | null
  /** `PrimaryImageAspectRatio`. Rarely 1: people upload photographs. */
  aspectRatio?: number | null
}

/**
 * Where the picture lives, or null when there is not one.
 *
 * No token: `/UserImage` is one of the few routes the server answers without
 * credentials, which is what lets the sign-in picker draw faces before anyone
 * has signed in.
 */
export function userAvatarUrl(input: {
  server: string
  userId?: string | null
  tag?: string | null
}): string | null {
  const { server, userId, tag } = input
  if (!server || !userId || !tag) return null
  try {
    const url = new URL('UserImage', `${server.replace(/\/+$/, '')}/`)
    url.searchParams.set('userId', userId)
    url.searchParams.set('tag', tag)
    return url.toString()
  } catch {
    // The picker builds these from whatever is in the address box, and a
    // half-typed server should draw a letter rather than take the page down.
    return null
  }
}

/**
 * The letter to fall back to.
 *
 * `charAt(0)` — which is what all six call sites used — takes half a surrogate
 * pair from a name that starts with an emoji and draws the replacement glyph.
 * Anything that is not a letter is shown as itself: a name beginning with a
 * digit is still more recognisable than a question mark.
 */
export function avatarInitial(name: string | null | undefined): string {
  const first = [...(name ?? '').trim()][0]
  return first ? first.toUpperCase() : '?'
}

/**
 * Where to crop a picture that is not square, which is most of them.
 *
 * The frame is a circle or a rounded square, so something has to go. Cropping
 * a portrait down the middle takes a band through the chin; faces sit in the
 * top third of a photograph, so a tall picture is anchored to its top edge and
 * everything else is centred. Stretching to fit is not on the table — a face
 * squashed into a circle looks like a rendering bug.
 */
export function avatarObjectPosition(aspectRatio: number | null | undefined): 'center' | 'top' {
  if (typeof aspectRatio !== 'number' || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return 'center'
  }
  // A hair under square, so a 1:1 photo saved at 0.999 is not treated as tall.
  return aspectRatio < 0.95 ? 'top' : 'center'
}

export interface AvatarView {
  src: string | null
  initial: string
  objectPosition: 'center' | 'top'
}

/**
 * Picture or letter, decided once.
 *
 * This exists so the choice is not a conditional written out five times in
 * five components, which is how the sign-in picker and the dashboard came to
 * disagree about what an empty name looks like.
 */
export function avatarView(input: AvatarInput): AvatarView {
  return {
    src: userAvatarUrl(input),
    initial: avatarInitial(input.name),
    objectPosition: avatarObjectPosition(input.aspectRatio),
  }
}

export type AvatarFileCheck =
  | { ok: true; contentType: (typeof AVATAR_TYPES)[number] }
  | { ok: false; message: string }

const megabytes = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

/**
 * Whether this file may be uploaded, and what to label it.
 *
 * The order is deliberate. An empty file is its own sentence — it is nearly
 * always a failed drag or a file still syncing, and "choose a JPEG, PNG or
 * WebP" would be a confusing thing to say about a PNG. Type comes before size
 * because a rejected type's size is beside the point.
 */
export function checkAvatarFile(file: {
  name?: string
  type?: string
  size?: number
}): AvatarFileCheck {
  const size = file.size ?? 0
  if (size <= 0) return { ok: false, message: 'That file is empty.' }

  const type = (file.type ?? '').split(';')[0].trim().toLowerCase()
  const accepted = AVATAR_TYPES.find((t) => t === type)
  if (!accepted) {
    return { ok: false, message: 'Choose a JPEG, PNG or WebP image.' }
  }

  if (size > AVATAR_MAX_BYTES) {
    return {
      ok: false,
      message: `That image is ${megabytes(size)}. Choose one under ${megabytes(AVATAR_MAX_BYTES)}.`,
    }
  }

  return { ok: true, contentType: accepted }
}

/**
 * The size to redraw at, or null when the picture has no usable dimensions.
 *
 * Never upscales: an avatar that arrives 96px wide is sent at 96px rather than
 * being blown up to 480 and posted as a blurrier, larger file.
 */
export function avatarTargetSize(input: {
  width: number
  height: number
}): { width: number; height: number } | null {
  const { width, height } = input
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  const scale = Math.min(1, AVATAR_MAX_EDGE / Math.max(width, height))
  return {
    // A panorama scaled to 480 wide rounds its height to zero, and a canvas
    // with a zero edge draws nothing at all.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Whose picture this account may change.
 *
 * Your own is the ordinary case and needs no permission; anyone else's is
 * administrator work, because a profile picture is how the sign-in picker
 * identifies an account and swapping someone else's is impersonation. The
 * decision lives here rather than in the dialog so the api can refuse before
 * sending, and so a second screen offering the control cannot arrive without
 * the gate.
 */
export function canEditUserImage(input: {
  isAdmin: boolean
  targetUserId?: string | null
  currentUserId?: string | null
}): boolean {
  const { isAdmin, targetUserId, currentUserId } = input
  if (!targetUserId) return false
  if (currentUserId && targetUserId === currentUserId) return true
  return Boolean(isAdmin && currentUserId)
}

export interface AvatarUpload {
  blob: Blob
  contentType: string
}

/**
 * The bytes to send: checked, and scaled down to an avatar's size.
 *
 * The encode keeps the source format rather than settling on JPEG, so a PNG
 * with a transparent corner still has one afterwards. At 480px even a PNG
 * photograph is tens of kilobytes, so there is nothing to win by converting.
 *
 * A browser without `createImageBitmap`, or one whose canvas refuses the
 * encode, gets the file as it came — it already passed the ceiling, so the
 * only cost is bandwidth, and refusing the upload over it would be worse. That
 * is what the `catch` is for, and why there is no separate feature test in
 * front of it: a missing `createImageBitmap` throws on the call, which lands
 * in exactly the same place.
 */
export async function prepareAvatarUpload(file: File): Promise<AvatarUpload> {
  const check = checkAvatarFile(file)
  if (!check.ok) throw new Error(check.message)
  const asIs: AvatarUpload = { blob: file, contentType: check.contentType }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const size = avatarTargetSize(bitmap)
    if (!size) return asIs

    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return asIs
    ctx.drawImage(bitmap, 0, 0, size.width, size.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, check.contentType, 0.9),
    )
    return blob ? { blob, contentType: check.contentType } : asIs
  } catch {
    return asIs
  } finally {
    bitmap?.close()
  }
}
