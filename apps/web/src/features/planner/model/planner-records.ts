import {
  generateUuidV7,
  type ProjectRecord,
  type TaskRecord,
  type TaskTemplateRecord,
} from '@planner/contracts'

import type { NewProjectInput } from '@/entities/project'
import type { NewTaskInput, Task, TaskScheduleInput } from '@/entities/task'
import type {
  NewTaskTemplateInput,
  TaskTemplate,
} from '@/entities/task-template'

export function toPlannerTask(task: TaskRecord): Task {
  return {
    assigneeDisplayName: task.assigneeDisplayName,
    assigneeUserId: task.assigneeUserId,
    authorDisplayName: task.authorDisplayName,
    authorUserId: task.authorUserId,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    dueDate: task.dueDate,
    id: task.id,
    icon: task.icon,
    importance: task.importance,
    note: task.note,
    plannedDate: task.plannedDate,
    plannedEndTime: task.plannedEndTime,
    plannedStartTime: task.plannedStartTime,
    project: task.project,
    projectId: task.projectId,
    remindBeforeStart: task.remindBeforeStart,
    resource: task.resource,
    requiresConfirmation: task.requiresConfirmation,
    routine: task.routine ?? null,
    sphereId: task.sphereId,
    status: task.status,
    title: task.title,
    urgency: task.urgency,
  }
}

export function toPlannerTaskTemplate(
  template: TaskTemplateRecord,
): TaskTemplate {
  return {
    createdAt: template.createdAt,
    dueDate: template.dueDate,
    id: template.id,
    icon: template.icon,
    importance: template.importance,
    note: template.note,
    plannedDate: template.plannedDate,
    plannedEndTime: template.plannedEndTime,
    plannedStartTime: template.plannedStartTime,
    project: template.project,
    projectId: template.projectId,
    title: template.title,
    urgency: template.urgency,
  }
}

export function sortProjects(projects: ProjectRecord[]): ProjectRecord[] {
  return [...projects].sort((left, right) => {
    if (left.title !== right.title) {
      return left.title.localeCompare(right.title)
    }

    if (left.createdAt === right.createdAt) {
      return 0
    }

    return left.createdAt < right.createdAt ? -1 : 1
  })
}

export function sortTaskTemplates(
  templates: TaskTemplateRecord[],
): TaskTemplateRecord[] {
  return [...templates].sort((left, right) => {
    if (left.title !== right.title) {
      return left.title.localeCompare(right.title)
    }

    if (left.createdAt === right.createdAt) {
      return 0
    }

    return left.createdAt < right.createdAt ? -1 : 1
  })
}

