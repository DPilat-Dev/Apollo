import { describe, expect, it, vi } from 'vitest'
import type { BaseItemDto } from '@jellyfin/sdk/lib/generated-client/models'
import type { BulkPlayedOutcome, BulkPlayedProgress } from '../bulkPlayed'
import {
  PLAYED_BATCH_SIZE,
  PLAYED_QUERY_KEYS,
  bulkPlayedCancelled,
  bulkPlayedConfirmation,
  bulkPlayedMessage,
  bulkPlayedName,
  bulkPlayedNeedsAttention,
  bulkPlayedProgressLabel,
  bulkPlayedTarget,
  chunk,
  episodeQueryFor,
  idsNeedingPlayedChange,
  markAllPlayed,
  partWatchedCount,
  runBulkPlayed,
  shouldInvalidateAfter,
} from '../bulkPlayed'

const episode = (id: string, extra: Partial<BaseItemDto> = {}): BaseItemDto => ({
  Id: id,
  Type: 'Episode',
  ...extra,
})

describe('chunk', () => {
  it('splits a list into runs of at most the given size', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
  })

  it('leaves a short list as a single run', () => {
    expect(chunk([1, 2], 5)).toEqual([[1, 2]])
  })

  it('makes nothing out of nothing', () => {
    expect(chunk([], 5)).toEqual([])
  })

  it('never returns a chunk of zero, whatever it is asked for', () => {
    // A size of 0 would loop forever building empty arrays, and the batch size
    // reaches here from a hook argument.
    expect(chunk([1, 2, 3], 0)).toEqual([[1], [2], [3]])
  })

  it('bounds the concurrency to something a home server can absorb', () => {
    expect(PLAYED_BATCH_SIZE).toBeGreaterThan(0)
    expect(PLAYED_BATCH_SIZE).toBeLessThanOrEqual(8)
  })
})

describe('episodeQueryFor', () => {
  it('asks for every episode of a series', () => {
    expect(episodeQueryFor({ Id: 'series-1', Type: 'Series' })).toEqual({
      seriesId: 'series-1',
      seasonId: undefined,
    })
  })

  it('asks only for the episodes of a season', () => {
    // Getting this wrong marks the entire show watched from a season button,
    // which is the single worst thing this feature could do.
    expect(episodeQueryFor({ Id: 'season-2', Type: 'Season', SeriesId: 'series-1' })).toEqual({
      seriesId: 'series-1',
      seasonId: 'season-2',
    })
  })

  it('refuses a season that does not know its series', () => {
    expect(episodeQueryFor({ Id: 'season-2', Type: 'Season' })).toBeNull()
  })

  it('refuses a leaf item', () => {
    expect(episodeQueryFor({ Id: 'ep-1', Type: 'Episode' })).toBeNull()
    expect(episodeQueryFor({ Id: 'film-1', Type: 'Movie' })).toBeNull()
  })
})

describe('bulkPlayedTarget', () => {
  it('claims series and seasons, and nothing else', () => {
    expect(bulkPlayedTarget({ Id: 's', Type: 'Series' })).toBe(true)
    expect(bulkPlayedTarget({ Id: 's', Type: 'Season', SeriesId: 'x' })).toBe(true)
    expect(bulkPlayedTarget({ Id: 'm', Type: 'Movie' })).toBe(false)
    expect(bulkPlayedTarget(undefined)).toBe(false)
  })
})

describe('idsNeedingPlayedChange', () => {
  it('skips episodes already in the state being asked for', () => {
    // Every skipped episode is a request not sent, which is what makes a retry
    // after a partial failure cost only the episodes that failed.
    const list = [
      episode('a', { UserData: { Played: true } }),
      episode('b', { UserData: { Played: false } }),
      episode('c'),
    ]
    expect(idsNeedingPlayedChange(list, true)).toEqual(['b', 'c'])
    expect(idsNeedingPlayedChange(list, false)).toEqual(['a'])
  })

  it('leaves out episodes the server has no file for', () => {
    const list = [
      episode('a'),
      episode('ghost', { LocationType: 'Virtual' }),
    ]
    expect(idsNeedingPlayedChange(list, true)).toEqual(['a'])
  })

  it('drops items with no id rather than sending a request to /undefined', () => {
    expect(idsNeedingPlayedChange([{ Type: 'Episode' }, episode('a')], true)).toEqual(['a'])
  })

  it('never repeats an id', () => {
    expect(idsNeedingPlayedChange([episode('a'), episode('a')], true)).toEqual(['a'])
  })

  it('copes with a list that has not loaded', () => {
    expect(idsNeedingPlayedChange(undefined, true)).toEqual([])
  })
})

