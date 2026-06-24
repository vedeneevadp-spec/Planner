import type {
  NewTaskInput,
  RoutineTask,
  TaskRecurrence,
  TaskReminderOffsetMinutes,
  TaskSchedule,
  TaskScheduleInput,
  TaskStatus,
  TaskUpdateInput,
} from '@planner/contracts'
import {
  generateUuidV7,
  getTimeInTimeZone,
  getTodayDate,
  makeFixedZoneDateTime,
  normalizeTimeZone,
} from '@planner/contracts'

import type { StoredTaskRecord } from './task.model.js'

const DEFAULT_DURATION_MINUTES = 60
const DEFAULT_TASK_REMINDER_OFFSETS: TaskReminderOffsetMinutes[] = [15]
const TASK_REMINDER_OFFSETS = new Set<number>([15, 30, 60])
const WEEKDAY_RRULE_VALUES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

export interface NormalizedTaskInput extends NewTaskInput {
  icon: string
  importance: NonNullable<NewTaskInput['importance']>
  note: string
  project: string
  projectId: string | null
  recurrence: TaskRecurrence | null
  remindBeforeStart: boolean
  reminderOffsets: TaskReminderOffsetMinutes[]
  reminderTimeZone: string | undefined
  resource: NewTaskInput['resource']
  requiresConfirmation: boolean
  routine: RoutineTask | null
  sphereId: string | null
  title: string
  urgency: NonNullable<NewTaskInput['urgency']>
}

export interface TaskTimeFields {
  localDate: string | null
  localTime: string | null
  recurrenceRule: string | null
  recurrenceStartDate: string | null
  recurrenceTimeZone: string | null
  startsAtUtc: string | null
  timeKind: 'date_only' | 'fixed_zone_datetime' | 'floating_local_time'
  timeZone: string | null
  timeZoneInferred: boolean
}

export function normalizeTaskSchedule({
  plannedDate,
  plannedStartTime,
  plannedEndTime,
}: TaskScheduleInput): TaskScheduleInput {
  if (!plannedDate) {
    return {
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
    }
  }

  if (!plannedStartTime) {
    return {
      plannedDate,
      plannedEndTime: null,
      plannedStartTime: null,
    }
  }

  if (!plannedEndTime || plannedEndTime <= plannedStartTime) {
    return {
      plannedDate,
      plannedEndTime: null,
      plannedStartTime,
    }
  }

  return {
    plannedDate,
    plannedEndTime,
    plannedStartTime,
  }
}

export function normalizeTaskInput(input: NewTaskInput): NormalizedTaskInput {
  const schedule = normalizeTaskSchedule(input)
  const reminderOffsets = normalizeTaskReminderOffsets(input)

  return {
    ...input,
    icon: (input.icon ?? '').trim(),
    importance: input.importance ?? 'not_important',
    note: input.note.trim(),
    project: input.project.trim(),
    projectId: input.projectId,
    recurrence: normalizeTaskRecurrence(input.recurrence, schedule.plannedDate),
    remindBeforeStart: reminderOffsets.length > 0,
    reminderOffsets,
    reminderTimeZone: input.reminderTimeZone?.trim() || undefined,
    resource: input.resource,
    requiresConfirmation: input.requiresConfirmation ?? false,
    routine: normalizeRoutineTask(input.routine),
    sphereId: input.sphereId,
    title: input.title.trim(),
    urgency: input.urgency ?? 'not_urgent',
  }
}

