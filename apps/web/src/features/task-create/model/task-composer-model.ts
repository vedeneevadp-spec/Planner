import type { Sphere } from '@/entities/sphere'
import type {
  NewTaskInput,
  ResourceValue,
  TaskTypeValue,
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

export function resolveClientTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined
  } catch {
    return undefined
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
