import type {
  HabitEntryRecord,
  HabitRecord,
  HabitTargetType,
} from '@planner/contracts'

export const isoWeekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function getHabitFrequencyLabel(habit: HabitRecord): string {
  if (habit.frequency === 'daily') {
    return 'каждый день'
  }

  if (habit.frequency === 'weekly') {
    return 'по будням'
  }

  return habit.daysOfWeek.map((day) => isoWeekdayLabels[day - 1]).join(', ')
}

export function getHabitTargetLabel(
  targetType: HabitTargetType,
  targetValue: number,
  unit: string,
): string {
  if (targetType === 'check') {
    return 'отметка'
  }

  if (targetType === 'duration') {
    return `${targetValue} мин`
  }

  return `${targetValue}${unit ? ` ${unit}` : ''}`
}

export function getHabitEntryValueLabel(
  habit: HabitRecord,
  entry: HabitEntryRecord | null,
): string {
  if (!entry) {
    return getHabitTargetLabel(habit.targetType, habit.targetValue, habit.unit)
  }

  if (entry.status === 'skipped') {
    return 'пропуск'
  }

  if (habit.targetType === 'check') {
    return 'готово'
  }

  if (habit.targetType === 'duration') {
    return `${entry.value} мин`
  }

  return `${entry.value}${habit.unit ? ` ${habit.unit}` : ''}`
}

export function sortHabits(habits: HabitRecord[]): HabitRecord[] {
  return [...habits].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder
    }

    return left.title.localeCompare(right.title, 'ru')
  })
}