export function buildTaskScheduleValue(input: {
  plannedDate: string | null
  plannedStartTime: string | null
  recurrence?: TaskRecurrence | null | undefined
  startsAtUtc?: string | null | undefined
  timeKind?: string | null | undefined
  timeZone?: string | null | undefined
  timeZoneInferred?: boolean | undefined
}): TaskSchedule | null {
  if (
    input.timeKind === 'fixed_zone_datetime' &&
    input.plannedDate &&
    input.plannedStartTime &&
    input.timeZone
  ) {
    return {
      instantUtc:
        input.startsAtUtc ??
        makeFixedZoneDateTime({
          localDate: input.plannedDate,
          localTime: input.plannedStartTime,
          timeZone: input.timeZone,
        }).instantUtc,
      kind: 'fixed_zone_datetime',
      localDate: input.plannedDate,
      localTime: input.plannedStartTime,
      timeZone: input.timeZone,
      ...(input.timeZoneInferred ? { timeZoneInferred: true } : {}),
    }
  }

  if (input.timeKind === 'floating_local_time' && input.plannedStartTime) {
    return {
      kind: 'floating_local_time',
      localTime: input.plannedStartTime,
      ...(input.recurrence
        ? { recurrenceRule: buildRecurrenceRule(input.recurrence) }
        : {}),
    }
  }

  if (input.plannedDate) {
    return {
      kind: 'date_only',
      localDate: input.plannedDate,
    }
  }

  return null
}

export function buildTaskTimeFields(input: {
  plannerTimeZone?: string | null | undefined
  recurrence?: TaskRecurrence | null | undefined
  schedule: TaskScheduleInput
}): TaskTimeFields {
  const schedule = normalizeTaskSchedule(input.schedule)
  const recurrenceRule = input.recurrence
    ? buildRecurrenceRule(input.recurrence)
    : null

  if (schedule.plannedDate && schedule.plannedStartTime) {
    const timeZone = normalizeTimeZone(input.plannerTimeZone)
    const fixed = makeFixedZoneDateTime({
      localDate: schedule.plannedDate,
      localTime: schedule.plannedStartTime,
      timeZone,
    })

    return {
      localDate: fixed.localDate,
      localTime: fixed.localTime,
      recurrenceRule,
      recurrenceStartDate: input.recurrence?.startDate ?? fixed.localDate,
      recurrenceTimeZone: timeZone,
      startsAtUtc: fixed.instantUtc,
      timeKind: 'fixed_zone_datetime',
      timeZone,
      timeZoneInferred: true,
    }
  }

  if (schedule.plannedDate) {
    return {
      localDate: schedule.plannedDate,
      localTime: null,
      recurrenceRule,
      recurrenceStartDate: input.recurrence?.startDate ?? schedule.plannedDate,
      recurrenceTimeZone: null,
      startsAtUtc: null,
      timeKind: 'date_only',
      timeZone: null,
      timeZoneInferred: false,
    }
  }

  return {
    localDate: null,
    localTime: null,
    recurrenceRule,
    recurrenceStartDate: input.recurrence?.startDate ?? null,
    recurrenceTimeZone: null,
    startsAtUtc: null,
    timeKind: 'date_only',
    timeZone: null,
    timeZoneInferred: false,
  }
}

export function normalizeTaskReminderOffsets(
  input: Pick<NewTaskInput, 'remindBeforeStart' | 'reminderOffsets'>,
): TaskReminderOffsetMinutes[] {
  const rawOffsets =
    input.reminderOffsets !== undefined
      ? input.reminderOffsets
      : input.remindBeforeStart
        ? DEFAULT_TASK_REMINDER_OFFSETS
        : []

  return [...new Set(rawOffsets)]
    .filter((offset): offset is TaskReminderOffsetMinutes =>
      TASK_REMINDER_OFFSETS.has(offset),
    )
    .sort((left, right) => left - right)
}

function normalizeRoutineTask(
  routine: NewTaskInput['routine'],
): RoutineTask | null {
  if (!routine) {
    return null
  }

  return {
    daysOfWeek: normalizeRoutineDaysOfWeek(routine.daysOfWeek),
    frequency: routine.frequency,
    seriesId: routine.seriesId ?? generateUuidV7(),
    targetType: routine.targetType,
    targetValue: routine.targetValue,
    unit: routine.unit.trim(),
  }
}