describe('partWatchedCount', () => {
  it('counts only the episodes about to be touched that someone is midway through', () => {
    const list = [
      episode('a', { RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 400 } }),
      episode('b', { RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 0 } }),
      episode('c', { RunTimeTicks: 1000, UserData: { PlaybackPositionTicks: 500 } }),
    ]
    // 'c' is not in the run, so its position is not at stake.
    expect(partWatchedCount(list, ['a', 'b'])).toBe(1)
  })

  it('is zero for a list nobody has started', () => {
    expect(partWatchedCount([episode('a')], ['a'])).toBe(0)
    expect(partWatchedCount(undefined, ['a'])).toBe(0)
  })
})

/** Records the order and grouping of calls so concurrency can be asserted. */
function recordingMarker(failFor: (id: string) => boolean = () => false) {
  const started: string[] = []
  let inFlight = 0
  let peak = 0
  const mark = async (id: string) => {
    started.push(id)
    inFlight += 1
    peak = Math.max(peak, inFlight)
    await Promise.resolve()
    inFlight -= 1
    if (failFor(id)) throw new Error(`no ${id}`)
    return {}
  }
  return { mark, started, peak: () => peak }
}

describe('markAllPlayed', () => {
  it('sends one request per episode and reports them all done', async () => {
    const rec = recordingMarker()
    const outcome = await markAllPlayed({
      ids: ['a', 'b', 'c'],
      played: true,
      mark: rec.mark,
    })

    expect(rec.started).toEqual(['a', 'b', 'c'])
    expect(outcome).toMatchObject({ total: 3, succeeded: 3, failed: [], played: true })
  })

  it('never has more than the batch size in flight at once', async () => {
    const rec = recordingMarker()
    await markAllPlayed({ ids: ['a', 'b', 'c', 'd', 'e'], played: true, mark: rec.mark, batchSize: 2 })
    expect(rec.peak()).toBeLessThanOrEqual(2)
  })

  it('reports progress as it goes, so several seconds does not look frozen', async () => {
    const rec = recordingMarker()
    const seen: number[] = []
    await markAllPlayed({
      ids: ['a', 'b', 'c', 'd', 'e'],
      played: true,
      mark: rec.mark,
      batchSize: 2,
      onProgress: (p) => seen.push(p.done),
    })
    expect(seen).toEqual([2, 4, 5])
  })

  it('finishes the rest of the show when one episode fails', async () => {
    // Partial failure is the normal case here, not the edge case: one 500 in
    // the middle must not abandon the other sixty episodes.
    const rec = recordingMarker((id) => id === 'c')
    const outcome = await markAllPlayed({
      ids: ['a', 'b', 'c', 'd', 'e'],
      played: true,
      mark: rec.mark,
      batchSize: 2,
    })

    expect(rec.started).toHaveLength(5)
    expect(outcome).toMatchObject({ total: 5, succeeded: 4, failed: ['c'], abandoned: false })
  })

  it('gives up when the first batch fails outright', async () => {
    // An expired token or a server that has gone away fails every request. Sixty
    // more doomed writes help nobody, so the run stops after the first batch.
    const rec = recordingMarker(() => true)
    const outcome = await markAllPlayed({
      ids: ['a', 'b', 'c', 'd', 'e', 'f'],
      played: true,
      mark: rec.mark,
      batchSize: 2,
    })

    expect(rec.started).toEqual(['a', 'b'])
    expect(outcome).toMatchObject({ succeeded: 0, abandoned: true, total: 6 })
  })

  it('keeps going once anything at all has worked', async () => {
    const rec = recordingMarker((id) => id !== 'a')
    const outcome = await markAllPlayed({
      ids: ['a', 'b', 'c', 'd'],
      played: true,
      mark: rec.mark,
      batchSize: 2,
    })
    expect(rec.started).toHaveLength(4)
    expect(outcome.abandoned).toBe(false)
  })

  it('passes the state being asked for through to every request', async () => {
    const calls: [string, boolean][] = []
    await markAllPlayed({
      ids: ['a', 'b'],
      played: false,
      mark: async (id, played) => {
        calls.push([id, played])
      },
    })
    expect(calls).toEqual([
      ['a', false],
      ['b', false],
    ])
  })

  it('sends nothing when there is nothing to change', async () => {
    const mark = vi.fn()
    const outcome = await markAllPlayed({ ids: [], played: true, mark })
    expect(mark).not.toHaveBeenCalled()
    expect(outcome).toMatchObject({ total: 0, succeeded: 0, failed: [], abandoned: false })
  })
})

