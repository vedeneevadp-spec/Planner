import { generateUuidV7 } from '@planner/contracts'

import type { TaskRecurrence, TaskRecurrenceFrequency } from './task.types'

export const TASK_RECURRENCE_DEFAULT_DAYS = [1, 2, 3, 4, 5, 6, 7]
export const TASK_RECURRENCE_WEEKDAYS = [1, 2, 3, 4, 5]
export const taskRecurrenceWeekdayLabels = [
  'Пн',
  'Вт',
  'Ср',
  'Чт',
  'Пт',
  'Сб',
  'Вс',
]

export interface TaskRecurrenceFormState {
  daysOfWeek: number[]
  endDate: string
  frequency: TaskRecurrenceFrequency
  interval: number
  isEnabled: boolean
}

export function createDefaultTaskRecurrenceForm(): TaskRecurrenceFormState {
  return {
    daysOfWeek: [...TASK_RECURRENCE_DEFAULT_DAYS],
    endDate: '',
    frequency: 'daily',
    interval: 1,
    isEnabled: false,
  }
}

export function createTaskRecurrenceFormFromRecurrence(
  recurrence: TaskRecurrence | null | undefined,
): TaskRecurrenceFormState {
  if (!recurrence) {
    return createDefaultTaskRecurrenceForm()
  }

  return {
    daysOfWeek: recurrence.daysOfWeek,
    endDate: recurrence.endDate ?? '',
    frequency: recurrence.frequency,
    interval: recurrence.interval ?? 1,
    isEnabled: recurrence.isActive,
  }
}

export function buildTaskRecurrenceFromForm(
  form: TaskRecurrenceFormState,
  startDate: string,
  seriesId?: string,
): TaskRecurrence | null {
  if (!form.isEnabled) {
    return null
  }

  return {
    daysOfWeek: resolveTaskRecurrenceDaysOfWeek(form),
    endDate: form.endDate || null,
    frequency: form.frequency,
    interval: normalizeTaskRecurrenceInterval(form.interval),
    isActive: true,
    seriesId: seriesId ?? generateUuidV7(),
    startDate,
  }
}

function normalizeTaskRecurrenceInterval(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : 1
}

export function resolveTaskRecurrenceDaysOfWeek(
  form: Pick<TaskRecurrenceFormState, 'daysOfWeek' | 'frequency'>,
): number[] {
  if (form.frequency === 'daily' || form.frequency === 'monthly') {
    return [...TASK_RECURRENCE_DEFAULT_DAYS]
  }

  if (form.frequency === 'weekly') {
    return [...TASK_RECURRENCE_WEEKDAYS]
  }

  return form.daysOfWeek.length > 0
    ? [...new Set(form.daysOfWeek)].sort((left, right) => left - right)
    : [...TASK_RECURRENCE_DEFAULT_DAYS]
}

export function getTaskRecurrenceLabel(
  recurrence: Pick<TaskRecurrence, 'daysOfWeek' | 'frequency' | 'interval'>,
): string {
  if (recurrence.frequency === 'daily') {
    return recurrence.interval === 1
      ? 'каждый день'
      : `каждые ${recurrence.interval} дн.`
  }

  if (recurrence.frequency === 'weekly') {
    return recurrence.interval === 1
      ? 'по будням'
      : `по будням каждые ${recurrence.interval} нед.`
  }

  if (recurrence.frequency === 'monthly') {
    return recurrence.interval === 1
      ? 'каждый месяц'
      : `каждые ${recurrence.interval} мес.`
  }

  const daysLabel = recurrence.daysOfWeek
    .map((day) => taskRecurrenceWeekdayLabels[day - 1])
    .join(', ')

  return recurrence.interval === 1
    ? daysLabel
    : `${daysLabel}, каждые ${recurrence.interval} нед.`
}
