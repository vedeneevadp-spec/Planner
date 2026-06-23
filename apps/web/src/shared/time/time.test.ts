import { describe, expect, it, vi } from 'vitest'

import { parseRussianSchedulePhrase } from './time.parse'
import {
  addDateDays,
  addDateMonthsClamped,
  enumerateDateRange,
  formatForUser,
  getDateDistance,
  getDateKeyInTimeZone,
  getDayRangeUtc,
  getIsoWeekStartDate,
  getPlannerTimeZone,
  getTimeInTimeZone,
  getTodayDate,
  makeFixedZoneDateTime,
  serializeDateOnly,
} from './time.service'

describe('TimeService', () => {
  it('keeps date-only values as calendar dates across timezone changes', () => {
    const value = { kind: 'date_only' as const, localDate: '2026-06-25' }

    expect(
      formatForUser({
        displayTimeZone: 'Europe/Astrakhan',
        locale: 'ru-RU',
        value,
      }),
    ).toContain('25')
    expect(value.localDate).toBe('2026-06-25')
  })

  it('preserves fixed-zone task source timezone and instant', () => {
    const value = makeFixedZoneDateTime({
      localDate: '2026-06-25',
      localTime: '18:00',
      timeZone: 'Europe/Astrakhan',
    })

    expect(value).toEqual({
      instantUtc: '2026-06-25T14:00:00.000Z',
      kind: 'fixed_zone_datetime',
      localDate: '2026-06-25',
      localTime: '18:00',
      timeZone: 'Europe/Astrakhan',
    })
    expect(
      formatForUser({
        displayTimeZone: 'Europe/Amsterdam',
        locale: 'ru-RU',
        value,
      }),
    ).toContain('Europe/Astrakhan')
  })

  it('keeps floating local time at the same wall-clock time after planner-zone change', () => {
    const value = {
      kind: 'floating_local_time' as const,
      localTime: '08:00',
      recurrenceRule: 'FREQ=DAILY',
    }

    expect(
      formatForUser({
        displayTimeZone: 'Europe/Astrakhan',
        value,
      }),
    ).toBe('08:00, FREQ=DAILY')
    expect(
      formatForUser({
        displayTimeZone: 'Europe/Amsterdam',
        value,
      }),
    ).toBe('08:00, FREQ=DAILY')
  })

  it('calculates today in planner timezone instead of UTC', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-23T22:30:00.000Z'))

    expect(getTodayDate('Europe/Astrakhan')).toBe('2026-06-24')
    expect(getTodayDate('UTC')).toBe('2026-06-23')

    vi.useRealTimers()
  })

  it('builds day boundaries in the requested timezone', () => {
    expect(
      getDayRangeUtc({
        localDate: '2026-06-25',
        timeZone: 'Europe/Astrakhan',
      }),
    ).toEqual({
      endUtc: '2026-06-25T20:00:00.000Z',
      startUtc: '2026-06-24T20:00:00.000Z',
    })
  })

  it('parses voice "tomorrow at 9" relative to planner timezone', () => {
    const parsed = parseRussianSchedulePhrase('завтра в 9', {
      locale: 'ru-RU',
      plannerTimeZone: 'Europe/Astrakhan',
      referenceInstantUtc: '2026-06-23T08:00:00.000Z',
    })

    expect(parsed?.kind).toBe('fixed_zone_datetime')
    expect(parsed?.schedule).toMatchObject({
      localDate: '2026-06-24',
      localTime: '09:00',
      timeZone: 'Europe/Astrakhan',
    })
  })

  it('parses voice daily floating recurrence', () => {
    const parsed = parseRussianSchedulePhrase('каждый день в 8', {
      locale: 'ru-RU',
      plannerTimeZone: 'Europe/Astrakhan',
      referenceInstantUtc: '2026-06-23T08:00:00.000Z',
    })

    expect(parsed).toEqual({
      kind: 'floating_local_time',
      schedule: {
        kind: 'floating_local_time',
        localTime: '08:00',
        recurrenceRule: 'FREQ=DAILY',
      },
      timeZone: 'Europe/Astrakhan',
    })
  })

  it('moves nonexistent DST local time to nearest valid time after transition', () => {
    const value = makeFixedZoneDateTime({
      localDate: '2026-03-29',
      localTime: '02:30',
      timeZone: 'Europe/Amsterdam',
    })

    expect(value.instantUtc).toBe('2026-03-29T01:00:00.000Z')
    expect(getDateKeyInTimeZone(value.instantUtc, 'Europe/Amsterdam')).toBe(
      '2026-03-29',
    )
    expect(getTimeInTimeZone(value.instantUtc, 'Europe/Amsterdam')).toBe(
      '03:00',
    )
  })

  it('chooses the first occurrence for ambiguous DST local time', () => {
    const value = makeFixedZoneDateTime({
      localDate: '2026-10-25',
      localTime: '02:30',
      timeZone: 'Europe/Amsterdam',
    })

    expect(value.instantUtc).toBe('2026-10-25T00:30:00.000Z')
    expect(getDateKeyInTimeZone(value.instantUtc, 'Europe/Amsterdam')).toBe(
      '2026-10-25',
    )
    expect(getTimeInTimeZone(value.instantUtc, 'Europe/Amsterdam')).toBe(
      '02:30',
    )
  })

  it('converts ordinary Amsterdam local datetime to the known UTC instant', () => {
    const value = makeFixedZoneDateTime({
      localDate: '2026-06-25',
      localTime: '18:00',
      timeZone: 'Europe/Amsterdam',
    })

    expect(value.instantUtc).toBe('2026-06-25T16:00:00.000Z')
    expect(getDateKeyInTimeZone(value.instantUtc, 'Europe/Amsterdam')).toBe(
      '2026-06-25',
    )
    expect(getTimeInTimeZone(value.instantUtc, 'Europe/Amsterdam')).toBe(
      '18:00',
    )
  })

  it('resolves planner timezone according to user mode', () => {
    expect(
      getPlannerTimeZone({
        deviceTimeZone: 'Europe/Amsterdam',
        timeZoneMode: 'manual',
        userTimeZone: 'Europe/Astrakhan',
        workspaceTimeZone: 'UTC',
      }),
    ).toBe('Europe/Astrakhan')
    expect(addDateDays('2026-06-25', 1)).toBe('2026-06-26')
  })

  it('performs date-only arithmetic without timezone-dependent Date rollover', () => {
    expect(addDateDays('2026-02-28', 1)).toBe('2026-03-01')
    expect(addDateDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDateMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(getIsoWeekStartDate('2026-06-25')).toBe('2026-06-22')
    expect(getDateDistance('2026-06-22', '2026-06-29')).toBe(7)
    expect(enumerateDateRange('2026-06-29', '2026-07-02')).toEqual([
      '2026-06-29',
      '2026-06-30',
      '2026-07-01',
      '2026-07-02',
    ])
  })

  it('serializes PostgreSQL date objects as date-only values without local timezone shift', () => {
    expect(serializeDateOnly(new Date('2026-06-25T00:00:00.000Z'))).toBe(
      '2026-06-25',
    )
    expect(serializeDateOnly('2026-06-25')).toBe('2026-06-25')
    expect(serializeDateOnly(null)).toBeNull()
  })
})
