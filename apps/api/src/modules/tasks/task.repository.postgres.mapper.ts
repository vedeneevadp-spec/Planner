import { routineTaskSchema, taskRecurrenceSchema } from '@planner/contracts'

import type { JsonObject } from '../../infrastructure/db/schema.js'
import type { StoredTaskEventRecord, StoredTaskRecord } from './task.model.js'
import {
  DEFAULT_TASK_IMPORTANCE,
  DEFAULT_TASK_URGENCY,
  LEGACY_PROJECT_NAME_KEY,
  TASK_ICON_KEY,
  TASK_IMPORTANCE_KEY,
  TASK_RECURRENCE_KEY,
  TASK_REMIND_BEFORE_START_KEY,
  TASK_REQUIRES_CONFIRMATION_KEY,
  TASK_ROUTINE_KEY,
  TASK_URGENCY_KEY,
  type TaskEventRow,
  type TaskListRow,
  type TaskRow,
  type TaskTimeBlockRow,
} from './task.repository.postgres.types.js'
import { extractTimeFromTimestamp } from './task.shared.js'

export function mapTaskRecord(
  task: TaskRow,
  timeBlock: TaskTimeBlockRow | undefined,
  projectTitle: string | null,
  assigneeDisplayName: string | null,
  authorDisplayName: string | null,
): StoredTaskRecord {
  return {
    assigneeDisplayName,
    assigneeUserId: task.assignee_user_id,
    authorDisplayName,
    authorUserId: task.created_by,
    completedAt: serializeNullableTimestamp(task.completed_at),
    createdAt: serializeTimestamp(task.created_at),
    deletedAt: serializeNullableTimestamp(task.deleted_at),
    dueDate: serializeNullableDate(task.due_on),
    id: task.id,
    icon: readTaskIcon(task.metadata),
    importance: readTaskImportance(task.metadata),
    note: task.description,
    plannedDate: serializeNullableDate(task.planned_on),
    plannedEndTime: timeBlock
      ? extractTimeFromTimestamp(serializeTimestamp(timeBlock.ends_at))
      : null,
    plannedStartTime: timeBlock
      ? extractTimeFromTimestamp(serializeTimestamp(timeBlock.starts_at))
      : null,
    project: projectTitle ?? readLegacyProjectName(task.metadata),
    projectId: task.project_id,
    recurrence: readTaskRecurrence(task.metadata),
    remindBeforeStart: readTaskRemindBeforeStart(task.metadata),
    resource: task.resource,
    requiresConfirmation: readTaskRequiresConfirmation(task.metadata),
    routine: readTaskRoutine(task.metadata),
    sphereId: task.project_id ?? task.sphere_id,
    status: task.status,
    title: task.title,
    urgency: readTaskUrgency(task.metadata),
    updatedAt: serializeTimestamp(task.updated_at),
    version: Number(task.version),
    workspaceId: task.workspace_id,
  }
}

export function mapTaskRecordFromListRow(task: TaskListRow): StoredTaskRecord {
  return {
    assigneeDisplayName: task.assignee_display_name ?? null,
    assigneeUserId: task.assignee_user_id,
    authorDisplayName: task.author_display_name ?? null,
    authorUserId: task.created_by,
    completedAt: serializeNullableTimestamp(task.completed_at),
    createdAt: serializeTimestamp(task.created_at),
    deletedAt: serializeNullableTimestamp(task.deleted_at),
    dueDate: serializeNullableDate(task.due_on),
    id: task.id,
    icon: readTaskIcon(task.metadata),
    importance: readTaskImportance(task.metadata),
    note: task.description,
    plannedDate: serializeNullableDate(task.planned_on),
    plannedEndTime: task.time_block_ends_at
      ? extractTimeFromTimestamp(serializeTimestamp(task.time_block_ends_at))
      : null,
    plannedStartTime: task.time_block_starts_at
      ? extractTimeFromTimestamp(serializeTimestamp(task.time_block_starts_at))
      : null,
    project: task.project_title ?? readLegacyProjectName(task.metadata),
    projectId: task.project_id,
    recurrence: readTaskRecurrence(task.metadata),
    remindBeforeStart: readTaskRemindBeforeStart(task.metadata),
    resource: task.resource,
    requiresConfirmation: readTaskRequiresConfirmation(task.metadata),
    routine: readTaskRoutine(task.metadata),
    sphereId: task.project_id ?? task.sphere_id,
    status: task.status,
    title: task.title,
    urgency: readTaskUrgency(task.metadata),
    updatedAt: serializeTimestamp(task.updated_at),
    version: Number(task.version),
    workspaceId: task.workspace_id,
  }
}

