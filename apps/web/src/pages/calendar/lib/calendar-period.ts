import type { CalendarViewMode } from '@planner/contracts'

import { addDays, getDateKey } from '@/shared/lib/date'

import { shiftCalendarMonth } from './calendar-load'

export const SCHEDULE_PERIOD_DAYS = 14

export type CalendarPeriodDirection = 'next' | 'prev'

function parseDateKey(value: string): Date {
  const [yearRaw, monthRaw, dayRaw] = value.split('-')
  const year = Number(yearRaw)
  const month = Number(monthRaw)
  const day = Number(dayRaw)

  return new Date(year, month - 1, day, 12)
}

export function shiftCalendarPeriod(
  dateKey: string,
  viewMode: CalendarViewMode,
  direction: CalendarPeriodDirection,
): string {
  const amount = direction === 'next' ? 1 : -1

  if (viewMode === 'month') {
    return shiftCalendarMonth(dateKey, amount)
  }

  if (viewMode === 'schedule') {
    return getDateKey(
      addDays(parseDateKey(dateKey), amount * SCHEDULE_PERIOD_DAYS),
    )
  }

  if (viewMode === 'day') {
    return getDateKey(addDays(parseDateKey(dateKey), amount))
  }

  return getDateKey(addDays(parseDateKey(dateKey), amount * 7))
}
