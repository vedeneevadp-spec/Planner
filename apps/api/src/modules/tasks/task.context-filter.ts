import { getDateKeyInTimeZone, type Task } from '@planner/contracts'

import type { TaskContextFilter } from './task.model.js'

export function matchesTaskContextFilter(
  task: Task,
  filter: TaskContextFilter,
) {
  if (
    (task.authorUserId && task.authorUserId !== filter.userId) ||
    (task.assigneeUserId && task.assigneeUserId !== filter.userId)
  )
    return false

  if (filter.calendarOnly && !(task.plannedDate && task.plannedStartTime))
    return false

  const active = task.status !== 'done' && task.status !== 'archived'
  if (
    filter.highPriorityOnly &&
    task.importance !== 'important' &&
    task.urgency !== 'urgent'
  )
    return false
  const deadline = task.dueDate ?? task.plannedDate
  const overdue = active && Boolean(deadline && deadline < filter.asOfDate)
  if (filter.status === 'done' && task.status !== 'done') return false
  if (filter.status === 'active' && !active) return false
  if (filter.status === 'todo' && (!active || overdue)) return false
  if (filter.status === 'overdue' && !overdue) return false

  const search = filter.search?.trim().toLowerCase()
  if (
    search &&
    ![task.title, task.note, task.project]
      .join(' ')
      .toLowerCase()
      .includes(search)
  )
    return false
  if (!filter.from && !filter.to) return true

  const dates = filter.calendarOnly
    ? [task.plannedDate]
    : task.status === 'done'
      ? [
          task.completedAt
            ? getDateKeyInTimeZone(task.completedAt, filter.timezone)
            : null,
        ]
      : [task.plannedDate, task.dueDate]
  return dates.some(
    (date) =>
      date &&
      (!filter.from || date >= filter.from) &&
      (!filter.to || date <= filter.to),
  )
}
