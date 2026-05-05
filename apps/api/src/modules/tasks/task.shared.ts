import type {
  NewTaskInput,
  TaskScheduleInput,
  TaskStatus,
  TaskUpdateInput,
} from '@planner/contracts'
import { generateUuidV7 } from '@planner/contracts'

import type { StoredTaskRecord } from './task.model.js'

const DEFAULT_DURATION_MINUTES = 60

export interface NormalizedTaskInput extends NewTaskInput {
  icon: string
  importance: NonNullable<NewTaskInput['importance']>
  note: string
  project: string
  projectId: string | null
  remindBeforeStart: boolean
  reminderTimeZone: string | undefined
  resource: NewTaskInput['resource']
  requiresConfirmation: boolean
  sphereId: string | null
  title: string
  urgency: NonNullable<NewTaskInput['urgency']>
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
  return {
    ...input,
    icon: (input.icon ?? '').trim(),
    importance: input.importance ?? 'not_important',
    note: input.note.trim(),
    project: input.project.trim(),
    projectId: input.projectId,
    remindBeforeStart: input.remindBeforeStart === true,
    reminderTimeZone: input.reminderTimeZone?.trim() || undefined,
    resource: input.resource,
    requiresConfirmation: input.requiresConfirmation ?? false,
    sphereId: input.sphereId,
    title: input.title.trim(),
    urgency: input.urgency ?? 'not_urgent',
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

  return 3
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
    id?: string
    now?: string
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
    completedAt: null,
    createdAt: now,
    deletedAt: null,
    dueDate: normalizedInput.dueDate,
    icon: normalizedInput.icon,
    id: normalizedInput.id ?? options.id ?? generateUuidV7(),
    importance: normalizedInput.importance,
    note: normalizedInput.note,
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: normalizedInput.project,
    projectId: normalizedInput.projectId,
    remindBeforeStart: normalizedInput.remindBeforeStart ? true : undefined,
    resource: normalizedInput.resource,
    requiresConfirmation: normalizedInput.requiresConfirmation,
    sphereId: normalizedInput.sphereId,
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
): StoredTaskRecord {
  const normalizedSchedule = normalizeTaskSchedule(schedule)
  const remindBeforeStart =
    normalizedSchedule.plannedDate && normalizedSchedule.plannedStartTime
      ? task.remindBeforeStart
      : undefined

  return {
    ...task,
    plannedDate: normalizedSchedule.plannedDate,
    plannedEndTime: normalizedSchedule.plannedEndTime,
    plannedStartTime: normalizedSchedule.plannedStartTime,
    remindBeforeStart,
    updatedAt: now,
    version: task.version + 1,
  }
}

export function applyTaskUpdate(
  task: StoredTaskRecord,
  input: TaskUpdateInput,
  now: string = new Date().toISOString(),
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
    remindBeforeStart: normalizedInput.remindBeforeStart ? true : undefined,
    resource: normalizedInput.resource,
    requiresConfirmation: normalizedInput.requiresConfirmation,
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
): string {
  return `${date}T${time}:00.000Z`
}

export function extractTimeFromTimestamp(timestamp: string): string {
  return timestamp.slice(11, 16)
}
