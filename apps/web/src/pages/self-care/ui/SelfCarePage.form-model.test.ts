import type { SelfCareItemType, SelfCareTodayItem } from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  areNumberArraysEqual,
  canUseExactTimePreference,
  getInitialReminderOffsets,
  getReminderOffsetsFromSelectValue,
  getReminderSelectValue,
  getTimePreferenceOptions,
  hasStoredExactTimePreference,
  shouldShowExactScheduleTimeField,
  shouldShowPreferredTimePreference,
} from './SelfCarePage.form-model'

describe('SelfCarePage form model', () => {
  it('maps reminder offsets to select values and back deterministically', () => {
    expect(getReminderSelectValue([60, 999, 15, 0])).toEqual(['60', '15', '0'])
    expect(
      getReminderOffsetsFromSelectValue(['none', '60', 'unknown', '15', '60']),
    ).toEqual([15, 60])
  })

  it('keeps exact time preference rules by self-care type explicit', () => {
    expect(canUseExactTimePreference('task')).toBe(true)
    expect(canUseExactTimePreference('course')).toBe(true)
    expect(canUseExactTimePreference('measurement')).toBe(true)
    expect(canUseExactTimePreference('appointment')).toBe(false)

    expect(shouldShowPreferredTimePreference('appointment')).toBe(false)
    expect(shouldShowPreferredTimePreference('task')).toBe(true)

    expect(shouldShowExactScheduleTimeField('measurement', false)).toBe(false)
    expect(shouldShowExactScheduleTimeField('measurement', true)).toBe(true)
    expect(shouldShowExactScheduleTimeField('appointment', false)).toBe(true)

    expect(
      getTimePreferenceOptions('task').map((option) => option.value),
    ).toContain('exact')
    expect(
      getTimePreferenceOptions('appointment').map((option) => option.value),
    ).not.toContain('exact')
  })

  it('detects stored exact-time preference only for supported item types', () => {
    expect(
      hasStoredExactTimePreference(
        createTodayEntry('task', { preferredTime: '09:30' }),
        'Europe/Samara',
      ),
    ).toBe(true)
    expect(
      hasStoredExactTimePreference(
        createTodayEntry('appointment', { preferredTime: '09:30' }),
        'Europe/Samara',
      ),
    ).toBe(false)
    expect(
      hasStoredExactTimePreference(
        createTodayEntry('measurement', { preferredTime: null }),
        'Europe/Samara',
      ),
    ).toBe(false)
  })

  it('uses occurrence reminder offsets before schedule rule offsets', () => {
    expect(
      getInitialReminderOffsets(
        createTodayEntry('task', {
          occurrenceReminderOffsets: [15],
          reminderOffsets: [60],
        }),
      ),
    ).toEqual([15])
    expect(
      getInitialReminderOffsets(
        createTodayEntry('task', {
          occurrenceReminderOffsets: [],
          reminderOffsets: [60],
        }),
      ),
    ).toEqual([60])
    expect(areNumberArraysEqual([15, 60], [15, 60])).toBe(true)
    expect(areNumberArraysEqual([60, 15], [15, 60])).toBe(false)
  })
})

function createTodayEntry(
  type: SelfCareItemType,
  options: {
    occurrenceReminderOffsets?: number[] | undefined
    preferredTime?: string | null | undefined
    reminderOffsets?: number[] | undefined
  } = {},
): SelfCareTodayItem {
  return {
    item: {
      type,
    },
    occurrence:
      options.occurrenceReminderOffsets === undefined
        ? null
        : {
            reminderOffsetsMinutes: options.occurrenceReminderOffsets,
          },
    scheduleRule: {
      preferredTime: options.preferredTime ?? null,
      reminderOffsetsMinutes: options.reminderOffsets ?? [],
    },
  } as SelfCareTodayItem
}
