import { describe, expect, it, vi } from 'vitest'

import {
  addDays,
  formatTimeRange,
  formatTimeZoneOffsetLabel,
  getDateKey,
  isBeforeDate,
} from './date'

describe('date helpers', () => {
  it('creates a stable date key', () => {
    expect(getDateKey(new Date(Date.UTC(2026, 3, 15)))).toBe('2026-04-15')
  })

  it('adds calendar days without mutating the source instance', () => {
    const start = new Date(Date.UTC(2026, 3, 30))
    const next = addDays(start, 1)

    expect(getDateKey(start)).toBe('2026-04-30')
    expect(getDateKey(next)).toBe('2026-05-01')
  })

  it('compares date keys lexicographically', () => {
    expect(isBeforeDate('2026-04-14', '2026-04-15')).toBe(true)
    expect(isBeforeDate('2026-04-15', '2026-04-15')).toBe(false)
  })

  it('formats timeline ranges', () => {
    expect(formatTimeRange('9:00', null)).toBe('09:00')
    expect(formatTimeRange('09:00', '10:30')).toBe('09:00 - 10:30')
  })

  it('formats the device timezone offset label', () => {
    const date = new Date('2026-01-01T00:00:00.000Z')

    vi.spyOn(date, 'getTimezoneOffset').mockReturnValue(-330)

    expect(formatTimeZoneOffsetLabel(date)).toBe('GMT+5:30')
  })

  it.each([
    ['Asia/Novosibirsk', '2026-01-01T00:00:00Z', 'GMT+7'],
    ['Asia/Kathmandu', '2026-01-01T00:00:00Z', 'GMT+5:45'],
    ['America/New_York', '2026-01-01T00:00:00Z', 'GMT-5'],
    ['America/New_York', '2026-07-01T00:00:00Z', 'GMT-4'],
    ['UTC', '2026-01-01T00:00:00Z', 'GMT+0'],
  ])(
    'formats %s independently of the device offset',
    (timeZone, instant, expected) => {
      const date = new Date(instant)
      vi.spyOn(date, 'getTimezoneOffset').mockReturnValue(0)

      expect(formatTimeZoneOffsetLabel(date, timeZone)).toBe(expected)
    },
  )
})
