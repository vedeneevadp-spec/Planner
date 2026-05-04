import { clampTaskResource } from './resource'
import type { NewTaskInput, Task } from './task.types'

export type TaskTypeValue = '' | 'important' | 'routine'
export type ResourceValue =
  | ''
  | '-1'
  | '-2'
  | '-3'
  | '-4'
  | '1'
  | '2'
  | '3'
  | '4'

export function getTaskTypeValue(
  value:
    | Pick<Task, 'importance' | 'urgency'>
    | Pick<NewTaskInput, 'importance' | 'urgency'>,
): TaskTypeValue {
  if (value.urgency === 'urgent') {
    return 'routine'
  }

  if (value.importance === 'important') {
    return 'important'
  }

  return ''
}

export function getTaskImportanceFromType(
  taskType: TaskTypeValue,
): Task['importance'] {
  return taskType === 'important' ? 'important' : 'not_important'
}

export function getTaskUrgencyFromType(
  taskType: TaskTypeValue,
): Task['urgency'] {
  return taskType === 'routine' ? 'urgent' : 'not_urgent'
}

export function getResourceFromValue(value: ResourceValue): Task['resource'] {
  return value ? clampTaskResource(Number(value)) : 0
}

export function getResourceValueFromTaskResource(
  value: Task['resource'],
): ResourceValue {
  if (value === null || value === 0) {
    return ''
  }

  return String(clampTaskResource(value)) as Exclude<ResourceValue, ''>
}
