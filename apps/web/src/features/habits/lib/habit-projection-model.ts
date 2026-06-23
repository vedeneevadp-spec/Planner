import {
  generateUuidV7,
  type HabitEntryRecord,
  type HabitEntryUpsertInput,
  type HabitRecord,
  type HabitStats,
  type HabitStatsResponse,
  type HabitTodayItem,
  type HabitTodayResponse,
  type HabitUpdateInput,
  type NewHabitInput,
} from '@planner/contracts'

import {
  getIsoWeekday as getIsoWeekdayForDateOnly,
  getTodayDate,
} from '@/shared/time/time.service'

export function createOptimisticHabit(
  input: NewHabitInput,
  context: {
    actorUserId: string
    plannerTimeZone: string
    sortOrder: number
    workspaceId: string
  },
): HabitRecord {
  const now = new Date().toISOString()

  return {
    color: input.color,
    createdAt: now,
    daysOfWeek: input.daysOfWeek,
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
    startDate: input.startDate ?? getTodayDate(context.plannerTimeZone),
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

export function applyHabitUpdate(
  habit: HabitRecord,
  input: HabitUpdateInput,
): HabitRecord {
  const now = new Date().toISOString()

  return {
    ...habit,
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.daysOfWeek !== undefined ? { daysOfWeek: input.daysOfWeek } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.endDate !== undefined ? { endDate: input.endDate } : {}),
    ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    ...(input.reminderTime !== undefined
      ? { reminderTime: input.reminderTime }
      : {}),
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    ...(input.sphereId !== undefined ? { sphereId: input.sphereId } : {}),
    ...(input.startDate !== undefined ? { startDate: input.startDate } : {}),
    ...(input.targetType !== undefined ? { targetType: input.targetType } : {}),
    ...(input.targetValue !== undefined
      ? { targetValue: input.targetValue }
      : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.unit !== undefined ? { unit: input.unit } : {}),
    updatedAt: now,
    version: habit.version + 1,
  }
}

export function createOptimisticHabitEntry(input: {
  actorUserId: string
  date: string
  habit: HabitRecord
  input: HabitEntryUpsertInput
  previousEntry: HabitEntryRecord | null
  workspaceId: string
}): HabitEntryRecord {
  const now = new Date().toISOString()
  const status = input.input.status ?? 'done'

  return {
    createdAt: input.previousEntry?.createdAt ?? now,
    date: input.date,
    deletedAt: null,
    habitId: input.habit.id,
    id:
      input.previousEntry?.id ??
      `optimistic-habit-entry-${input.habit.id}-${input.date}`,
    note: input.input.note ?? input.previousEntry?.note ?? '',
    status,
    targetValue: input.habit.targetValue,
    updatedAt: now,
    userId: input.actorUserId,
    value:
      input.input.value ??
      (status === 'skipped' ? 0 : getDefaultHabitEntryValue(input.habit)),
    version: (input.previousEntry?.version ?? 0) + 1,
    workspaceId: input.workspaceId,
  }
}

export function createFallbackTodayResponse(
  date: string,
  habits: HabitRecord[],
): HabitTodayResponse {
  return {
    date,
    items: sortHabitRecords(habits)
      .filter((habit) => isHabitScheduledOnDate(habit, date))
      .map((habit) => createHabitTodayItem({ date, entry: null, habit })),
  }
}

export function createFallbackStatsResponse(
  from: string,
  to: string,
  habits: HabitRecord[],
): HabitStatsResponse {
  const sortedHabits = sortHabitRecords(habits)

  return {
    from,
    habits: sortedHabits,
    stats: sortedHabits.map((habit) => createEmptyHabitStats(habit.id)),
    to,
  }
}

export function createHabitTodayItem(input: {
  date: string
  entry: HabitEntryRecord | null
  habit: HabitRecord
}): HabitTodayItem {
  return {
    entry: input.entry,
    habit: input.habit,
    isDueToday: true,
    progressPercent: getEntryProgressPercent(input.habit, input.entry),
    stats: createEmptyHabitStats(input.habit.id),
  }
}

export function createEmptyHabitStats(habitId: string): HabitStats {
  return {
    bestStreak: 0,
    completedCount: 0,
    completionRate: 0,
    currentStreak: 0,
    habitId,
    lastCompletedDate: null,
    missedCount: 0,
    monthCompleted: 0,
    monthScheduled: 0,
    scheduledCount: 0,
    skippedCount: 0,
    weekCompleted: 0,
    weekScheduled: 0,
  }
}

export function upsertHabitInTodayResponse(
  response: HabitTodayResponse,
  habit: HabitRecord,
): HabitTodayResponse {
  const item = response.items.find((entry) => entry.habit.id === habit.id)

  if (!isHabitScheduledOnDate(habit, response.date)) {
    return removeHabitFromTodayResponse(response, habit.id)
  }

  if (!item) {
    return {
      ...response,
      items: [
        ...response.items,
        createHabitTodayItem({
          date: response.date,
          entry: null,
          habit,
        }),
      ],
    }
  }

  return {
    ...response,
    items: response.items.map((entry) =>
      entry.habit.id === habit.id
        ? {
            ...entry,
            habit,
            progressPercent: getEntryProgressPercent(habit, entry.entry),
          }
        : entry,
    ),
  }
}

export function removeHabitFromTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.filter((item) => item.habit.id !== habitId),
  }
}

export function upsertEntryInTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
  entry: HabitEntryRecord,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.map((item) =>
      item.habit.id === habitId
        ? {
            ...item,
            entry,
            progressPercent: getEntryProgressPercent(item.habit, entry),
          }
        : item,
    ),
  }
}

export function removeEntryInTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.map((item) =>
      item.habit.id === habitId
        ? {
            ...item,
            entry: null,
            progressPercent: 0,
          }
        : item,
    ),
  }
}

export function replaceHabitRecord(
  habits: HabitRecord[],
  nextHabit: HabitRecord,
): HabitRecord[] {
  const existingIndex = habits.findIndex((habit) => habit.id === nextHabit.id)

  if (existingIndex === -1) {
    return [...habits, nextHabit]
  }

  return habits.map((habit) => (habit.id === nextHabit.id ? nextHabit : habit))
}

export function removeHabitRecord(
  habits: HabitRecord[],
  habitId: string,
): HabitRecord[] {
  return habits.filter((habit) => habit.id !== habitId)
}

export function sortHabitRecords(habits: HabitRecord[]): HabitRecord[] {
  return [...habits].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }

    return left.title.localeCompare(right.title, 'ru')
  })
}

export function getEntryProgressPercent(
  habit: Pick<HabitRecord, 'targetValue'>,
  entry: Pick<HabitEntryRecord, 'status' | 'targetValue' | 'value'> | null,
): number {
  if (!entry || entry.status === 'skipped') {
    return 0
  }

  return Math.min(
    100,
    Math.round((entry.value / getEntryTargetValue(habit, entry)) * 100),
  )
}

export function getDefaultHabitEntryValue(
  habit: Pick<HabitRecord, 'targetType' | 'targetValue'>,
): number {
  return habit.targetType === 'check' ? habit.targetValue : 0
}

export function isHabitScheduledOnDate(
  habit: HabitRecord,
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

function getEntryTargetValue(
  habit: Pick<HabitRecord, 'targetValue'>,
  entry: Pick<HabitEntryRecord, 'targetValue'>,
): number {
  return entry.targetValue ?? habit.targetValue
}

function getIsoWeekday(dateKey: string): number {
  return getIsoWeekdayForDateOnly(dateKey)
}
