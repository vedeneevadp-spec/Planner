import type { SelfCareItemType, SelfCareTodayItem } from '@planner/contracts'

import type { SelectPickerOption } from '@/shared/ui/SelectPicker'

import {
  getInitialScheduleTime,
  type SelfCareTimePreference,
  shouldUseExactSchedule,
  TIME_GROUP_SELECT_OPTIONS,
  TIME_PREFERENCE_SELECT_OPTIONS,
} from './SelfCarePage.helpers'

export const SELF_CARE_REMINDER_CLEAR_VALUE = 'none'

const SELF_CARE_REMINDER_OFFSET_OPTIONS: ReadonlyArray<{
  label: string
  offsetMinutes: number
  value: string
}> = [
  { label: 'В момент', offsetMinutes: 0, value: '0' },
  { label: '15 мин', offsetMinutes: 15, value: '15' },
  { label: '1 час', offsetMinutes: 60, value: '60' },
  { label: '1 день', offsetMinutes: 1440, value: '1440' },
  { label: '1 неделя', offsetMinutes: 10080, value: '10080' },
  { label: '1 месяц', offsetMinutes: 43200, value: '43200' },
]

export const SELF_CARE_REMINDER_SELECT_OPTIONS: Array<
  SelectPickerOption<string>
> = [
  { label: 'Без оповещения', value: SELF_CARE_REMINDER_CLEAR_VALUE },
  ...SELF_CARE_REMINDER_OFFSET_OPTIONS.map(({ label, value }) => ({
    label,
    value,
  })),
]

const REMINDER_OFFSET_VALUE_BY_MINUTES = new Map(
  SELF_CARE_REMINDER_OFFSET_OPTIONS.map((option) => [
    option.offsetMinutes,
    option.value,
  ]),
)
const REMINDER_OFFSET_MINUTES_BY_VALUE = new Map(
  SELF_CARE_REMINDER_OFFSET_OPTIONS.map((option) => [
    option.value,
    option.offsetMinutes,
  ]),
)

export function getReminderSelectValue(offsets: readonly number[]): string[] {
  return offsets
    .map((offset) => REMINDER_OFFSET_VALUE_BY_MINUTES.get(offset))
    .filter((offset): offset is string => Boolean(offset))
}

export function getReminderOffsetsFromSelectValue(
  values: readonly string[],
): number[] {
  const offsets = values
    .filter((offset) => offset !== SELF_CARE_REMINDER_CLEAR_VALUE)
    .map((offset) => REMINDER_OFFSET_MINUTES_BY_VALUE.get(offset))
    .filter((offset): offset is number => offset !== undefined)

  return [...new Set(offsets)].sort((left, right) => left - right)
}

export function canUseExactTimePreference(type: SelfCareItemType): boolean {
  return type === 'course' || type === 'measurement' || type === 'task'
}

export function hasStoredExactTimePreference(
  entry: SelfCareTodayItem,
  plannerTimeZone: string,
): boolean {
  if (!canUseExactTimePreference(entry.item.type)) {
    return false
  }

  if (entry.scheduleRule?.preferredTime) {
    return true
  }

  if (!shouldUseExactSchedule(entry.item.type)) {
    return false
  }

  const initialScheduleTime = getInitialScheduleTime(entry, plannerTimeZone)

  return initialScheduleTime.length > 0 && initialScheduleTime !== '00:00'
}

export function shouldShowPreferredTimePreference(
  type: SelfCareItemType,
): boolean {
  return type !== 'appointment'
}

export function getTimePreferenceOptions(
  type: SelfCareItemType,
): Array<SelectPickerOption<SelfCareTimePreference>> {
  return canUseExactTimePreference(type)
    ? TIME_PREFERENCE_SELECT_OPTIONS
    : TIME_GROUP_SELECT_OPTIONS
}

export function shouldShowExactScheduleTimeField(
  type: SelfCareItemType,
  usesExactTimePreference: boolean,
): boolean {
  if (type === 'measurement' || type === 'task') {
    return usesExactTimePreference
  }

  return true
}

export function getClientTimeZone(plannerTimeZone: string): string {
  return plannerTimeZone
}

export function getInitialReminderOffsets(entry: SelfCareTodayItem): number[] {
  if (entry.occurrence?.reminderOffsetsMinutes.length) {
    return entry.occurrence.reminderOffsetsMinutes
  }

  return entry.scheduleRule?.reminderOffsetsMinutes ?? []
}

export function areNumberArraysEqual(
  left: readonly number[],
  right: readonly number[],
): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}
