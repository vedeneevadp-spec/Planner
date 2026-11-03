import {
  addDateDays,
  addDateMonthsClamped,
  getDateDayOfMonth,
  getDateDistance,
  getIsoWeekday,
  getIsoWeekStartDate,
} from '@/shared/time/time.service'

import { isActiveTaskStatus } from './planner'
import type { Task } from './task.types'

export interface CalendarGhostTask extends Task {
  isRecurringGhost: true
  sourceTaskId: string
}

export function buildRecurringGhostTasks(
  tasks: Task[],
  rangeStartDateKey: string,
  rangeEndDateKey: string,
  todayDateKey: string,
): CalendarGhostTask[] {
  const existingDatesBySeries = new Set<string>()
  const sourceBySeries = new Map<string, Task>()

  for (const task of tasks) {
    const recurrence = task.recurrence

    if (!recurrence?.isActive) {
      continue
    }

    if (task.plannedDate) {
      existingDatesBySeries.add(`${recurrence.seriesId}:${task.plannedDate}`)
    }

    if (!isActiveTaskStatus(task.status)) {
      continue
    }

    const currentSource = sourceBySeries.get(recurrence.seriesId)

    if (!currentSource || compareRecurringSource(task, currentSource) > 0) {
      sourceBySeries.set(recurrence.seriesId, task)
    }
  }

  return [...sourceBySeries.values()].flatMap((task) => {
    const recurrence = task.recurrence

    if (!recurrence?.isActive) {
      return []
    }

    return listRecurringDateKeys(
      recurrence,
      rangeStartDateKey,
      rangeEndDateKey,
    ).flatMap((dateKey) => {
      if (
        dateKey <= todayDateKey ||
        existingDatesBySeries.has(`${recurrence.seriesId}:${dateKey}`)
      ) {
        return []
      }

      return [
        {
          ...task,
          completedAt: null,
          dueDate: task.dueDate === task.plannedDate ? dateKey : null,
          id: `${task.id}:recurring:${dateKey}`,
          isRecurringGhost: true,
          plannedDate: dateKey,
          sourceTaskId: task.id,
          status: 'todo',
        } satisfies CalendarGhostTask,
      ]
    })
  })
}

function compareRecurringSource(left: Task, right: Task): number {
  const leftKey = `${left.plannedDate ?? left.createdAt.slice(0, 10)}:${left.createdAt}:${left.id}`
  const rightKey = `${right.plannedDate ?? right.createdAt.slice(0, 10)}:${right.createdAt}:${right.id}`

  return leftKey.localeCompare(rightKey)
}

function listRecurringDateKeys(
  recurrence: NonNullable<Task['recurrence']>,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): string[] {
  const effectiveStartDateKey = maxDateKey(
    recurrence.startDate,
    rangeStartDateKey,
  )
  const effectiveEndDateKey = recurrence.endDate
    ? minDateKey(recurrence.endDate, rangeEndDateKey)
    : rangeEndDateKey

  if (effectiveStartDateKey > effectiveEndDateKey) {
    return []
  }

  if (recurrence.frequency === 'daily') {
    return listDailyRecurringDateKeys(
      recurrence.startDate,
      recurrence.interval,
      effectiveStartDateKey,
      effectiveEndDateKey,
    )
  }

  if (recurrence.frequency === 'monthly') {
    return listMonthlyRecurringDateKeys(
      recurrence.startDate,
      recurrence.interval,
      effectiveStartDateKey,
      effectiveEndDateKey,
    )
  }

  return listWeeklyRecurringDateKeys(
    recurrence,
    effectiveStartDateKey,
    effectiveEndDateKey,
  )
}

function listDailyRecurringDateKeys(
  startDateKey: string,
  interval: number,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): string[] {
  const startOffset = Math.max(
    0,
    Math.ceil(getDateDistance(startDateKey, rangeStartDateKey) / interval),
  )
  let cursor = addDateKeyDays(startDateKey, startOffset * interval)
  const dateKeys: string[] = []

  while (cursor <= rangeEndDateKey) {
    dateKeys.push(cursor)
    cursor = addDateKeyDays(cursor, interval)
  }

  return dateKeys
}

function listMonthlyRecurringDateKeys(
  startDateKey: string,
  interval: number,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): string[] {
  const targetDay = getDateDayOfMonth(startDateKey)
  const dateKeys: string[] = []

  for (let offset = 0; offset <= 600; offset += interval) {
    const dateKey = addDateKeyMonthsClamped(startDateKey, offset, targetDay)

    if (dateKey > rangeEndDateKey) {
      break
    }

    if (dateKey >= rangeStartDateKey) {
      dateKeys.push(dateKey)
    }
  }

  return dateKeys
}

function listWeeklyRecurringDateKeys(
  recurrence: NonNullable<Task['recurrence']>,
  rangeStartDateKey: string,
  rangeEndDateKey: string,
): string[] {
  const scheduledDays = new Set(recurrence.daysOfWeek)
  const dateKeys: string[] = []
  let cursor = rangeStartDateKey
  const startWeek = getWeekStartDate(recurrence.startDate)

  while (cursor <= rangeEndDateKey) {
    if (
      scheduledDays.has(getIsoWeekday(cursor)) &&
      getWeekDistance(startWeek, cursor) % recurrence.interval === 0
    ) {
      dateKeys.push(cursor)
    }

    cursor = addDateKeyDays(cursor, 1)
  }

  return dateKeys
}

function addDateKeyDays(dateKey: string, amount: number): string {
  return addDateDays(dateKey, amount)
}

function addDateKeyMonthsClamped(
  dateKey: string,
  monthOffset: number,
  targetDay: number,
): string {
  return addDateMonthsClamped(dateKey, monthOffset, targetDay)
}

function getWeekStartDate(dateKey: string): string {
  return getIsoWeekStartDate(dateKey)
}

function getWeekDistance(startWeek: string, dateKey: string): number {
  return Math.floor(
    getDateDistance(startWeek, getIsoWeekStartDate(dateKey)) / 7,
  )
}

function maxDateKey(left: string, right: string): string {
  return left > right ? left : right
}

function minDateKey(left: string, right: string): string {
  return left < right ? left : right
}
