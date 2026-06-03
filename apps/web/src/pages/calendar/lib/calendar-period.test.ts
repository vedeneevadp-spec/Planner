import { describe, expect, it } from 'vitest'

import { shiftCalendarPeriod } from './calendar-period'

describe('shiftCalendarPeriod', () => {
  it('shifts day view by one day', () => {
    expect(shiftCalendarPeriod('2026-06-12', 'day', 'next')).toBe('2026-06-13')
    expect(shiftCalendarPeriod('2026-06-12', 'day', 'prev')).toBe('2026-06-11')
  })

  it('shifts week view by seven days', () => {
    expect(shiftCalendarPeriod('2026-06-12', 'week', 'next')).toBe('2026-06-19')
    expect(shiftCalendarPeriod('2026-06-12', 'week', 'prev')).toBe('2026-06-05')
  })

  it('shifts month view to adjacent month anchors', () => {
    expect(shiftCalendarPeriod('2026-06-12', 'month', 'next')).toBe(
      '2026-07-01',
    )
    expect(shiftCalendarPeriod('2026-06-12', 'month', 'prev')).toBe(
      '2026-05-01',
    )
  })

  it('handles year and leap-day boundaries', () => {
    expect(shiftCalendarPeriod('2026-12-31', 'day', 'next')).toBe('2027-01-01')
    expect(shiftCalendarPeriod('2027-01-03', 'week', 'prev')).toBe('2026-12-27')
    expect(shiftCalendarPeriod('2024-02-29', 'day', 'next')).toBe('2024-03-01')
    expect(shiftCalendarPeriod('2024-02-29', 'month', 'next')).toBe(
      '2024-03-01',
    )
  })
})