describe('runBulkPlayed', () => {
  const series: BaseItemDto = { Id: 'series-1', Type: 'Series', Name: 'Breaking Bad' }
  const season: BaseItemDto = {
    Id: 'season-2',
    Type: 'Season',
    Name: 'Season 2',
    SeriesId: 'series-1',
    SeriesName: 'Breaking Bad',
  }

  function harness(episodes: BaseItemDto[]) {
    const asked: [string, string | undefined][] = []
    const marked: string[] = []
    return {
      asked,
      marked,
      listEpisodes: async (seriesId: string, seasonId: string | undefined) => {
        asked.push([seriesId, seasonId])
        return episodes
      },
      mark: async (id: string) => {
        marked.push(id)
      },
    }
  }

  it('marks every episode of a series', async () => {
    const h = harness([episode('a'), episode('b')])
    const outcome = await runBulkPlayed({
      item: series,
      played: true,
      ...h,
      confirm: () => true,
    })

    expect(h.asked).toEqual([['series-1', undefined]])
    expect(h.marked).toEqual(['a', 'b'])
    expect(outcome).toMatchObject({ total: 2, succeeded: 2 })
  })

  it('marks only the episodes of the season it was given', async () => {
    // The bug this exists to prevent: asking for the series' episodes from a
    // season button marks a whole show from one poster, with no undo.
    const h = harness([episode('a')])
    await runBulkPlayed({ item: season, played: true, ...h, confirm: () => true })
    expect(h.asked).toEqual([['series-1', 'season-2']])
  })

  it('sends nothing at all when everything is already watched', async () => {
    const h = harness([episode('a', { UserData: { Played: true } })])
    const outcome = await runBulkPlayed({
      item: series,
      played: true,
      ...h,
      confirm: () => true,
    })
    expect(h.marked).toEqual([])
    expect(bulkPlayedMessage(outcome)).toBe('Already watched.')
  })

  it('asks before unwatching a show, and writes nothing if refused', async () => {
    const h = harness([episode('a', { UserData: { Played: true } }), episode('b', { UserData: { Played: true } })])
    const prompts: string[] = []
    const outcome = await runBulkPlayed({
      item: series,
      played: false,
      ...h,
      confirm: (message) => {
        prompts.push(message)
        return false
      },
    })

    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('Breaking Bad')
    expect(h.marked).toEqual([])
    expect(outcome.cancelled).toBe(true)
  })

  it('does not interrupt an ordinary mark-watched', async () => {
    const h = harness([episode('a'), episode('b')])
    const confirm = vi.fn(() => true)
    await runBulkPlayed({ item: series, played: true, ...h, confirm })
    expect(confirm).not.toHaveBeenCalled()
  })

  it('reports zero progress before the first request goes out', async () => {
    // Otherwise the first sign of life is a whole batch later, and the button
    // spends that time looking broken.
    const h = harness([episode('a'), episode('b'), episode('c')])
    const seen: BulkPlayedProgress[] = []
    await runBulkPlayed({
      item: series,
      played: true,
      ...h,
      confirm: () => true,
      batchSize: 2,
      onProgress: (p) => seen.push(p),
    })
    expect(seen).toEqual([
      { done: 0, total: 3 },
      { done: 2, total: 3 },
      { done: 3, total: 3 },
    ])
  })

  it('refuses an item with no episodes underneath it', async () => {
    const h = harness([])
    await expect(
      runBulkPlayed({ item: { Id: 'm', Type: 'Movie' }, played: true, ...h, confirm: () => true }),
    ).rejects.toThrow()
    expect(h.asked).toEqual([])
  })
})

