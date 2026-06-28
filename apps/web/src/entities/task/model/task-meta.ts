import { clampTaskResource } from './resource'
import type { NewTaskInput, Task } from './task.types'

export type TaskTypeValue = '' | 'important' | 'routine' | 'habit'
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

export const TASK_NECESSITY_LABELS: Record<Task['necessity'], string> = {
  desired: 'Желательно',
  optional: 'По возможности',
  required: 'Обязательно',
}

export function getTaskTypeValue(
  value:
    | Pick<Task, 'importance' | 'routine' | 'urgency'>
    | Pick<NewTaskInput, 'importance' | 'routine' | 'urgency'>,
): TaskTypeValue {
  if (value.routine) {
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

export function getTaskNecessityLabel(necessity: Task['necessity']): string {
  return TASK_NECESSITY_LABELS[necessity]
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
