import { getDateKey, isBeforeDate } from '@/shared/lib/date'

import type { NewTaskInput, Task, TaskStatus } from './task.types'

export interface AddTaskOptions {
  now?: string
  createId?: () => string
}

export interface PlannerSummary {
  focusCount: number
  inboxCount: number
  overdueCount: number
  doneTodayCount: number
  projectCount: number
}

function createTaskId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === 'todo' ? -1 : 1
    }

    const leftAnchor = left.plannedDate ?? left.dueDate ?? left.createdAt
    const rightAnchor = right.plannedDate ?? right.dueDate ?? right.createdAt

    if (leftAnchor !== rightAnchor) {
      return leftAnchor < rightAnchor ? -1 : 1
    }

    if (left.createdAt === right.createdAt) {
      return 0
    }

    return left.createdAt < right.createdAt ? -1 : 1
  })
}

export function addTask(
  tasks: Task[],
  input: NewTaskInput,
  options: AddTaskOptions = {},
): Task[] {
  const now = options.now ?? new Date().toISOString()
  const createId = options.createId ?? createTaskId
  const task: Task = {
    id: createId(),
    title: input.title.trim(),
    note: input.note.trim(),
    project: input.project.trim(),
    status: 'todo',
    plannedDate: input.plannedDate,
    dueDate: input.dueDate,
    createdAt: now,
    completedAt: null,
  }

  return sortTasks([task, ...tasks])
}

export function setTaskStatus(
  tasks: Task[],
  taskId: string,
  status: TaskStatus,
  now: string = new Date().toISOString(),
): Task[] {
  return sortTasks(
    tasks.map((task) => {
      if (task.id !== taskId) {
        return task
      }

      return {
        ...task,
        status,
        completedAt: status === 'done' ? now : null,
      }
    }),
  )
}

export function setTaskPlannedDate(
  tasks: Task[],
  taskId: string,
  plannedDate: string | null,
): Task[] {
  return sortTasks(
    tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            plannedDate,
          }
        : task,
    ),
  )
}

export function removeTask(tasks: Task[], taskId: string): Task[] {
  return tasks.filter((task) => task.id !== taskId)
}

export function selectTodoTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.status === 'todo')
}

export function selectInboxTasks(tasks: Task[]): Task[] {
  return selectTodoTasks(tasks).filter((task) => !task.plannedDate)
}

export function selectTodayTasks(tasks: Task[], todayKey: string): Task[] {
  return selectTodoTasks(tasks).filter((task) => task.plannedDate === todayKey)
}

export function selectOverdueTasks(tasks: Task[], todayKey: string): Task[] {
  return selectTodoTasks(tasks).filter(
    (task) =>
      task.plannedDate !== null && isBeforeDate(task.plannedDate, todayKey),
  )
}

export function selectDoneTasks(tasks: Task[]): Task[] {
  return tasks.filter((task) => task.status === 'done')
}

export function selectDoneTodayTasks(tasks: Task[], todayKey: string): Task[] {
  return selectDoneTasks(tasks).filter(
    (task) =>
      task.completedAt !== null &&
      getDateKey(new Date(task.completedAt)) === todayKey,
  )
}

export function groupTasksByProject(tasks: Task[]): Array<[string, Task[]]> {
  const projectMap = new Map<string, Task[]>()

  for (const task of tasks) {
    const projectName = task.project.trim() || 'No project'
    const projectTasks = projectMap.get(projectName) ?? []

    projectTasks.push(task)
    projectMap.set(projectName, projectTasks)
  }

  return [...projectMap.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )
}

export function getPlannerSummary(
  tasks: Task[],
  todayKey: string,
): PlannerSummary {
  return {
    focusCount: selectTodayTasks(tasks, todayKey).length,
    inboxCount: selectInboxTasks(tasks).length,
    overdueCount: selectOverdueTasks(tasks, todayKey).length,
    doneTodayCount: selectDoneTodayTasks(tasks, todayKey).length,
    projectCount: groupTasksByProject(tasks).length,
  }
}
