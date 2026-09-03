import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AVATAR_MAX_BYTES,
  AVATAR_MAX_EDGE,
  AVATAR_QUERY_KEYS,
  AVATAR_TYPES,
  avatarInitial,
  avatarObjectPosition,
  avatarTargetSize,
  avatarView,
  blobToBase64,
  canEditUserImage,
  checkAvatarFile,
  prepareAvatarUpload,
  userAvatarUrl,
} from '../userImages'

const SERVER = 'http://jelly.lan:8096'

describe('userAvatarUrl', () => {
  it('asks for the picture by user and tag', () => {
    const url = new URL(userAvatarUrl({ server: SERVER, userId: 'u1', tag: 't1' })!)
    expect(url.pathname).toBe('/UserImage')
    expect(url.searchParams.get('userId')).toBe('u1')
    expect(url.searchParams.get('tag')).toBe('t1')
  })

  /*
    The whole point of the tag: without it the browser is free to keep showing
    the picture that was replaced, for as long as it likes.
  */
  it('changes when the tag changes', () => {
    const before = userAvatarUrl({ server: SERVER, userId: 'u1', tag: 'old' })
    const after = userAvatarUrl({ server: SERVER, userId: 'u1', tag: 'new' })
    expect(after).not.toBe(before)
  })

  it('has nothing to ask for when the user has no picture', () => {
    expect(userAvatarUrl({ server: SERVER, userId: 'u1', tag: null })).toBeNull()
    expect(userAvatarUrl({ server: SERVER, userId: 'u1', tag: '' })).toBeNull()
    expect(userAvatarUrl({ server: SERVER, userId: 'u1' })).toBeNull()
  })

  it('has nothing to ask for without a user or a server', () => {
    expect(userAvatarUrl({ server: SERVER, userId: null, tag: 't' })).toBeNull()
    expect(userAvatarUrl({ server: '', userId: 'u1', tag: 't' })).toBeNull()
  })

  // The sign-in picker builds these from whatever is in the address box.
  it('survives a server that is not a URL at all', () => {
    expect(userAvatarUrl({ server: 'not a server', userId: 'u1', tag: 't' })).toBeNull()
  })

  it('keeps a trailing slash and a sub-path from doubling or being eaten', () => {
    expect(userAvatarUrl({ server: 'http://h:8096/', userId: 'u', tag: 't' })).toContain(
      'http://h:8096/UserImage?',
    )
    expect(userAvatarUrl({ server: 'http://h/jellyfin', userId: 'u', tag: 't' })).toContain(
      'http://h/jellyfin/UserImage?',
    )
  })

  // /UserImage answers without credentials, which is what makes the picker's
  // avatars work before anyone has signed in.
  it('carries no token', () => {
    const url = userAvatarUrl({ server: SERVER, userId: 'u1', tag: 't1' })!
    expect(url).not.toContain('api_key')
  })
})

describe('avatarInitial', () => {
  it('is the first letter, capitalised', () => {
    expect(avatarInitial('ada')).toBe('A')
    expect(avatarInitial('Ada Lovelace')).toBe('A')
  })

  it('is a question mark when there is no name at all', () => {
    expect(avatarInitial('')).toBe('?')
    expect(avatarInitial('   ')).toBe('?')
    expect(avatarInitial(null)).toBe('?')
    expect(avatarInitial(undefined)).toBe('?')
  })

  it('copes with a name of one character', () => {
    expect(avatarInitial('a')).toBe('A')
  })

  it('ignores leading space rather than drawing one', () => {
    expect(avatarInitial('  ada')).toBe('A')
  })

  it('shows a non-letter as itself rather than giving up', () => {
    expect(avatarInitial('4chan')).toBe('4')
    expect(avatarInitial('_hidden')).toBe('_')
  })

  /*
    charAt(0) takes half a surrogate pair and draws the replacement glyph. Every
    initial in the app used to be built that way.
  */
  it('takes a whole emoji, not half of one', () => {
    expect(avatarInitial('🎬 night')).toBe('🎬')
  })
})

describe('avatarObjectPosition', () => {
  it('centres a square or landscape picture', () => {
    expect(avatarObjectPosition(1)).toBe('center')
    expect(avatarObjectPosition(1.78)).toBe('center')
  })

  // A portrait cropped down the middle cuts the head off; faces sit high.
  it('crops a portrait from the top', () => {
    expect(avatarObjectPosition(0.75)).toBe('top')
    expect(avatarObjectPosition(0.5)).toBe('top')
  })

  it('centres when the server did not say', () => {
    expect(avatarObjectPosition(null)).toBe('center')
    expect(avatarObjectPosition(undefined)).toBe('center')
    expect(avatarObjectPosition(0)).toBe('center')
    expect(avatarObjectPosition(Number.NaN)).toBe('center')
  })
})

