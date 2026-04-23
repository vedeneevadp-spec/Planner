import type { Task } from './task.types'

export const DEFAULT_TASK_RESOURCE = 2
export const MIN_TASK_RESOURCE = 1
export const MAX_TASK_RESOURCE = 5

function clampTaskResource(value: number): number {
  return Math.max(MIN_TASK_RESOURCE, Math.min(MAX_TASK_RESOURCE, value))
}

function parseTimeMinutes(value: string | null): number | null {
  if (!value) {
    return null
  }

  const [hoursRaw, minutesRaw] = value.split(':')
  const hours = Number(hoursRaw)
  const minutes = Number(minutesRaw)

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null
  }

  return hours * 60 + minutes
}

function getScheduledDurationMinutes(
  task: Pick<Task, 'plannedEndTime' | 'plannedStartTime'>,
): number | null {
  const startMinutes = parseTimeMinutes(task.plannedStartTime)
  const endMinutes = parseTimeMinutes(task.plannedEndTime)

  if (
    startMinutes === null ||
    endMinutes === null ||
    endMinutes <= startMinutes
  ) {
    return null
  }

  return endMinutes - startMinutes
}

export function getTaskResource(
  task: Pick<
    Task,
    | 'importance'
    | 'note'
    | 'plannedEndTime'
    | 'plannedStartTime'
    | 'resource'
    | 'title'
    | 'urgency'
  >,
): number {
  if (task.resource !== null) {
    return task.resource
  }

  let resource = DEFAULT_TASK_RESOURCE
  const durationMinutes = getScheduledDurationMinutes(task)

  if (task.importance === 'important') {
    resource += 1
  }

  if (task.urgency === 'urgent') {
    resource += 1
  }

  if (durationMinutes !== null && durationMinutes >= 180) {
    resource += 1
  }

  if (durationMinutes !== null && durationMinutes >= 300) {
    resource += 1
  }

  if (`${task.title} ${task.note}`.length >= 300) {
    resource += 1
  }

  return clampTaskResource(resource)
}
