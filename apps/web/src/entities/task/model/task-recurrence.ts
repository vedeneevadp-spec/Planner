import type { HabitFrequency } from '@planner/contracts'
import { generateUuidV7 } from '@planner/contracts'

import type { TaskRecurrence } from './task.types'

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
  frequency: HabitFrequency
  isEnabled: boolean
}

export function createDefaultTaskRecurrenceForm(): TaskRecurrenceFormState {
  return {
    daysOfWeek: [...TASK_RECURRENCE_DEFAULT_DAYS],
    endDate: '',
    frequency: 'daily',
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
    isActive: true,
    seriesId: seriesId ?? generateUuidV7(),
    startDate,
  }
}

export function resolveTaskRecurrenceDaysOfWeek(
  form: Pick<TaskRecurrenceFormState, 'daysOfWeek' | 'frequency'>,
): number[] {
  if (form.frequency === 'daily') {
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
  recurrence: Pick<TaskRecurrence, 'daysOfWeek' | 'frequency'>,
): string {
  if (recurrence.frequency === 'daily') {
    return 'каждый день'
  }

  if (recurrence.frequency === 'weekly') {
    return 'по будням'
  }

  return recurrence.daysOfWeek
    .map((day) => taskRecurrenceWeekdayLabels[day - 1])
    .join(', ')
}