export function buildTaskMetadata(
  projectName: string,
  input: Pick<
    StoredTaskRecord,
    | 'icon'
    | 'importance'
    | 'recurrence'
    | 'remindBeforeStart'
    | 'requiresConfirmation'
    | 'routine'
    | 'urgency'
  >,
): JsonObject {
  const metadata: JsonObject = {}

  if (projectName) {
    metadata[LEGACY_PROJECT_NAME_KEY] = projectName
  }

  if (input.icon) {
    metadata[TASK_ICON_KEY] = input.icon
  }

  if (input.importance !== DEFAULT_TASK_IMPORTANCE) {
    metadata[TASK_IMPORTANCE_KEY] = input.importance
  }

  if (input.remindBeforeStart) {
    metadata[TASK_REMIND_BEFORE_START_KEY] = true
  }

  if (input.requiresConfirmation) {
    metadata[TASK_REQUIRES_CONFIRMATION_KEY] = true
  }

  if (input.recurrence) {
    metadata[TASK_RECURRENCE_KEY] = input.recurrence
  }

  if (input.routine) {
    metadata[TASK_ROUTINE_KEY] = input.routine
  }

  if (input.urgency !== DEFAULT_TASK_URGENCY) {
    metadata[TASK_URGENCY_KEY] = input.urgency
  }

  return metadata
}

export function mapTaskEventRecord(event: TaskEventRow): StoredTaskEventRecord {
  return {
    actorUserId: event.actor_user_id,
    eventId: event.event_id,
    eventType: event.event_type,
    id: Number(event.id),
    occurredAt: serializeTimestamp(event.occurred_at),
    payload: normalizeJsonObject(event.payload),
    taskId: event.task_id,
    workspaceId: event.workspace_id,
  }
}

function readLegacyProjectName(metadata: JsonObject): string {
  const value = metadata[LEGACY_PROJECT_NAME_KEY]

  return typeof value === 'string' ? value : ''
}

function readTaskIcon(metadata: JsonObject): string {
  const value = metadata[TASK_ICON_KEY]

  return typeof value === 'string' ? value : ''
}

function readTaskImportance(
  metadata: JsonObject,
): StoredTaskRecord['importance'] {
  const value = metadata[TASK_IMPORTANCE_KEY]

  return value === 'important' || value === 'not_important'
    ? value
    : DEFAULT_TASK_IMPORTANCE
}

function readTaskRemindBeforeStart(metadata: JsonObject): true | undefined {
  return metadata[TASK_REMIND_BEFORE_START_KEY] === true ? true : undefined
}

function readTaskRequiresConfirmation(metadata: JsonObject): boolean {
  return metadata[TASK_REQUIRES_CONFIRMATION_KEY] === true
}

function readTaskRecurrence(
  metadata: JsonObject,
): StoredTaskRecord['recurrence'] | null {
  const value = metadata[TASK_RECURRENCE_KEY]
  const parsed = taskRecurrenceSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

function readTaskRoutine(
  metadata: JsonObject,
): StoredTaskRecord['routine'] | null {
  const value = metadata[TASK_ROUTINE_KEY]
  const parsed = routineTaskSchema.safeParse(value)

  return parsed.success ? parsed.data : null
}

function readTaskUrgency(metadata: JsonObject): StoredTaskRecord['urgency'] {
  const value = metadata[TASK_URGENCY_KEY]

  return value === 'urgent' || value === 'not_urgent'
    ? value
    : DEFAULT_TASK_URGENCY
}

export function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

export function serializeNullableDate(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Date) {
    const year = value.getFullYear()
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
  }

  throw new TypeError(`Unexpected date value: ${typeof value}`)
}

export function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

export function normalizeJsonObject(value: unknown): JsonObject {
  if (typeof value === 'string') {
    const parsedValue = JSON.parse(value) as unknown

    return normalizeJsonObject(parsedValue)
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject
  }

  return {}
}
