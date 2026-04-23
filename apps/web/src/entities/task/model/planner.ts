import type { TaskScheduleInput } from '@planner/contracts'

import { addDays, getDateKey, isBeforeDate } from '@/shared/lib/date'

import type { NewTaskInput, Task, TaskStatus } from './task.types'

const DEFAULT_TIMELINE_DURATION_MINUTES = 60

export interface AddTaskOptions {
  now?: string
  createId?: () => string
}
export type { TaskScheduleInput } from '@planner/contracts'

export interface TimelineTaskLayout {
  task: Task
  startMinutes: number
  endMinutes: number
  column: number
  columns: number
}

export interface PlannerSummary {
  focusCount: number
  inboxCount: number
  overdueCount: number
  doneTodayCount: number
  projectCount: number
  timelineCount: number
  tomorrowCount: number
}

function createTaskId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeTaskSchedule({
  plannedDate,
  plannedStartTime,
  plannedEndTime,
}: TaskScheduleInput): TaskScheduleInput {
  if (!plannedDate) {
    return {
      plannedDate: null,
      plannedStartTime: null,
      plannedEndTime: null,
    }
  }

  if (!plannedStartTime) {
    return {
      plannedDate,
      plannedStartTime: null,
      plannedEndTime: null,
    }
  }

  if (!plannedEndTime || plannedEndTime <= plannedStartTime) {
    return {
      plannedDate,
      plannedStartTime,
      plannedEndTime: null,
    }
  }

  return {
    plannedDate,
    plannedStartTime,
    plannedEndTime,
  }
}

function compareOptionalTime(
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

function getTaskMatrixWeight(task: Task): number {
  if (task.importance === 'important' && task.urgency === 'urgent') {
    return 0
  }

  if (task.importance === 'not_important' && task.urgency === 'urgent') {
    return 1
  }

  if (task.importance === 'important' && task.urgency === 'not_urgent') {
    return 2
  }

  return 3
}

function parseTimeKey(value: string): number {
  const [hoursRaw, minutesRaw] = value.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)

  return hours * 60 + minutes
}

function getTimelineEndMinutes(task: Task): number | null {
  if (!task.plannedStartTime) {
    return null
  }

  const startMinutes = parseTimeKey(task.plannedStartTime)
  const rawEndMinutes = task.plannedEndTime
    ? parseTimeKey(task.plannedEndTime)
    : Math.min(startMinutes + DEFAULT_TIMELINE_DURATION_MINUTES, 24 * 60)

  if (rawEndMinutes <= startMinutes) {
    return Math.min(startMinutes + DEFAULT_TIMELINE_DURATION_MINUTES, 24 * 60)
  }

  return rawEndMinutes
}