describe('bulkPlayedMessage', () => {
  const outcome = (o: Partial<Parameters<typeof bulkPlayedMessage>[0]>) =>
    bulkPlayedMessage({
      total: 0,
      succeeded: 0,
      failed: [],
      abandoned: false,
      played: true,
      ...o,
    })

  it('says nothing when there was nothing to do', () => {
    expect(outcome({ total: 0 })).toBe('Already watched.')
    expect(outcome({ total: 0, played: false })).toBe('Already unwatched.')
  })

  it('confirms a clean run', () => {
    expect(outcome({ total: 62, succeeded: 62 })).toBe('Marked 62 episodes watched.')
    expect(outcome({ total: 1, succeeded: 1, played: false })).toBe('Marked 1 episode unwatched.')
  })

  it('never claims a partial write finished', () => {
    // Showing "done" over a half-marked show is the worst outcome available:
    // the counts stay wrong and nobody knows to try again.
    expect(outcome({ total: 62, succeeded: 58, failed: ['x', 'y', 'z', 'w'] })).toBe(
      'Marked 58 of 62 episodes watched. 4 failed — try again to finish the rest.',
    )
  })

  it('says plainly that nothing happened when the run was abandoned', () => {
    expect(outcome({ total: 62, succeeded: 0, failed: ['a'], abandoned: true })).toBe(
      "Couldn't reach the server — nothing was marked.",
    )
  })

  it('says nothing at all when the viewer backed out', () => {
    expect(outcome({ total: 62, cancelled: true })).toBeNull()
  })
})

describe('bulkPlayedProgressLabel', () => {
  it('counts up so a long run does not look stuck', () => {
    expect(bulkPlayedProgressLabel({ done: 12, total: 62 }, true)).toBe('Marking watched… 12/62')
    expect(bulkPlayedProgressLabel({ done: 0, total: 3 }, false)).toBe('Marking unwatched… 0/3')
  })

  it('has nothing to say when nothing is running', () => {
    expect(bulkPlayedProgressLabel(null, true)).toBeNull()
  })
})

describe('bulkPlayedConfirmation', () => {
  it('does not interrupt an ordinary mark-watched', () => {
    expect(
      bulkPlayedConfirmation({ name: 'Breaking Bad', count: 62, played: true, resumingCount: 0 }),
    ).toBeNull()
  })

  it('asks before unwatching a whole show, because there is no undo', () => {
    expect(
      bulkPlayedConfirmation({ name: 'Breaking Bad', count: 62, played: false, resumingCount: 0 }),
    ).toBe(
      'Mark all 62 episodes of Breaking Bad unwatched? This clears watched state and play counts for every one of them, and cannot be undone.',
    )
  })

  it('asks before discarding a part-watched episode', () => {
    // Marking watched resets the playback position server-side, so the episode
    // someone is halfway through stops being resumable.
    expect(
      bulkPlayedConfirmation({ name: 'Breaking Bad', count: 62, played: true, resumingCount: 2 }),
    ).toBe(
      'Mark all 62 episodes of Breaking Bad watched? 2 episodes are part-watched and will lose their position.',
    )
  })

  it('does not interrupt a single item — that is the ordinary toggle', () => {
    expect(bulkPlayedConfirmation({ name: 'X', count: 1, played: false, resumingCount: 0 })).toBeNull()
  })

  it('does not interrupt when there is nothing to change', () => {
    expect(bulkPlayedConfirmation({ name: 'X', count: 0, played: false, resumingCount: 0 })).toBeNull()
  })

  it('manages without a name', () => {
    expect(
      bulkPlayedConfirmation({ name: null, count: 4, played: false, resumingCount: 0 }),
    ).toContain('Mark all 4 episodes unwatched?')
  })
})

