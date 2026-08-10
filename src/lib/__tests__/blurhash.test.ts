import { describe, expect, it } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { blurhashFor, decodeBlurhash, isValidBlurhash } from '../blurhash'

// The canonical example from the BlurHash reference implementation.
const VALID = 'LEHV6nWB2yk8pyo0adR*.7kCMdnj'

describe('isValidBlurhash', () => {
  it('accepts a well-formed hash', () => {
    expect(isValidBlurhash(VALID)).toBe(true)
  })

  it('rejects anything the length rule disagrees with', () => {
    // First character encodes the component counts, which fix the length.
    expect(isValidBlurhash(VALID.slice(0, -1))).toBe(false)
    expect(isValidBlurhash(`${VALID}x`)).toBe(false)
  })

  it('rejects empty and stub values', () => {
    expect(isValidBlurhash('')).toBe(false)
    expect(isValidBlurhash('L')).toBe(false)
  })
})

describe('decodeBlurhash', () => {
  it('returns RGBA for every pixel, fully opaque', () => {
    const px = decodeBlurhash(VALID, 8, 8)
    expect(px.length).toBe(8 * 8 * 4)
    for (let i = 3; i < px.length; i += 4) expect(px[i]).toBe(255)
  })

  it('produces channel values in range', () => {
    const px = decodeBlurhash(VALID, 6, 6)
    expect(Math.min(...px)).toBeGreaterThanOrEqual(0)
    expect(Math.max(...px)).toBeLessThanOrEqual(255)
  })

  it('is deterministic', () => {
    expect(Array.from(decodeBlurhash(VALID, 4, 4))).toEqual(
      Array.from(decodeBlurhash(VALID, 4, 4)),
    )
  })

  it('actually varies across the image rather than returning a flat fill', () => {
    const px = decodeBlurhash(VALID, 8, 8)
    expect(new Set(px).size).toBeGreaterThan(1)
  })

  it('throws on a malformed hash rather than returning noise', () => {
    expect(() => decodeBlurhash('nope', 4, 4)).toThrow()
  })
})

/**
 * The URL builders decide which image and tag to request; Jellyfin keys its
 * hashes by that same tag. Getting this join wrong shows the wrong artwork
 * blurred behind the right image, which looks like a bug rather than a
 * placeholder.
 */
describe('blurhashFor', () => {
  const item = {
    Id: 'i1',
    ImageBlurHashes: {
      Primary: { 'tag-primary': 'HASH_P' },
      Thumb: { 'tag-thumb': 'HASH_T' },
    },
  } as unknown as BaseItemDto

  it('matches the hash to the tag the URL asked for', () => {
    expect(blurhashFor(item, 'http://s/Items/i1/Images/Primary?tag=tag-primary')).toBe('HASH_P')
    expect(blurhashFor(item, 'http://s/Items/i1/Images/Thumb?tag=tag-thumb')).toBe('HASH_T')
  })

  it('returns null when the tag is unknown, rather than any hash it has', () => {
    expect(blurhashFor(item, 'http://s/Items/i1/Images/Primary?tag=other')).toBeNull()
  })

  it('copes with no URL, no tag, no hashes', () => {
    expect(blurhashFor(item, null)).toBeNull()
    expect(blurhashFor(item, 'http://s/Items/i1/Images/Primary')).toBeNull()
    expect(blurhashFor({ Id: 'i1' } as BaseItemDto, 'http://s/x?tag=t')).toBeNull()
  })

  it('does not throw on a malformed URL', () => {
    expect(blurhashFor(item, 'not a url')).toBeNull()
  })
})
