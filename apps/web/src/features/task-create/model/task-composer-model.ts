import type { Project } from '@/entities/project'
import type {
  NewTaskInput,
  ResourceValue,
  TaskTypeValue,
} from '@/entities/task'
import type { TaskTemplate } from '@/entities/task-template'

export const LEGACY_EMPTY_PROJECT_TITLES = new Set(['Без сферы', 'No sphere'])

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

export function getProjectPickerLabel(isSharedWorkspace: boolean): string {
  return isSharedWorkspace ? 'Проект' : 'Сфера'
}

export function getEmptyProjectLabel(isSharedWorkspace: boolean): string {
  return isSharedWorkspace ? 'Без проекта' : 'Без сферы'
}

export function getProjectDisplayTitle(
  projectTitle: string,
  isSharedWorkspace: boolean,
): string {
  const normalizedProjectTitle = projectTitle.trim()

  if (
    !normalizedProjectTitle ||
    LEGACY_EMPTY_PROJECT_TITLES.has(normalizedProjectTitle)
  ) {
    return getEmptyProjectLabel(isSharedWorkspace)
  }

  return normalizedProjectTitle
}

export function resolveProjectFields(
  projects: Project[],
  projectId: string | null,
  fallbackProject: string,
): ProjectFields {
  const project = projectId
    ? projects.find((candidate) => candidate.id === projectId)
    : null

  if (project) {
    return {
      project: project.title,
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
  projects: Project[],
): Project | null {
  if (!template.projectId) {
    return null
  }

  return (
    projects.find((candidate) => candidate.id === template.projectId) ?? null
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
  projects: Project[],
  initialPlannedDate: string | null,
  isSharedWorkspace: boolean,
): NewTaskInput {
  const project = resolveProjectFields(
    projects,
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
    project: isSharedWorkspace ? '' : project.project,
    projectId: isSharedWorkspace ? null : project.projectId,
    remindBeforeStart: Boolean(
      !isSharedWorkspace && plannedDate && template.plannedStartTime,
    ),
    reminderTimeZone:
      !isSharedWorkspace && plannedDate && template.plannedStartTime
        ? resolveClientTimeZone()
        : undefined,
    resource: 0,
    requiresConfirmation: false,
    sphereId: null,
    title: template.title,
    urgency: template.urgency,
  }
}
