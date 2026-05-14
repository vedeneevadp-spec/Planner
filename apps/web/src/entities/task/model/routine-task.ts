import type { HabitFrequency, HabitTargetType } from '@planner/contracts'
import { generateUuidV7 } from '@planner/contracts'

import type { RoutineTask } from './task.types'

export const ROUTINE_TASK_DEFAULT_DAYS = [1, 2, 3, 4, 5, 6, 7]
export const ROUTINE_TASK_WEEKDAYS = [1, 2, 3, 4, 5]
export const routineTaskWeekdayLabels = [
  'Пн',
  'Вт',
  'Ср',
  'Чт',
  'Пт',
  'Сб',
  'Вс',
]

export interface RoutineTaskFormState {
  daysOfWeek: number[]
  frequency: HabitFrequency
  targetType: HabitTargetType
  targetValue: string
  unit: string
}

export function createDefaultRoutineTaskForm(): RoutineTaskFormState {
  return {
    daysOfWeek: [...ROUTINE_TASK_DEFAULT_DAYS],
    frequency: 'daily',
    targetType: 'check',
    targetValue: '1',
    unit: '',
  }
}

export function createRoutineTaskFormFromRoutine(
  routine: RoutineTask | null | undefined,
): RoutineTaskFormState {
  if (!routine) {
    return createDefaultRoutineTaskForm()
  }

  return {
    daysOfWeek: routine.daysOfWeek,
    frequency: routine.frequency,
    targetType: routine.targetType,
    targetValue: String(routine.targetValue),
    unit: routine.unit,
  }
}

export function buildRoutineTaskFromForm(
  form: RoutineTaskFormState,
  seriesId?: string,
): RoutineTask {
  const targetValue = Number(form.targetValue)

  return {
    daysOfWeek: resolveRoutineTaskDaysOfWeek(form),
    frequency: form.frequency,
    seriesId: seriesId ?? generateUuidV7(),
    targetType: form.targetType,
    targetValue:
      Number.isFinite(targetValue) && targetValue > 0 ? targetValue : 1,
    unit: form.targetType === 'count' ? form.unit.trim() : '',
  }
}

export function resolveRoutineTaskDaysOfWeek(
  form: Pick<RoutineTaskFormState, 'daysOfWeek' | 'frequency'>,
): number[] {
  if (form.frequency === 'daily') {
    return [...ROUTINE_TASK_DEFAULT_DAYS]
  }

  if (form.frequency === 'weekly') {
    return [...ROUTINE_TASK_WEEKDAYS]
  }

  return form.daysOfWeek.length > 0
    ? [...new Set(form.daysOfWeek)].sort((left, right) => left - right)
    : [...ROUTINE_TASK_DEFAULT_DAYS]
}

export function getRoutineTaskFrequencyLabel(
  routine: Pick<RoutineTask, 'daysOfWeek' | 'frequency'>,
): string {
  if (routine.frequency === 'daily') {
    return 'каждый день'
  }

  if (routine.frequency === 'weekly') {
    return 'будни'
  }

  return routine.daysOfWeek
    .map((day) => routineTaskWeekdayLabels[day - 1])
    .join(', ')
}
