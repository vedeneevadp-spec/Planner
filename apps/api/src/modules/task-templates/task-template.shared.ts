import {
  generateUuidV7,
  type NewTaskTemplateInput,
  type TaskScheduleInput,
} from '@planner/contracts'

import type { StoredTaskTemplateRecord } from './task-template.model.js'

export interface NormalizedTaskTemplateInput extends NewTaskTemplateInput {
  note: string
  project: string
  projectId: string | null
  title: string
}

export function normalizeTaskTemplateSchedule({
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

export function normalizeTaskTemplateInput(
  input: NewTaskTemplateInput,
): NormalizedTaskTemplateInput {
  return {
    ...input,
    note: input.note.trim(),
    project: input.project.trim(),
    projectId: input.projectId,
    title: input.title.trim(),
  }
}

export function createStoredTaskTemplateRecord(
  input: NewTaskTemplateInput,
  options: {
    id?: string
    now?: string
    workspaceId: string
  },
): StoredTaskTemplateRecord {
  const now = options.now ?? new Date().toISOString()
  const normalizedInput = normalizeTaskTemplateInput(input)
  const schedule = normalizeTaskTemplateSchedule(normalizedInput)

  return {
    createdAt: now,
    deletedAt: null,
    dueDate: normalizedInput.dueDate,
    id: normalizedInput.id ?? options.id ?? generateUuidV7(),
    note: normalizedInput.note,
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: normalizedInput.project,
    projectId: normalizedInput.projectId,
    title: normalizedInput.title,
    updatedAt: now,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

export function markTaskTemplateDeleted(
  template: StoredTaskTemplateRecord,
  now: string = new Date().toISOString(),
): StoredTaskTemplateRecord {
  return {
    ...template,
    deletedAt: now,
    updatedAt: now,
    version: template.version + 1,
  }
}

export function compareStoredTaskTemplates(
  left: StoredTaskTemplateRecord,
  right: StoredTaskTemplateRecord,
): number {
  if (left.title !== right.title) {
    return left.title.localeCompare(right.title)
  }

  if (left.createdAt === right.createdAt) {
    return 0
  }

  return left.createdAt < right.createdAt ? -1 : 1
}

export function sortStoredTaskTemplates(
  templates: StoredTaskTemplateRecord[],
): StoredTaskTemplateRecord[] {
  return [...templates].sort(compareStoredTaskTemplates)
}