export function normalizeSchedule({
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

export function createOptimisticTaskRecord(
  input: NewTaskInput,
  options: {
    authorDisplayName: string | null
    authorUserId: string | null
    workspaceId: string
  },
): TaskRecord {
  const now = new Date().toISOString()
  const schedule = normalizeSchedule({
    plannedDate: input.plannedDate,
    plannedEndTime: input.plannedEndTime,
    plannedStartTime: input.plannedStartTime,
  })

  return {
    assigneeDisplayName: null,
    assigneeUserId: input.assigneeUserId ?? null,
    authorDisplayName: options.authorDisplayName,
    authorUserId: options.authorUserId,
    completedAt: null,
    createdAt: now,
    deletedAt: null,
    dueDate: input.dueDate,
    id: input.id ?? generateUuidV7(),
    icon: (input.icon ?? '').trim(),
    importance: input.importance ?? 'not_important',
    note: input.note.trim(),
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: input.project.trim(),
    projectId: input.projectId,
    remindBeforeStart: input.remindBeforeStart ? true : undefined,
    resource: input.resource,
    requiresConfirmation: input.requiresConfirmation ?? false,
    routine: input.routine ?? null,
    sphereId: input.sphereId,
    status: 'todo',
    title: input.title.trim(),
    urgency: input.urgency ?? 'not_urgent',
    updatedAt: now,
    version: 1,
    workspaceId: options.workspaceId,
  }
}

export function createOptimisticTaskTemplateRecord(
  input: NewTaskTemplateInput,
  workspaceId: string,
): TaskTemplateRecord {
  const now = new Date().toISOString()
  const schedule = normalizeSchedule({
    plannedDate: input.plannedDate,
    plannedEndTime: input.plannedEndTime,
    plannedStartTime: input.plannedStartTime,
  })

  return {
    createdAt: now,
    deletedAt: null,
    dueDate: input.dueDate,
    id: input.id ?? generateUuidV7(),
    icon: (input.icon ?? '').trim(),
    importance: input.importance ?? 'not_important',
    note: input.note.trim(),
    plannedDate: schedule.plannedDate,
    plannedEndTime: schedule.plannedEndTime,
    plannedStartTime: schedule.plannedStartTime,
    project: input.project.trim(),
    projectId: input.projectId,
    title: input.title.trim(),
    urgency: input.urgency ?? 'not_urgent',
    updatedAt: now,
    version: 1,
    workspaceId,
  }
}

export function createOptimisticProjectRecord(
  input: NewProjectInput,
  workspaceId: string,
): ProjectRecord {
  const now = new Date().toISOString()

  return {
    color: input.color.trim(),
    createdAt: now,
    deletedAt: null,
    description: input.description.trim(),
    icon: input.icon.trim(),
    id: input.id ?? generateUuidV7(),
    status: 'active',
    title: input.title.trim(),
    updatedAt: now,
    version: 1,
    workspaceId,
  }
}

export function replaceProjectRecord(
  projectRecords: ProjectRecord[],
  nextProject: ProjectRecord,
): ProjectRecord[] {
  const existingIndex = projectRecords.findIndex(
    (project) => project.id === nextProject.id,
  )

  if (existingIndex === -1) {
    return sortProjects([nextProject, ...projectRecords])
  }

  return sortProjects(
    projectRecords.map((project) =>
      project.id === nextProject.id ? nextProject : project,
    ),
  )
}

export function replaceOptimisticProjectRecord(
  projectRecords: ProjectRecord[],
  optimisticProjectId: string | undefined,
  nextProject: ProjectRecord,
): ProjectRecord[] {
  if (!optimisticProjectId) {
    return replaceProjectRecord(projectRecords, nextProject)
  }

  let replaced = false
  const nextProjectRecords = projectRecords.map((project) => {
    if (project.id !== optimisticProjectId) {
      return project
    }

    replaced = true

    return nextProject
  })

  return replaced
    ? sortProjects(nextProjectRecords)
    : replaceProjectRecord(nextProjectRecords, nextProject)
}

function replaceTaskTemplateRecord(
  templateRecords: TaskTemplateRecord[],
  nextTemplate: TaskTemplateRecord,
): TaskTemplateRecord[] {
  const existingIndex = templateRecords.findIndex(
    (template) => template.id === nextTemplate.id,
  )

  if (existingIndex === -1) {
    return sortTaskTemplates([nextTemplate, ...templateRecords])
  }

  return sortTaskTemplates(
    templateRecords.map((template) =>
      template.id === nextTemplate.id ? nextTemplate : template,
    ),
  )
}

export function replaceOptimisticTaskTemplateRecord(
  templateRecords: TaskTemplateRecord[],
  optimisticTemplateId: string | undefined,
  nextTemplate: TaskTemplateRecord,
): TaskTemplateRecord[] {
  if (!optimisticTemplateId) {
    return replaceTaskTemplateRecord(templateRecords, nextTemplate)
  }

  let replaced = false
  const nextTemplateRecords = templateRecords.map((template) => {
    if (template.id !== optimisticTemplateId) {
      return template
    }

    replaced = true

    return nextTemplate
  })

  return replaced
    ? sortTaskTemplates(nextTemplateRecords)
    : replaceTaskTemplateRecord(nextTemplateRecords, nextTemplate)
}

export function replaceTaskRecord(
  taskRecords: TaskRecord[],
  nextTask: TaskRecord,
): TaskRecord[] {
  const existingIndex = taskRecords.findIndex((task) => task.id === nextTask.id)

  if (existingIndex === -1) {
    return [nextTask, ...taskRecords]
  }

  return taskRecords.map((task) => (task.id === nextTask.id ? nextTask : task))
}

export function replaceOptimisticTaskRecord(
  taskRecords: TaskRecord[],
  optimisticTaskId: string | undefined,
  nextTask: TaskRecord,
): TaskRecord[] {
  if (!optimisticTaskId) {
    return replaceTaskRecord(taskRecords, nextTask)
  }

  let replaced = false
  const nextTaskRecords = taskRecords.map((task) => {
    if (task.id !== optimisticTaskId) {
      return task
    }

    replaced = true

    return nextTask
  })

  return replaced
    ? nextTaskRecords
    : replaceTaskRecord(nextTaskRecords, nextTask)
}

export function updateTaskRecord(
  taskRecords: TaskRecord[],
  taskId: string,
  updater: (task: TaskRecord) => TaskRecord,
): TaskRecord[] {
  return taskRecords.map((task) => (task.id === taskId ? updater(task) : task))
}

export function updateTaskProjectRecords(
  taskRecords: TaskRecord[],
  project: ProjectRecord,
): TaskRecord[] {
  return taskRecords.map((task) =>
    task.projectId === project.id
      ? {
          ...task,
          project: project.title,
        }
      : task,
  )
}

export function updateTaskTemplateProjectRecords(
  templateRecords: TaskTemplateRecord[],
  project: ProjectRecord,
): TaskTemplateRecord[] {
  return templateRecords.map((template) =>
    template.projectId === project.id
      ? {
          ...template,
          project: project.title,
        }
      : template,
  )
}

export function detachProjectFromTaskRecords(
  taskRecords: TaskRecord[],
  projectId: string,
): TaskRecord[] {
  return taskRecords.map((task) =>
    task.projectId === projectId || task.sphereId === projectId
      ? {
          ...task,
          project: '',
          projectId: null,
          sphereId: null,
        }
      : task,
  )
}

export function detachProjectFromTaskTemplateRecords(
  templateRecords: TaskTemplateRecord[],
  projectId: string,
): TaskTemplateRecord[] {
  return templateRecords.map((template) =>
    template.projectId === projectId
      ? {
          ...template,
          project: '',
          projectId: null,
        }
      : template,
  )
}

export function removeProjectRecord(
  projectRecords: ProjectRecord[],
  projectId: string,
): ProjectRecord[] {
  return projectRecords.filter((project) => project.id !== projectId)
}

export function removeTaskRecord(
  taskRecords: TaskRecord[],
  taskId: string,
): TaskRecord[] {
  return taskRecords.filter((task) => task.id !== taskId)
}

export function removeTaskTemplateRecord(
  templateRecords: TaskTemplateRecord[],
  templateId: string,
): TaskTemplateRecord[] {
  return templateRecords.filter((template) => template.id !== templateId)
}

export function getTaskRecord(
  taskRecords: TaskRecord[],
  taskId: string,
): TaskRecord | undefined {
  return taskRecords.find((task) => task.id === taskId)
}

export function toggleTaskId(
  taskIds: Set<string>,
  taskId: string,
  isPending: boolean,
): Set<string> {
  const nextTaskIds = new Set(taskIds)

  if (isPending) {
    nextTaskIds.add(taskId)
  } else {
    nextTaskIds.delete(taskId)
  }

  return nextTaskIds
}
