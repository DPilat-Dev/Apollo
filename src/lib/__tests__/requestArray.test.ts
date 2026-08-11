import { describe, expect, it, vi, afterEach } from 'vitest'
import { JellyfinApi } from '../api'

const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })

const respond = (body: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as Response)

afterEach(() => vi.restoreAllMocks())

/**
 * Regression: every array endpoint fed .map or .find directly. Jellyfin
 * returns a bare array from some, a QueryResult from others, and 204 from a
 * few — and anything unexpected threw "is not a function" from render, taking
 * the whole screen down rather than one list.
 */
describe('array endpoints always yield an array', () => {
  it('passes a bare array through', async () => {
    respond([{ Id: 'u1' }, { Id: 'u2' }])
    expect(await api.allUsers()).toHaveLength(2)
  })

  it('unwraps a QueryResult', async () => {
    respond({ Items: [{ Id: 'u1' }], TotalRecordCount: 1 })
    expect(await api.allUsers()).toHaveLength(1)
  })

  it('yields an empty array for 204 with no body', async () => {
    respond(undefined, 204)
    expect(await api.allUsers()).toEqual([])
  })

  it('yields an empty array for a shape it did not expect', async () => {
    respond({ Message: 'something went wrong' })
    expect(await api.allUsers()).toEqual([])
    respond(null)
    expect(await api.allUsers()).toEqual([])
  })

  it('covers the other array endpoints too', async () => {
    respond({ unexpected: true })
    expect(await api.plugins()).toEqual([])
    respond({ unexpected: true })
    expect(await api.scheduledTasks()).toEqual([])
  })
})