describe('avatarView', () => {
  it('is a picture when there is a tag', () => {
    const view = avatarView({
      server: SERVER,
      userId: 'u1',
      name: 'Ada',
      tag: 't1',
      aspectRatio: 0.7,
    })
    expect(view.src).toContain('/UserImage?')
    expect(view.objectPosition).toBe('top')
  })

  it('falls back to the initial when there is none', () => {
    const view = avatarView({ server: SERVER, userId: 'u1', name: 'Ada', tag: null })
    expect(view.src).toBeNull()
    expect(view.initial).toBe('A')
  })

  it('still has an initial to draw when the picture is there', () => {
    const view = avatarView({ server: SERVER, userId: 'u1', name: 'Ada', tag: 't1' })
    expect(view.initial).toBe('A')
  })
})

describe('checkAvatarFile', () => {
  it('takes the picture formats a browser can be trusted to draw', () => {
    for (const type of AVATAR_TYPES) {
      expect(checkAvatarFile({ type, size: 40_000 })).toEqual({ ok: true, contentType: type })
    }
  })

  it('is not fooled by the extension', () => {
    // An SVG is a script host, and it would be served from the server's own
    // origin — the extension it happens to carry is not the question.
    const lying = checkAvatarFile({ name: 'me.png', type: 'image/svg+xml', size: 2_000 })
    expect(lying.ok).toBe(false)
    const pdf = checkAvatarFile({ name: 'me.jpg', type: 'application/pdf', size: 2_000 })
    expect(pdf.ok).toBe(false)
  })

  it('refuses a type it does not know, including other image kinds', () => {
    expect(checkAvatarFile({ type: 'image/gif', size: 2_000 }).ok).toBe(false)
    expect(checkAvatarFile({ type: '', size: 2_000 }).ok).toBe(false)
    expect(checkAvatarFile({ size: 2_000 }).ok).toBe(false)
  })

  it('accepts a type however it is cased', () => {
    expect(checkAvatarFile({ type: 'IMAGE/JPEG', size: 2_000 })).toEqual({
      ok: true,
      contentType: 'image/jpeg',
    })
  })

  it('refuses an empty file before anything else', () => {
    const empty = checkAvatarFile({ type: 'image/png', size: 0 })
    expect(empty.ok).toBe(false)
    expect(empty.ok === false && empty.message).toMatch(/empty/i)
  })

  it('refuses one too big to be worth sending, and says how big', () => {
    const huge = checkAvatarFile({ type: 'image/jpeg', size: AVATAR_MAX_BYTES + 1 })
    expect(huge.ok).toBe(false)
    expect(huge.ok === false && huge.message).toContain('MB')
  })

  it('takes one exactly at the ceiling', () => {
    expect(checkAvatarFile({ type: 'image/jpeg', size: AVATAR_MAX_BYTES }).ok).toBe(true)
  })
})

describe('avatarTargetSize', () => {
  it('shrinks the long edge to the ceiling and keeps the shape', () => {
    expect(avatarTargetSize({ width: 4000, height: 3000 })).toEqual({
      width: AVATAR_MAX_EDGE,
      height: Math.round((AVATAR_MAX_EDGE * 3) / 4),
    })
    expect(avatarTargetSize({ width: 3000, height: 4000 })).toEqual({
      width: Math.round((AVATAR_MAX_EDGE * 3) / 4),
      height: AVATAR_MAX_EDGE,
    })
  })

  it('leaves a small picture alone rather than blowing it up', () => {
    expect(avatarTargetSize({ width: 120, height: 90 })).toEqual({ width: 120, height: 90 })
  })

  it('never rounds an edge away to nothing', () => {
    expect(avatarTargetSize({ width: 8000, height: 3 })?.height).toBeGreaterThanOrEqual(1)
  })

  it('gives back nothing usable for a picture with no size', () => {
    expect(avatarTargetSize({ width: 0, height: 0 })).toBeNull()
    expect(avatarTargetSize({ width: Number.NaN, height: 10 })).toBeNull()
  })
})

describe('canEditUserImage', () => {
  it('lets anyone change their own', () => {
    expect(canEditUserImage({ isAdmin: false, targetUserId: 'u1', currentUserId: 'u1' })).toBe(true)
  })

  it('does not let one viewer change another’s', () => {
    expect(canEditUserImage({ isAdmin: false, targetUserId: 'u2', currentUserId: 'u1' })).toBe(false)
  })

  it('lets an administrator change anyone’s', () => {
    expect(canEditUserImage({ isAdmin: true, targetUserId: 'u2', currentUserId: 'u1' })).toBe(true)
  })

  it('refuses when there is no account to change', () => {
    expect(canEditUserImage({ isAdmin: true, targetUserId: null, currentUserId: 'u1' })).toBe(false)
    expect(canEditUserImage({ isAdmin: true, targetUserId: '', currentUserId: 'u1' })).toBe(false)
  })

  it('refuses when nobody is signed in, admin flag or not', () => {
    expect(canEditUserImage({ isAdmin: false, targetUserId: 'u1', currentUserId: null })).toBe(false)
  })
})

