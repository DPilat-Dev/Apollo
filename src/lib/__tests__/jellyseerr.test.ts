import { describe, expect, it } from 'vitest'
import { availability, sessionBelongsTo, type SeerrUser } from '../jellyseerr'

/**
 * Regression, and the important one: Jellyseerr's session is a cookie, so it
 * belongs to the *browser*, not the account. Without this check one person
 * connecting left the next person filing requests under their name and quota.
 */
describe('sessionBelongsTo', () => {
  const jellyfin = { userId: 'aaaa-1111-bbbb', userName: 'David' }

  it('accepts a session linked to the same Jellyfin account', () => {
    const user = { id: 1, jellyfinUserId: 'aaaa-1111-bbbb' } as SeerrUser
    expect(sessionBelongsTo(user, jellyfin)).toBe(true)
  })

  it('ignores dash and case differences in the id', () => {
    const user = { id: 1, jellyfinUserId: 'AAAA1111BBBB' } as SeerrUser
    expect(sessionBelongsTo(user, jellyfin)).toBe(true)
  })

  it('rejects a session belonging to somebody else', () => {
    const user = { id: 2, jellyfinUserId: 'cccc-2222-dddd' } as SeerrUser
    expect(sessionBelongsTo(user, jellyfin)).toBe(false)
  })

  it('falls back to the username when no id is linked', () => {
    expect(sessionBelongsTo({ id: 1, jellyfinUsername: 'david' } as SeerrUser, jellyfin)).toBe(true)
    expect(sessionBelongsTo({ id: 1, jellyfinUsername: 'mateo' } as SeerrUser, jellyfin)).toBe(false)
  })

  it('refuses a session it cannot attribute at all', () => {
    // Being unable to tell whose session it is, is not a reason to trust it.
    expect(sessionBelongsTo({ id: 9 } as SeerrUser, jellyfin)).toBe(false)
  })
})

describe('availability', () => {
  it('will not offer to request something already there', () => {
    expect(availability({ id: 1, mediaType: 'movie', mediaInfo: { status: 5 } }).requestable).toBe(
      false,
    )
    expect(availability({ id: 1, mediaType: 'movie', mediaInfo: { status: 2 } }).requestable).toBe(
      false,
    )
  })

  it('offers partially available shows, since seasons may be missing', () => {
    expect(availability({ id: 1, mediaType: 'tv', mediaInfo: { status: 4 } }).requestable).toBe(true)
  })

  it('offers anything unknown to the server', () => {
    expect(availability({ id: 1, mediaType: 'movie' }).requestable).toBe(true)
  })
})
