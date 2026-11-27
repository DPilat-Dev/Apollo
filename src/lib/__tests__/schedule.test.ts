import { describe, expect, it } from 'vitest'
import {
  airDayKey,
  airStatus,
  dayKeyOf,
  addMonths,
  dayLabel,
  groupByDay,
  monthGrid,
  monthKeyOf,
  monthLabel,
  isDateOnly,
  withinDays,
  type ScheduleItem,
} from '../schedule'

/**
 * When an episode airs, which is not the same question as when its
 * `PremiereDate` is.
 *
 * Jellyfin stores both kinds of answer in one field. Almost everything on
 * this server comes back as `2026-11-26T00:00:00Z` — midnight UTC, which is a
 * *date* written in an instant's clothing — and a few carry a real time, like
 * `2026-11-27T08:00:00Z`. Handed to `new Date()` and read in local time, the
 * first kind lands on the previous day for every viewer west of Greenwich. A
 * calendar that is a day out everywhere in the Americas is worse than no
 * calendar, so the distinction is the first thing this module makes.
 *
 * Offsets are passed in rather than read from the environment: these tests
 * would otherwise pass in CI (UTC) and fail on the machine of anyone who
 * actually has the bug.
 */
const NY = -300 // UTC-5
const LA = -480 // UTC-8
const HAWAII = -600 // UTC-10
const BERLIN = 60 // UTC+1

describe('isDateOnly', () => {
  it('knows a date wearing the clothes of an instant', () => {
    expect(isDateOnly('2026-11-26T00:00:00.0000000Z')).toBe(true)
    expect(isDateOnly('2026-11-26T00:00:00Z')).toBe(true)
  })

  it('leaves a real air time alone', () => {
    expect(isDateOnly('2026-11-27T08:00:00.0000000Z')).toBe(false)
  })
})

describe('airDayKey', () => {
  it('keeps a date-only premiere on its own date, west of Greenwich', () => {
    /*
      The whole point. Midnight UTC on the 26th is the 25th at 7pm in New
      York, so the obvious implementation files tomorrow's episode under
      yesterday.
    */
    for (const tz of [NY, LA, HAWAII, BERLIN]) {
      expect(airDayKey('2026-11-26T00:00:00.0000000Z', tz)).toBe('2026-11-26')
    }
  })

  it('converts a premiere that carries a real time', () => {
    // 08:00 UTC: still the 27th in New York and Los Angeles, the evening of
    // the 26th in Hawaii.
    expect(airDayKey('2026-11-27T08:00:00.0000000Z', NY)).toBe('2026-11-27')
    expect(airDayKey('2026-11-27T08:00:00.0000000Z', LA)).toBe('2026-11-27')
    expect(airDayKey('2026-11-27T08:00:00.0000000Z', HAWAII)).toBe('2026-11-26')
    expect(airDayKey('2026-11-27T08:00:00.0000000Z', BERLIN)).toBe('2026-11-27')
  })

  it('has nothing to say about a missing or unreadable date', () => {
    expect(airDayKey(null, NY)).toBeNull()
    expect(airDayKey('', NY)).toBeNull()
    expect(airDayKey('next tuesday', NY)).toBeNull()
  })
})

describe('dayLabel', () => {
  it('names the days people actually think in', () => {
    expect(dayLabel('2026-11-26', '2026-11-26')).toBe('Today')
    expect(dayLabel('2026-11-27', '2026-11-26')).toBe('Tomorrow')
  })

  it('writes the rest out, weekday first', () => {
    // Built from fixed names rather than `toLocaleDateString`, so the label
    // is the same for every viewer and the test means something.
    expect(dayLabel('2026-11-28', '2026-11-26')).toBe('Sat 28 Nov')
    expect(dayLabel('2026-12-01', '2026-11-26')).toBe('Tue 1 Dec')
  })

  it('does not call yesterday "Tomorrow"', () => {
    expect(dayLabel('2026-11-25', '2026-11-26')).toBe('Wed 25 Nov')
  })
})

describe('dayKeyOf', () => {
  it('reads the clock where the viewer is, not where the server is', () => {
    // 2026-11-26T02:00Z is still the 25th in New York.
    const at = Date.UTC(2026, 10, 26, 2, 0, 0)
    expect(dayKeyOf(at, NY)).toBe('2026-11-25')
    expect(dayKeyOf(at, BERLIN)).toBe('2026-11-26')
  })
})

const ep = (over: Partial<ScheduleItem>): ScheduleItem => ({
  Id: Math.random().toString(36).slice(2),
  SeriesName: 'A Show',
  IndexNumber: 1,
  ParentIndexNumber: 1,
  PremiereDate: '2026-11-26T00:00:00.0000000Z',
  ...over,
})

