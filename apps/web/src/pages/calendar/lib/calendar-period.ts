import type { CalendarViewMode } from '@planner/contracts'

import { addDateDays } from '@/shared/time/time.service'

import { shiftCalendarMonth } from './calendar-load'

export const SCHEDULE_PERIOD_DAYS = 14

export type CalendarPeriodDirection = 'next' | 'prev'

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
    return addDateDays(dateKey, amount * SCHEDULE_PERIOD_DAYS)
  }

  if (viewMode === 'day') {
    return addDateDays(dateKey, amount)
  }

  return addDateDays(dateKey, amount * 7)
}