describe('AVATAR_QUERY_KEYS', () => {
  /*
    The tag is the cache key, and a stale tag is indistinguishable from a failed
    upload: the old picture simply stays. Both lists that carry a
    PrimaryImageTag have to be asked again.
  */
  it('covers every list a PrimaryImageTag arrives in', () => {
    expect(AVATAR_QUERY_KEYS).toContain('me')
    expect(AVATAR_QUERY_KEYS).toContain('allUsers')
  })
})

// ---------------------------------------------------------------- preparing

/** A canvas that records what it was asked to draw and hands back a small blob. */
function stubCanvas() {
  const drawn: { width: number; height: number; type: string; into: number[] }[] = []
  let into: number[] = []
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({
      drawImage: (_img: unknown, _x: number, _y: number, w: number, h: number) => {
        into = [w, h]
      },
    }),
    toBlob: (cb: (blob: Blob | null) => void, type: string) => {
      drawn.push({ width: canvas.width, height: canvas.height, type, into })
      cb(new Blob(['small'], { type }))
    },
  }
  vi.stubGlobal('document', { createElement: () => canvas })
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({ width: 3000, height: 2000, close: () => {} }),
  )
  return drawn
}

const fileLike = (partial: Partial<{ type: string; size: number }> = {}) =>
  ({ type: 'image/jpeg', size: 3_000_000, ...partial }) as File

afterEach(() => vi.unstubAllGlobals())

describe('prepareAvatarUpload', () => {
  it('refuses a file the check refuses, before any decoding', async () => {
    await expect(prepareAvatarUpload(fileLike({ type: 'image/svg+xml' }))).rejects.toThrow(
      /JPEG|PNG|WebP/i,
    )
  })

  it('sends a picture no bigger than an avatar is ever drawn', async () => {
    const drawn = stubCanvas()
    const upload = await prepareAvatarUpload(fileLike())
    expect(drawn).toHaveLength(1)
    expect(Math.max(drawn[0].width, drawn[0].height)).toBe(AVATAR_MAX_EDGE)
    // Drawn *to* the canvas' size, not at the source's. Painting a 3000px
    // bitmap into a 480px canvas keeps the top-left corner and calls it a
    // portrait, and the file that comes out is the right size either way.
    expect(drawn[0].into).toEqual([drawn[0].width, drawn[0].height])
    expect(upload.contentType).toBe('image/jpeg')
    expect(upload.blob.size).toBeLessThan(3_000_000)
  })

  /*
    A browser that cannot decode into a canvas is not a reason to refuse the
    upload — the file already passed the ceiling, so sending it as it came is
    worse only in bandwidth.
  */
  it('sends the file as it came when there is nothing to resize with', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const file = fileLike()
    const upload = await prepareAvatarUpload(file)
    expect(upload.blob).toBe(file)
    expect(upload.contentType).toBe('image/jpeg')
  })
})

describe('blobToBase64 survives an actual photograph', () => {
  /*
    The size guard nothing was exercising. Every other test here uses a few
    bytes, so dropping the chunking passed the suite — and a phone photo, which
    is the only kind of file this feature ever sees, spreads a quarter of a
    million arguments into String.fromCharCode and dies with a RangeError that
    reads nothing like a size problem.
  */
  const big = () => {
    const bytes = new Uint8Array(300_000)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    return new Blob([bytes], { type: 'image/jpeg' })
  }

  it('encodes a 300 kB image without blowing the argument limit', async () => {
    const encoded = await blobToBase64(big())
    expect(encoded.length).toBeGreaterThan(390_000)
    expect(encoded).toMatch(/^[A-Za-z0-9+/]+=*$/)
  })

  it('gets every byte back out again', async () => {
    const blob = big()
    const decoded = Uint8Array.from(atob(await blobToBase64(blob)), (c) => c.charCodeAt(0))
    const original = new Uint8Array(await blob.arrayBuffer())
    expect(decoded.length).toBe(original.length)
    // Spot-checked across the chunk boundaries rather than compared whole: a
    // 300k element deep-equal is slow and says no more than this does.
    for (const at of [0, 0x7fff, 0x8000, 0x8001, 0xffff, 0x10000, original.length - 1]) {
      expect(decoded[at]).toBe(original[at])
    }
  })
})