describe('groupByDay', () => {
  it('gathers each day in order, soonest first', () => {
    const groups = groupByDay(
      [
        ep({ PremiereDate: '2026-11-28T00:00:00.0000000Z', SeriesName: 'Later' }),
        ep({ PremiereDate: '2026-11-26T00:00:00.0000000Z', SeriesName: 'Today' }),
        ep({ PremiereDate: '2026-11-26T00:00:00.0000000Z', SeriesName: 'Also today' }),
      ],
      NY,
      '2026-11-26',
    )
    expect(groups.map((g) => g.key)).toEqual(['2026-11-26', '2026-11-28'])
    expect(groups[0].items).toHaveLength(2)
    expect(groups[0].label).toBe('Today')
    expect(groups[1].label).toBe('Sat 28 Nov')
  })

  it('drops what it cannot place rather than inventing a day for it', () => {
    const groups = groupByDay([ep({ PremiereDate: null })], NY, '2026-11-26')
    expect(groups).toEqual([])
  })

  it('leaves out days that have already gone', () => {
    // `/Shows/Upcoming` is generous about "upcoming" around the boundary, and
    // a calendar whose first heading is last Tuesday reads as broken.
    const groups = groupByDay(
      [
        ep({ PremiereDate: '2026-11-24T00:00:00.0000000Z' }),
        ep({ PremiereDate: '2026-11-26T00:00:00.0000000Z' }),
      ],
      NY,
      '2026-11-26',
    )
    expect(groups.map((g) => g.key)).toEqual(['2026-11-26'])
  })

  it('sorts within a day by series, so the same show does not scatter', () => {
    const groups = groupByDay(
      [
        ep({ SeriesName: 'Zeta', IndexNumber: 2 }),
        ep({ SeriesName: 'Alpha', IndexNumber: 9 }),
        ep({ SeriesName: 'Zeta', IndexNumber: 1 }),
      ],
      NY,
      '2026-11-26',
    )
    expect(groups[0].items.map((i) => `${i.SeriesName}${i.IndexNumber}`)).toEqual([
      'Alpha9',
      'Zeta1',
      'Zeta2',
    ])
  })
})

describe('withinDays', () => {
  it('keeps the next week and no more', () => {
    const groups = groupByDay(
      [
        ep({ PremiereDate: '2026-11-26T00:00:00.0000000Z' }),
        ep({ PremiereDate: '2026-12-02T00:00:00.0000000Z' }),
        ep({ PremiereDate: '2026-12-10T00:00:00.0000000Z' }),
      ],
      NY,
      '2026-11-26',
    )
    expect(withinDays(groups, 7, '2026-11-26').map((g) => g.key)).toEqual([
      '2026-11-26',
      '2026-12-02',
    ])
  })
})

describe('airStatus', () => {
  it('separates what is on the server from what is not here yet', () => {
    // The distinction the whole page exists for. Jellyfin marks an episode it
    // knows about but does not hold as Virtual.
    expect(airStatus(ep({ LocationType: 'Virtual' }))).toBe('missing')
    expect(airStatus(ep({ LocationType: 'FileSystem' }))).toBe('have')
  })

  it('falls back to whether there is anything to play', () => {
    // Older servers leave LocationType off. A runtime is the next best
    // evidence that a file exists.
    expect(airStatus(ep({ LocationType: undefined, RunTimeTicks: 0 }))).toBe('missing')
    expect(airStatus(ep({ LocationType: undefined, RunTimeTicks: 12_000_000_000 }))).toBe('have')
  })
})

/**
 * The month grid.
 *
 * A calendar is the shape people asked for, and a grid has one hard part:
 * the days around the edges. A month that starts on a Wednesday needs the
 * tail of the previous month to fill the first row, or the 1st lands under
 * "Sunday" and every date after it is wrong.
 */
describe('monthGrid', () => {
  it('lays out whole weeks, Sunday first', () => {
    const weeks = monthGrid('2026-11')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
    // 1 November 2026 is a Sunday, so the month starts flush.
    expect(weeks[0][0]).toBe('2026-11-01')
  })

  it('fills the first row from the month before', () => {
    // 1 December 2026 is a Tuesday: Sunday and Monday belong to November.
    const weeks = monthGrid('2026-12')
    expect(weeks[0].slice(0, 3)).toEqual(['2026-11-29', '2026-11-30', '2026-12-01'])
  })

  it('runs to the end of the month and no further than the week holding it', () => {
    const weeks = monthGrid('2026-11')
    const flat = weeks.flat()
    expect(flat).toContain('2026-11-30')
    // December 5th is the Saturday of the week that holds the 30th; the 6th
    // starts a week with nothing of November in it and must not be drawn.
    expect(flat).toContain('2026-12-05')
    expect(flat).not.toContain('2026-12-06')
  })

  it('handles a leap February without a short week', () => {
    const weeks = monthGrid('2028-02')
    expect(weeks.flat()).toContain('2028-02-29')
    expect(weeks.every((w) => w.length === 7)).toBe(true)
  })
})

describe('month helpers', () => {
  it('names a month the way a heading would', () => {
    expect(monthLabel('2026-11')).toBe('November 2026')
    expect(monthLabel('2027-01')).toBe('January 2027')
  })

  it('steps across the turn of the year in both directions', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
    expect(addMonths('2026-11', 2)).toBe('2027-01')
  })

  it('takes the month out of a day', () => {
    expect(monthKeyOf('2026-11-26')).toBe('2026-11')
  })
})
