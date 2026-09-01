import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import { JellyfinApi } from '../api'
import { planResumeRemoval } from '../continueWatching'

const item = (id: string, name = id): BaseItemDto => ({ Id: id, Name: name })

describe('planResumeRemoval', () => {
  it('drops the dismissed card and leaves the rest in order', () => {
    const cached = [item('a'), item('b'), item('c')]
    const plan = planResumeRemoval(cached, 'b')

    expect(plan.next.map((i) => i.Id)).toEqual(['a', 'c'])
    expect(plan.changed).toBe(true)
  })

  /*
    The rollback is what a failed request puts back, so it has to be the list
    as it was — same items, same order. Rebuilding it by appending the removed
    item would restore the card at the end of the row instead of where it was.
  */
  it('keeps the original order and the original items for rollback', () => {
    const cached = [item('a'), item('b'), item('c')]
    const plan = planResumeRemoval(cached, 'a')

    expect(plan.rollback).toEqual(cached)
    expect(plan.rollback[0]).toBe(cached[0])
    expect(plan.rollback[1]).toBe(cached[1])
    // A copy, so a later write to the cache cannot reach back into it.
    expect(plan.rollback).not.toBe(cached)
  })

  it('reports nothing changed for an id that is not in the row', () => {
    const cached = [item('a'), item('b')]
    const plan = planResumeRemoval(cached, 'gone')

    expect(plan.next.map((i) => i.Id)).toEqual(['a', 'b'])
    expect(plan.changed).toBe(false)
  })

  it('handles an empty row', () => {
    const plan = planResumeRemoval([], 'a')

    expect(plan.next).toEqual([])
    expect(plan.rollback).toEqual([])
    expect(plan.changed).toBe(false)
  })

  /*
    Pressing × before the row has ever resolved: there is no cache entry to
    edit, and writing one would invent an empty Continue Watching row for a
    query that is still in flight.
  */
  it('handles a cache that has not been filled yet', () => {
    const plan = planResumeRemoval(undefined, 'a')

    expect(plan.next).toEqual([])
    expect(plan.rollback).toEqual([])
    expect(plan.changed).toBe(false)
  })

  it('leaves the cached array untouched', () => {
    const cached = [item('a'), item('b')]
    planResumeRemoval(cached, 'a')

    expect(cached.map((i) => i.Id)).toEqual(['a', 'b'])
  })

  /*
    Two entries for one id should never reach a row — React keys on Id, so it
    would already be warning — but half-removing one would leave a card that
    the server has no resume position for, and no second × to finish the job.
  */
  it('removes every copy of a duplicated id', () => {
    const plan = planResumeRemoval([item('a'), item('b'), item('a')], 'a')

    expect(plan.next.map((i) => i.Id)).toEqual(['b'])
    expect(plan.changed).toBe(true)
  })

  /*
    Id is optional on BaseItemDto, so an item without one must not be matched
    by a missing id — that would empty the row on a card we cannot even name.
  */
  it('removes nothing when there is no id to remove', () => {
    const cached = [{ Name: 'no id' } as BaseItemDto, item('a')]

    expect(planResumeRemoval(cached, '').changed).toBe(false)
    expect(planResumeRemoval(cached, undefined).next).toHaveLength(2)
  })
})

const api = new JellyfinApi({ server: 'http://s', userId: 'u', userName: 'D', token: 't' })

/** Records the request the api sends, and answers with the updated user data. */
function stubFetch() {
  const calls: { url: string; init: RequestInit }[] = []
  vi.stubGlobal('fetch', (url: string, init: RequestInit = {}) => {
    calls.push({ url, init })
    return Promise.resolve(new Response('{}', { status: 200 }))
  })
  return calls
}

afterEach(() => vi.unstubAllGlobals())

/*
  Jellyfin has two ways to get something out of the resume list, and only one
  of them means what the × means. `DELETE /UserPlayedItems/{id}` runs
  BaseItem.MarkUnplayed, which zeroes PlayCount and Played as well as the
  position — dismissing a film you had already seen once would erase that you
  had seen it. The 10.11 user-data endpoint merges only the fields it is
  given, so sending the position alone leaves the rest of the record alone.
*/
describe('clearResumePosition', () => {
  it('posts a zero position to the user-data endpoint', async () => {
    const calls = stubFetch()
    await api.clearResumePosition('item-1')

    expect(calls).toHaveLength(1)
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].url).toContain('/UserItems/item-1/UserData')
    expect(calls[0].url).toContain('userId=u')
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ PlaybackPositionTicks: 0 })
  })

  it('says nothing about played state', async () => {
    const calls = stubFetch()
    await api.clearResumePosition('item-1')
    const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>

    expect(body).not.toHaveProperty('Played')
    expect(body).not.toHaveProperty('PlayCount')
    expect(body).not.toHaveProperty('LastPlayedDate')
    expect(calls[0].url).not.toContain('UserPlayedItems')
  })
})