function normalizeRoutineDaysOfWeek(daysOfWeek: number[]): number[] {
  const normalized = [...new Set(daysOfWeek)].filter(
    (day) => Number.isInteger(day) && day >= 1 && day <= 7,
  )

  return normalized.length > 0
    ? normalized.sort((left, right) => left - right)
    : [1, 2, 3, 4, 5, 6, 7]
}

function normalizeTaskRecurrence(
  recurrence: NewTaskInput['recurrence'],
  plannedDate: string | null,
): TaskRecurrence | null {
  if (!recurrence) {
    return null
  }

  const startDate = recurrence.startDate ?? plannedDate ?? getTodayDate('UTC')
  const frequency = recurrence.frequency ?? 'daily'
  const daysOfWeek =
    recurrence.daysOfWeek ??
    (frequency === 'daily' ? [1, 2, 3, 4, 5, 6, 7] : [1, 2, 3, 4, 5])

  return {
    daysOfWeek: normalizeRoutineDaysOfWeek(daysOfWeek),
    endDate: recurrence.endDate ?? null,
    frequency,
    interval: recurrence.interval ?? 1,
    isActive: recurrence.isActive !== false,
    seriesId: recurrence.seriesId ?? generateUuidV7(),
    startDate,
  }
}

function compareNullableTime(
  left: string | null,
  right: string | null,
): number {
  if (left === right) {
    return 0
  }

  if (left === null) {
    return 1
  }

  if (right === null) {
    return -1
  }

  return left < right ? -1 : 1
}

function getTaskStatusWeight(status: TaskStatus): number {
  if (status === 'in_progress') {
    return 0
  }

  if (status === 'ready_for_review') {
    return 1
  }

  if (status === 'todo') {
    return 2
  }

  if (status === 'archived') {
    return 3
  }

  return 4
}

export function isActiveTaskStatus(status: TaskStatus): boolean {
  return status !== 'done' && status !== 'archived'
}

export function compareStoredTasks(
  left: StoredTaskRecord,
  right: StoredTaskRecord,
): number {
  if (left.status !== right.status) {
    return getTaskStatusWeight(left.status) - getTaskStatusWeight(right.status)
  }

  const leftAnchor = left.plannedDate ?? left.dueDate ?? left.createdAt
  const rightAnchor = right.plannedDate ?? right.dueDate ?? right.createdAt

  if (leftAnchor !== rightAnchor) {
    return leftAnchor < rightAnchor ? -1 : 1
  }

  const timeComparison = compareNullableTime(
    left.plannedStartTime,
    right.plannedStartTime,
  )

  if (timeComparison !== 0) {
    return timeComparison
  }

  if (left.createdAt === right.createdAt) {
    return 0
  }

  return left.createdAt < right.createdAt ? -1 : 1
}

export function sortStoredTasks(tasks: StoredTaskRecord[]): StoredTaskRecord[] {
  return [...tasks].sort(compareStoredTasks)
}

