import { generateUuidV7, type HabitStats } from '@planner/contracts'

import type {
  StoredHabitEntryRecord,
  StoredHabitRecord,
} from './habit.model.js'

const ISO_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]

export function createStoredHabitRecord(
  input: {
    color: string
    daysOfWeek: number[]
    description: string
    endDate: string | null
    frequency: StoredHabitRecord['frequency']
    icon: string
    id?: string | undefined
    reminderTime: string | null
    sortOrder?: number | undefined
    sphereId: string | null
    startDate?: string | undefined
    targetType: StoredHabitRecord['targetType']
    targetValue: number
    title: string
    unit: string
  },
  context: {
    actorUserId: string
    sortOrder: number
    workspaceId: string
  },
): StoredHabitRecord {
  const now = new Date().toISOString()
  const startDate = input.startDate ?? getDateKey(new Date())

  return {
    color: input.color,
    createdAt: now,
    daysOfWeek: normalizeDaysOfWeek(input.daysOfWeek),
    deletedAt: null,
    description: input.description,
    endDate: input.endDate,
    frequency: input.frequency,
    icon: input.icon,
    id: input.id ?? generateUuidV7(),
    isActive: true,
    reminderTime: input.reminderTime,
    sortOrder: input.sortOrder ?? context.sortOrder,
    sphereId: input.sphereId,
    startDate,
    targetType: input.targetType,
    targetValue: input.targetValue,
    title: input.title,
    unit: input.unit,
    updatedAt: now,
    userId: context.actorUserId,
    version: 1,
    workspaceId: context.workspaceId,
  }
}

export function createStoredHabitEntryRecord(
  input: {
    date: string
    habit: StoredHabitRecord
    id?: string | undefined
    note: string
    status: StoredHabitEntryRecord['status']
    value: number
  },
  context: {
    actorUserId: string
    workspaceId: string
  },
): StoredHabitEntryRecord {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    date: input.date,
    deletedAt: null,
    habitId: input.habit.id,
    id: input.id ?? generateUuidV7(),
    note: input.note,
    status: input.status,
    updatedAt: now,
    userId: context.actorUserId,
    value: input.value,
    version: 1,
    workspaceId: context.workspaceId,
  }
}

export function sortStoredHabits(
  habits: StoredHabitRecord[],
): StoredHabitRecord[] {
  return [...habits].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }

    return left.title.localeCompare(right.title, 'ru')
  })
}

export function normalizeDaysOfWeek(daysOfWeek: number[]): number[] {
  const normalized = [...new Set(daysOfWeek)].filter((day) =>
    ISO_WEEKDAYS.includes(day),
  )

  return normalized.length > 0
    ? normalized.sort((left, right) => left - right)
    : [...ISO_WEEKDAYS]
}

export function isHabitScheduledOnDate(
  habit: Pick<
    StoredHabitRecord,
    'daysOfWeek' | 'endDate' | 'isActive' | 'startDate'
  >,
  dateKey: string,
): boolean {
  if (!habit.isActive || dateKey < habit.startDate) {
    return false
  }

  if (habit.endDate && dateKey > habit.endDate) {
    return false
  }

  return habit.daysOfWeek.includes(getIsoWeekday(dateKey))
}

export function buildHabitStats(
  habit: StoredHabitRecord,
  entries: StoredHabitEntryRecord[],
  range: {
    from: string
    to: string
  },
): HabitStats {
  const entriesByDate = new Map(
    entries
      .filter((entry) => entry.deletedAt === null)
      .map((entry) => [entry.date, entry]),
  )
  const scheduledDates = enumerateDates(habit.startDate, range.to).filter(
    (dateKey) => isHabitScheduledOnDate(habit, dateKey),
  )
  const rangeDates = scheduledDates.filter(
    (dateKey) => dateKey >= range.from && dateKey <= range.to,
  )
  const weekStart = getWeekStart(range.to)
  const monthStart = `${range.to.slice(0, 7)}-01`
  let completedCount = 0
  let skippedCount = 0
  let missedCount = 0
  let weekCompleted = 0
  let weekScheduled = 0
  let monthCompleted = 0
  let monthScheduled = 0
  let lastCompletedDate: string | null = null

  for (const dateKey of rangeDates) {
    const entry = entriesByDate.get(dateKey)

    if (isEntryComplete(habit, entry)) {
      completedCount += 1
      lastCompletedDate = dateKey
    } else if (entry?.status === 'skipped') {
      skippedCount += 1
    } else if (dateKey < range.to) {
      missedCount += 1
    }
  }

  for (const dateKey of scheduledDates) {
    const entry = entriesByDate.get(dateKey)

    if (dateKey >= weekStart && dateKey <= range.to) {
      weekScheduled += 1

      if (isEntryComplete(habit, entry)) {
        weekCompleted += 1
      }
    }

    if (dateKey >= monthStart && dateKey <= range.to) {
      monthScheduled += 1

      if (isEntryComplete(habit, entry)) {
        monthCompleted += 1
      }
    }
  }

  const scheduledCount = rangeDates.length

  return {
    bestStreak: calculateBestStreak(habit, scheduledDates, entriesByDate),
    completionRate:
      scheduledCount === 0
        ? 0
        : Math.round((completedCount / scheduledCount) * 100),
    completedCount,
    currentStreak: calculateCurrentStreak(
      habit,
      scheduledDates,
      entriesByDate,
      range.to,
    ),
    habitId: habit.id,
    lastCompletedDate,
    missedCount,
    monthCompleted,
    monthScheduled,
    scheduledCount,
    skippedCount,
    weekCompleted,
    weekScheduled,
  }
}