describe('bulkPlayedNeedsAttention', () => {
  const outcome = (o: Partial<BulkPlayedOutcome>): BulkPlayedOutcome => ({
    total: 62,
    succeeded: 62,
    failed: [],
    abandoned: false,
    played: true,
    ...o,
  })

  it('keeps quiet about a clean run — the badge already changed', () => {
    expect(bulkPlayedNeedsAttention(outcome({}))).toBe(false)
    expect(bulkPlayedNeedsAttention(undefined)).toBe(false)
    expect(bulkPlayedNeedsAttention(outcome({ cancelled: true }))).toBe(false)
  })

  it('speaks up about anything that did not finish', () => {
    expect(bulkPlayedNeedsAttention(outcome({ succeeded: 58, failed: ['a'] }))).toBe(true)
    expect(bulkPlayedNeedsAttention(outcome({ succeeded: 0, abandoned: true }))).toBe(true)
  })
})

describe('bulkPlayedName', () => {
  it('names the show as well as the season', () => {
    expect(bulkPlayedName({ Type: 'Season', Name: 'Season 2', SeriesName: 'Breaking Bad' })).toBe(
      'Breaking Bad Season 2',
    )
  })

  it('leaves a series as itself', () => {
    expect(bulkPlayedName({ Type: 'Series', Name: 'Breaking Bad' })).toBe('Breaking Bad')
  })

  it('has nothing to say about an unnamed item', () => {
    expect(bulkPlayedName({ Type: 'Series' })).toBeNull()
    expect(bulkPlayedName(undefined)).toBeNull()
  })
})

describe('bulkPlayedCancelled', () => {
  it('is a run that wrote nothing and says nothing', () => {
    const outcome = bulkPlayedCancelled(62, false)
    expect(outcome).toMatchObject({ total: 62, succeeded: 0, failed: [], cancelled: true })
    expect(bulkPlayedMessage(outcome)).toBeNull()
    expect(shouldInvalidateAfter(outcome)).toBe(false)
  })
})

describe('shouldInvalidateAfter', () => {
  it('refetches when anything at all was written', () => {
    expect(
      shouldInvalidateAfter({ total: 5, succeeded: 1, failed: ['b'], abandoned: false, played: true }),
    ).toBe(true)
  })

  it('does not churn every row when nothing was written', () => {
    expect(
      shouldInvalidateAfter({ total: 5, succeeded: 0, failed: ['a'], abandoned: true, played: true }),
    ).toBe(false)
    expect(
      shouldInvalidateAfter({ total: 0, succeeded: 0, failed: [], abandoned: false, played: true, cancelled: true }),
    ).toBe(false)
  })

  it('refetches after an outright error, having no idea what landed', () => {
    expect(shouldInvalidateAfter(undefined)).toBe(true)
  })
})

describe('PLAYED_QUERY_KEYS', () => {
  it('includes Next Up, which played state really does move', () => {
    // Unlike removing a resume position — that changes only where you got to,
    // so Next Up is deliberately left alone there. Marking a series watched
    // empties it, and marking one unwatched puts the first episode back.
    expect(PLAYED_QUERY_KEYS).toContain('nextUp')
  })

  it('includes Continue Watching, which the server clears as a side effect', () => {
    // POST /UserPlayedItems runs MarkPlayed with resetPosition, so the resume
    // position goes with it whether or not the caller wanted that.
    expect(PLAYED_QUERY_KEYS).toContain('resume')
  })

  it('includes the surfaces that show a watched badge or a count', () => {
    for (const key of ['item', 'itemsRow', 'episodes', 'seasons', 'latest']) {
      expect(PLAYED_QUERY_KEYS).toContain(key)
    }
  })
})