export function createStoredTaskRecord(
  input: NewTaskInput,
  options: {
    authorDisplayName: string
    authorUserId: string
    clientTimeZone?: string | undefined
    id?: string
    linkedTask?: StoredTaskRecord['linkedTask']
    now?: string
    sourceWorkspace?: StoredTaskRecord['sourceWorkspace']
    workspaceId: string
  },
): StoredTaskRecord {
  const now = options.now ?? new Date().toISOString()
  const normalizedInput = normalizeTaskInput(input)
  const schedule = normalizeTaskSchedule(normalizedInput)

  return {
    assigneeDisplayName: null,
    assigneeUserId: normalizedInput.assigneeUserId,
    authorDisplayName: options.authorDisplayName,
    authorUserId: options.authorUserId,
    chainId: null,
    completionType: null,
    completedAt: null,
    createdAt: now,
    deletedAt: null,
    dueDate: normalizedInput.dueDate,
    icon: normalizedInput.icon,
    id: normalizedInput.id ?? options.id ?? generateUuidV7(),
    importance: normalizedInput.importance,
    linkedTask: options.linkedTask ?? null,
    note: normalizedInput.note,
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    previousTaskId: null,
    project: normalizedInput.project,
    projectId: normalizedInput.projectId,
    recurrence: normalizedInput.recurrence,
    remindBeforeStart: normalizedInput.remindBeforeStart ? true : undefined,
    reminderOffsets:
      normalizedInput.reminderOffsets.length > 0
        ? normalizedInput.reminderOffsets
        : undefined,
    resource: normalizedInput.resource,
    requiresConfirmation: normalizedInput.requiresConfirmation,
    routine: normalizedInput.routine,
    schedule: buildTaskScheduleValue({
      plannedDate: schedule.plannedDate,
      plannedStartTime: schedule.plannedStartTime,
      recurrence: normalizedInput.recurrence,
      timeKind: schedule.plannedStartTime ? 'fixed_zone_datetime' : 'date_only',
      timeZone: options.clientTimeZone,
      timeZoneInferred: Boolean(schedule.plannedStartTime),
    }),
    sphereId: normalizedInput.sphereId,
    sourceWorkspace: options.sourceWorkspace ?? null,
    stageIndex: null,
    stageType: null,
    status: 'todo',
    title: normalizedInput.title,
    urgency: normalizedInput.urgency,
    updatedAt: now,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

export function applyTaskStatus(
  task: StoredTaskRecord,
  status: TaskStatus,
  now: string = new Date().toISOString(),
): StoredTaskRecord {
  return {
    ...task,
    completionType: status === 'done' ? 'completed' : null,
    completedAt: status === 'done' ? now : null,
    status,
    updatedAt: now,
    version: task.version + 1,
  }
}

export function applyTaskSchedule(
  task: StoredTaskRecord,
  schedule: TaskScheduleInput,
  now: string = new Date().toISOString(),
  plannerTimeZone?: string,
): StoredTaskRecord {
  const normalizedSchedule = normalizeTaskSchedule(schedule)
  const nextSchedule = buildTaskScheduleValue({
    plannedDate: normalizedSchedule.plannedDate,
    plannedStartTime: normalizedSchedule.plannedStartTime,
    recurrence: task.recurrence,
    timeKind: normalizedSchedule.plannedStartTime
      ? 'fixed_zone_datetime'
      : 'date_only',
    timeZone: plannerTimeZone,
    timeZoneInferred: Boolean(normalizedSchedule.plannedStartTime),
  })
  const remindBeforeStart =
    normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
      ? task.remindBeforeStart
      : undefined
  const resolvedReminderOffsets = remindBeforeStart
    ? (task.reminderOffsets ?? [15])
    : undefined

  return {
    ...task,
    plannedDate: normalizedSchedule.plannedDate,
    plannedEndTime: normalizedSchedule.plannedEndTime,
    plannedStartTime: normalizedSchedule.plannedStartTime,
    remindBeforeStart,
    reminderOffsets: resolvedReminderOffsets,
    schedule: nextSchedule,
    updatedAt: now,
    version: task.version + 1,
  }
}

export function applyTaskUpdate(
  task: StoredTaskRecord,
  input: TaskUpdateInput,
  now: string = new Date().toISOString(),
  plannerTimeZone?: string,
): StoredTaskRecord {
  const normalizedInput = normalizeTaskInput({
    ...input,
    id: task.id,
  })
  const schedule = normalizeTaskSchedule(normalizedInput)

  return {
    ...task,
    assigneeUserId: normalizedInput.assigneeUserId,
    assigneeDisplayName: null,
    dueDate: normalizedInput.dueDate,
    icon: normalizedInput.icon,
    importance: normalizedInput.importance,
    note: normalizedInput.note,
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: normalizedInput.project,
    projectId: normalizedInput.projectId,
    recurrence: normalizedInput.recurrence,
    remindBeforeStart: normalizedInput.remindBeforeStart ? true : undefined,
    reminderOffsets:
      normalizedInput.reminderOffsets.length > 0
        ? normalizedInput.reminderOffsets
        : undefined,
    resource: normalizedInput.resource,
    requiresConfirmation: normalizedInput.requiresConfirmation,
    routine: normalizedInput.routine,
    schedule: buildTaskScheduleValue({
      plannedDate: schedule.plannedDate,
      plannedStartTime: schedule.plannedStartTime,
      recurrence: normalizedInput.recurrence,
      timeKind: schedule.plannedStartTime ? 'fixed_zone_datetime' : 'date_only',
      timeZone: plannerTimeZone,
      timeZoneInferred: Boolean(schedule.plannedStartTime),
    }),
    sphereId: normalizedInput.sphereId,
    title: normalizedInput.title,
    urgency: normalizedInput.urgency,
    updatedAt: now,
    version: task.version + 1,
  }
}

export function markTaskDeleted(
  task: StoredTaskRecord,
  now: string = new Date().toISOString(),
): StoredTaskRecord {
  return {
    ...task,
    deletedAt: now,
    updatedAt: now,
    version: task.version + 1,
  }
}

export function matchesTaskFilters(
  task: StoredTaskRecord,
  filters?: {
    plannedDate?: string | undefined
    projectId?: string | undefined
    project?: string | undefined
    sphereId?: string | undefined
    status?: TaskStatus | undefined
  },
): boolean {
  if (task.deletedAt !== null) {
    return false
  }

  if (!filters) {
    return true
  }

  if (filters.status && task.status !== filters.status) {
    return false
  }

  if (filters.project && task.project !== filters.project) {
    return false
  }

  if (filters.projectId && task.projectId !== filters.projectId) {
    return false
  }

  if (filters.sphereId && task.sphereId !== filters.sphereId) {
    return false
  }

  return !filters.plannedDate || task.plannedDate === filters.plannedDate
}

function toMinutes(time: string): number {
  const [hoursRaw, minutesRaw] = time.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)

  return hours * 60 + minutes
}

function toTimeString(totalMinutes: number): string {
  const normalizedMinutes = Math.max(0, Math.min(totalMinutes, 24 * 60 - 1))
  const hours = Math.floor(normalizedMinutes / 60)
  const minutes = normalizedMinutes % 60

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function buildDefaultEndTime(startTime: string): string {
  return toTimeString(toMinutes(startTime) + DEFAULT_DURATION_MINUTES)
}

export function buildTimestampFromDateAndTime(
  date: string,
  time: string,
  timeZone: string = 'UTC',
): string {
  return makeFixedZoneDateTime({
    localDate: date,
    localTime: time,
    timeZone: normalizeTimeZone(timeZone),
  }).instantUtc
}

export function extractTimeFromTimestamp(
  timestamp: string,
  timeZone?: string | null,
): string {
  if (timeZone && timeZone !== 'UTC') {
    return getTimeInTimeZone(timestamp, timeZone)
  }

  return timestamp.slice(11, 16)
}

export function buildRecurrenceRule(recurrence: TaskRecurrence): string {
  const interval = recurrence.interval ?? 1
  const parts = [`INTERVAL=${interval}`]

  if (recurrence.frequency === 'daily') {
    parts.unshift('FREQ=DAILY')
  } else if (recurrence.frequency === 'monthly') {
    parts.unshift('FREQ=MONTHLY')
  } else {
    parts.unshift('FREQ=WEEKLY')
    parts.push(
      `BYDAY=${recurrence.daysOfWeek
        .map((day) => WEEKDAY_RRULE_VALUES[day - 1])
        .filter((day): day is string => Boolean(day))
        .join(',')}`,
    )
  }

  if (recurrence.endDate) {
    parts.push(`UNTIL=${recurrence.endDate.replaceAll('-', '')}`)
  }

  return parts.join(';')
}