export function getEntryProgressPercent(
  habit: Pick<StoredHabitRecord, 'targetValue'>,
  entry: StoredHabitEntryRecord | null,
): number {
  if (!entry || entry.status !== 'done') {
    return 0
  }

  return Math.min(100, Math.round((entry.value / habit.targetValue) * 100))
}

export function getDefaultEntryValue(
  habit: Pick<StoredHabitRecord, 'targetType' | 'targetValue'>,
  value: number | undefined,
): number {
  if (value !== undefined) {
    return value
  }

  return habit.targetType === 'check' ? habit.targetValue : 0
}

export function getDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function serializeDate(value: unknown): string {
  if (value instanceof Date) {
    return getDateKey(value)
  }

  return String(value)
}

export function serializeNullableDate(value: unknown): string | null {
  return value === null || value === undefined ? null : serializeDate(value)
}

export function serializeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString()
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint'
  ) {
    return String(value)
  }

  throw new Error('Unsupported timestamp value.')
}

export function serializeNullableTimestamp(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : serializeTimestamp(value)
}

export function serializeNullableTime(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string') {
    return value.slice(0, 5)
  }

  if (value instanceof Date) {
    return value.toISOString().slice(11, 16)
  }

  throw new Error('Unsupported time value.')
}

function calculateCurrentStreak(
  habit: Pick<StoredHabitRecord, 'targetValue'>,
  scheduledDates: string[],
  entriesByDate: Map<string, StoredHabitEntryRecord>,
  referenceDate: string,
): number {
  let streak = 0
  let isFirstScheduledDate = true

  for (const dateKey of [...scheduledDates].reverse()) {
    if (dateKey > referenceDate) {
      continue
    }

    const entry = entriesByDate.get(dateKey)

    if (isEntryComplete(habit, entry)) {
      streak += 1
      isFirstScheduledDate = false
      continue
    }

    if (entry?.status === 'skipped') {
      isFirstScheduledDate = false
      continue
    }

    if (isFirstScheduledDate && dateKey === referenceDate) {
      isFirstScheduledDate = false
      continue
    }

    break
  }

  return streak
}

function calculateBestStreak(
  habit: Pick<StoredHabitRecord, 'targetValue'>,
  scheduledDates: string[],
  entriesByDate: Map<string, StoredHabitEntryRecord>,
): number {
  let bestStreak = 0
  let currentStreak = 0

  for (const dateKey of scheduledDates) {
    const entry = entriesByDate.get(dateKey)

    if (isEntryComplete(habit, entry)) {
      currentStreak += 1
      bestStreak = Math.max(bestStreak, currentStreak)
      continue
    }

    if (entry?.status === 'skipped') {
      continue
    }

    currentStreak = 0
  }

  return bestStreak
}

function isEntryComplete(
  habit: Pick<StoredHabitRecord, 'targetValue'>,
  entry: StoredHabitEntryRecord | undefined,
): boolean {
  return entry?.status === 'done' && entry.value >= habit.targetValue
}

function enumerateDates(from: string, to: string): string[] {
  const dates: string[] = []
  const cursor = parseDateKey(from)
  const end = parseDateKey(to)

  while (cursor <= end) {
    dates.push(getDateKey(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return dates
}

function getIsoWeekday(dateKey: string): number {
  const day = parseDateKey(dateKey).getUTCDay()

  return day === 0 ? 7 : day
}

function getWeekStart(dateKey: string): string {
  const date = parseDateKey(dateKey)
  const isoWeekday = getIsoWeekday(dateKey)
  date.setUTCDate(date.getUTCDate() - isoWeekday + 1)

  return getDateKey(date)
}

function parseDateKey(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`)
}