function finalizeTimelineGroup(
  group: TimelineTaskLayout[],
): TimelineTaskLayout[] {
  if (group.length === 0) {
    return []
  }

  const activeColumns: Array<{ column: number; endMinutes: number }> = []
  let maxColumns = 1

  for (const entry of group) {
    for (let index = activeColumns.length - 1; index >= 0; index -= 1) {
      if (activeColumns[index]!.endMinutes <= entry.startMinutes) {
        activeColumns.splice(index, 1)
      }
    }

    const occupiedColumns = new Set(activeColumns.map((item) => item.column))
    let nextColumn = 0

    while (occupiedColumns.has(nextColumn)) {
      nextColumn += 1
    }

    entry.column = nextColumn
    activeColumns.push({
      column: nextColumn,
      endMinutes: entry.endMinutes,
    })
    maxColumns = Math.max(maxColumns, activeColumns.length)
  }

  return group.map((entry) => ({
    ...entry,
    columns: maxColumns,
  }))
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

    const timeComparison = compareOptionalTime(
      left.plannedStartTime,
      right.plannedStartTime,
    )

    if (timeComparison !== 0) {
      return timeComparison
    }

    const matrixComparison =
      getTaskMatrixWeight(left) - getTaskMatrixWeight(right)

    if (matrixComparison !== 0) {
      return matrixComparison
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
  const schedule = normalizeTaskSchedule({
    plannedDate: input.plannedDate,
    plannedStartTime: input.plannedStartTime,
    plannedEndTime: input.plannedEndTime,
  })
  const task: Task = {
    id: createId(),
    icon: (input.icon ?? '').trim(),
    importance: input.importance ?? 'not_important',
    title: input.title.trim(),
    note: input.note.trim(),
    project: input.project.trim(),
    projectId: input.projectId,
    resource: input.resource,
    sphereId: input.sphereId,
    status: 'todo',
    plannedDate: schedule.plannedDate,
    plannedStartTime: schedule.plannedStartTime,
    plannedEndTime: schedule.plannedEndTime,
    dueDate: input.dueDate,
    createdAt: now,
    completedAt: null,
    urgency: input.urgency ?? 'not_urgent',
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
    tasks.map((task) => {
      if (task.id !== taskId) {
        return task
      }

      return {
        ...task,
        ...normalizeTaskSchedule({
          plannedDate,
          plannedStartTime: plannedDate ? task.plannedStartTime : null,
          plannedEndTime: plannedDate ? task.plannedEndTime : null,
        }),
      }
    }),
  )
}

export function setTaskSchedule(
  tasks: Task[],
  taskId: string,
  schedule: TaskScheduleInput,
): Task[] {
  const normalizedSchedule = normalizeTaskSchedule(schedule)

  return sortTasks(
    tasks.map((task) =>
      task.id === taskId
        ? {
            ...task,
            ...normalizedSchedule,
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

export function selectTomorrowTasks(
  tasks: Task[],
  tomorrowKey: string,
): Task[] {
  return selectTodoTasks(tasks).filter(
    (task) => task.plannedDate === tomorrowKey,
  )
}

export function selectPlannedTasks(tasks: Task[], dateKey: string): Task[] {
  return selectTodoTasks(tasks).filter((task) => task.plannedDate === dateKey)
}

export function selectTimedTasks(tasks: Task[], dateKey: string): Task[] {
  return selectPlannedTasks(tasks, dateKey).filter(
    (task) => task.plannedStartTime !== null,
  )
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

export function buildTimelineLayout(
  tasks: Task[],
  dateKey: string,
): TimelineTaskLayout[] {
  const scheduledEntries = selectTimedTasks(tasks, dateKey)
    .map((task) => {
      const startMinutes = parseTimeKey(task.plannedStartTime!)
      const endMinutes = getTimelineEndMinutes(task)

      if (endMinutes === null) {
        return null
      }

      return {
        task,
        startMinutes,
        endMinutes,
        column: 0,
        columns: 1,
      }
    })
    .filter((entry): entry is TimelineTaskLayout => entry !== null)
    .sort((left, right) => {
      if (left.startMinutes !== right.startMinutes) {
        return left.startMinutes - right.startMinutes
      }

      if (left.endMinutes !== right.endMinutes) {
        return left.endMinutes - right.endMinutes
      }

      if (left.task.createdAt === right.task.createdAt) {
        return 0
      }

      return left.task.createdAt < right.task.createdAt ? -1 : 1
    })

  const layout: TimelineTaskLayout[] = []
  let currentGroup: TimelineTaskLayout[] = []
  let currentGroupEnd = -1

  for (const entry of scheduledEntries) {
    if (currentGroup.length === 0 || entry.startMinutes < currentGroupEnd) {
      currentGroup.push(entry)
      currentGroupEnd = Math.max(currentGroupEnd, entry.endMinutes)
      continue
    }

    layout.push(...finalizeTimelineGroup(currentGroup))
    currentGroup = [entry]
    currentGroupEnd = entry.endMinutes
  }

  if (currentGroup.length > 0) {
    layout.push(...finalizeTimelineGroup(currentGroup))
  }

  return layout
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
    timelineCount: selectTimedTasks(tasks, todayKey).length,
    tomorrowCount: selectPlannedTasks(
      tasks,
      getDateKey(addDays(new Date(`${todayKey}T12:00:00`), 1)),
    ).length,
  }
}
