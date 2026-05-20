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
  type TaskTypeValue,
} from '@/entities/task'
import type { TaskTemplate } from '@/entities/task-template'

export const LEGACY_EMPTY_PROJECT_TITLES = new Set([
  'Без сферы',
  'Без проекта',
  'No sphere',
  'No project',
])

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

interface ProjectFields {
  project: string
  projectId: string | null
}

export function getSpherePickerLabel(): string {
  return 'Сфера'
}

export function getEmptyProjectLabel(): string {
  return 'Без сферы'
}

export function getSphereDisplayTitle(projectTitle: string): string {
  const normalizedProjectTitle = projectTitle.trim()

  if (
    !normalizedProjectTitle ||
    LEGACY_EMPTY_PROJECT_TITLES.has(normalizedProjectTitle)
  ) {
    return getEmptyProjectLabel()
  }

  return normalizedProjectTitle
}

export function resolveProjectFields(
  spheres: Sphere[],
  projectId: string | null,
  fallbackProject: string,
): ProjectFields {
  const project = projectId
    ? spheres.find((candidate) => candidate.id === projectId)
    : null

  if (project) {
    return {
      project: project.name,
      projectId: project.id,
    }
  }

  const normalizedFallbackProject = fallbackProject.trim()

  return {
    project: LEGACY_EMPTY_PROJECT_TITLES.has(normalizedFallbackProject)
      ? ''
      : normalizedFallbackProject,
    projectId: null,
  }
}

export function getTemplateProject(
  template: TaskTemplate,
  spheres: Sphere[],
): Sphere | null {
  if (!template.projectId) {
    return null
  }

  return (
    spheres.find((candidate) => candidate.id === template.projectId) ?? null
  )
}

export interface TaskTemplateDisplayProject {
  hasProject: boolean
  project: Sphere | null
  title: string
}

export function getTemplateDisplayProject(
  template: TaskTemplate,
  spheres: Sphere[],
): TaskTemplateDisplayProject {
  const project = getTemplateProject(template, spheres)
  const normalizedTemplateProjectTitle = template.project.trim()
  const hasProject =
    project !== null ||
    (Boolean(normalizedTemplateProjectTitle) &&
      !LEGACY_EMPTY_PROJECT_TITLES.has(normalizedTemplateProjectTitle))

  return {
    hasProject,
    project,
    title: project?.name ?? getSphereDisplayTitle(template.project),
  }
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
  remindBeforeStart: boolean
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
  remindBeforeStart,
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
    remindBeforeStart: isSharedWorkspace ? false : remindBeforeStart,
    reminderTimeZone:
      !isSharedWorkspace && remindBeforeStart
        ? resolveClientTimeZone()
        : undefined,
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

export function buildTaskInputFromTemplate(
  template: TaskTemplate,
  spheres: Sphere[],
  initialPlannedDate: string | null,
  isSharedWorkspace: boolean,
): NewTaskInput {
  const project = resolveProjectFields(
    spheres,
    template.projectId,
    template.project,
  )
  const plannedDate = initialPlannedDate ?? template.plannedDate

  return {
    assigneeUserId: null,
    dueDate: null,
    note: template.note,
    icon: template.icon,
    importance: template.importance,
    plannedDate,
    plannedEndTime: plannedDate ? template.plannedEndTime : null,
    plannedStartTime: plannedDate ? template.plannedStartTime : null,
    project: project.project,
    projectId: project.projectId,
    remindBeforeStart: Boolean(
      !isSharedWorkspace && plannedDate && template.plannedStartTime,
    ),
    reminderTimeZone:
      !isSharedWorkspace && plannedDate && template.plannedStartTime
        ? resolveClientTimeZone()
        : undefined,
    resource: 0,
    requiresConfirmation: false,
    sphereId: project.projectId,
    title: template.title,
    urgency: template.urgency,
  }
}
