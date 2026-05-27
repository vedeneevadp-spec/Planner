import type { NewHabitInput } from '@planner/contracts'

import type { Sphere } from '@/entities/sphere'
import {
  buildRoutineTaskFromForm,
  buildTaskRecurrenceFromForm,
  getResourceFromValue,
  getTaskImportanceFromType,
  getTaskUrgencyFromType,
  type NewTaskInput,
  type ResourceValue,
  type RoutineTaskFormState,
  type TaskRecurrenceFormState,
  type TaskReminderOffsetMinutes,
  type TaskTypeValue,
} from '@/entities/task'

export interface TaskComposerDraft {
  dueDate?: string | null | undefined
  icon?: string | undefined
  note?: string | undefined
  plannedDate?: string | null | undefined
  projectId?: string | null | undefined
  requestId: string
  resource?: ResourceValue | undefined
  taskType?: TaskTypeValue | undefined
  title?: string | undefined
}

export function getSpherePickerLabel(): string {
  return 'Сфера'
}

export function getEmptyProjectLabel(): string {
  return 'Без сферы'
}

export function resolveClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
  }
}

export interface BuildTaskComposerTaskInputParams {
  assigneeUserId: string
  canUseRecurrence: boolean
  icon: string
  initialPlannedDate: string | null
  isSharedWorkspace: boolean
  note: string
  plannedDate: string
  plannedEndTime: string
  plannedStartTime: string
  projectId: string
  recurrenceForm: TaskRecurrenceFormState
  reminderOffsets: TaskReminderOffsetMinutes[]
  requiresConfirmation: boolean
  resource: ResourceValue
  routineForm: RoutineTaskFormState
  spheres: Sphere[]
  taskType: TaskTypeValue
  title: string
  todayKey: string
}

export function buildTaskComposerTaskInput({
  assigneeUserId,
  canUseRecurrence,
  icon,
  initialPlannedDate,
  isSharedWorkspace,
  note,
  plannedDate,
  plannedEndTime,
  plannedStartTime,
  projectId,
  recurrenceForm,
  reminderOffsets,
  requiresConfirmation,
  resource,
  routineForm,
  spheres,
  taskType,
  title,
  todayKey,
}: BuildTaskComposerTaskInputParams): NewTaskInput | null {
  const normalizedTitle = title.trim()

  if (!normalizedTitle) {
    return null
  }

  const selectedProject =
    spheres.find((project) => project.id === projectId) ?? null
  const resolvedPlannedDate =
    canUseRecurrence && recurrenceForm.isEnabled && !plannedDate
      ? (initialPlannedDate ?? todayKey)
      : plannedDate
  const hasPlannedDate = Boolean(resolvedPlannedDate)
  const resolvedReminderOffsets =
    !isSharedWorkspace && hasPlannedDate && plannedStartTime
      ? reminderOffsets
      : []

  return {
    assigneeUserId: isSharedWorkspace ? assigneeUserId || null : null,
    dueDate: null,
    icon,
    importance: getTaskImportanceFromType(taskType),
    note,
    plannedDate: resolvedPlannedDate || null,
    plannedEndTime:
      hasPlannedDate && plannedStartTime ? plannedEndTime || null : null,
    plannedStartTime: hasPlannedDate ? plannedStartTime || null : null,
    project: selectedProject?.name ?? '',
    projectId: selectedProject?.id ?? null,
    recurrence: canUseRecurrence
      ? buildTaskRecurrenceFromForm(
          recurrenceForm,
          resolvedPlannedDate || todayKey,
        )
      : null,
    remindBeforeStart: resolvedReminderOffsets.length > 0,
    reminderOffsets: resolvedReminderOffsets,
    reminderTimeZone:
      resolvedReminderOffsets.length > 0 ? resolveClientTimeZone() : undefined,
    resource: getResourceFromValue(resource),
    requiresConfirmation: isSharedWorkspace ? requiresConfirmation : false,
    routine:
      taskType === 'routine' ? buildRoutineTaskFromForm(routineForm) : null,
    sphereId: selectedProject?.id ?? null,
    title: normalizedTitle,
    urgency: getTaskUrgencyFromType(taskType),
  }
}

export interface BuildTaskComposerHabitInputParams {
  icon: string
  initialPlannedDate: string | null
  note: string
  plannedDate: string
  projectId: string
  routineForm: RoutineTaskFormState
  spheres: Sphere[]
  title: string
  todayKey: string
}

export function buildTaskComposerHabitInput({
  icon,
  initialPlannedDate,
  note,
  plannedDate,
  projectId,
  routineForm,
  spheres,
  title,
  todayKey,
}: BuildTaskComposerHabitInputParams): NewHabitInput | null {
  const normalizedTitle = title.trim()

  if (!normalizedTitle) {
    return null
  }

  const selectedProject =
    spheres.find((project) => project.id === projectId) ?? null
  const routine = buildRoutineTaskFromForm(routineForm)

  return {
    color: '#2f6f62',
    daysOfWeek: routine.daysOfWeek,
    description: note.trim(),
    endDate: null,
    frequency: routine.frequency,
    icon: icon.trim() || 'check',
    reminderTime: null,
    sphereId: selectedProject?.id ?? null,
    startDate: plannedDate || initialPlannedDate || todayKey,
    targetType: routine.targetType,
    targetValue: routine.targetValue,
    title: normalizedTitle,
    unit: routine.targetType === 'count' ? routine.unit : '',
  }
}
