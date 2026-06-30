import type { SelfCareItemType, SelfCareTodayItem } from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  areNumberArraysEqual,
  buildSelfCareCustomCreatePayload,
  buildSelfCareEditPayload,
  canUseExactTimePreference,
  getInitialReminderOffsets,
  getReminderOffsetsFromSelectValue,
  getReminderSelectValue,
  getSelfCareCustomCreateFormModel,
  getTimePreferenceOptions,
  hasStoredExactTimePreference,
  type SelfCareCustomCreateFormDraft,
  type SelfCareEditFormDraft,
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

  it('builds custom create payloads outside the UI component', () => {
    const payload = buildSelfCareCustomCreatePayload(
      createCustomCreateDraft({
        detailsPlace: 'Клиника',
        detailsPrice: '1500',
        detailsSpecialist: 'Доктор',
        preferredTimePreference: 'exact',
        reminderOffsetsMinutes: [60],
        scheduledDate: '2026-07-01',
        scheduledTime: '10:30',
        title: ' Стоматолог ',
        type: 'appointment',
      }),
    )

    expect(payload?.input.title).toBe('Стоматолог')
    expect(payload?.input.type).toBe('appointment')
    expect(payload?.input.appointmentDetails).toMatchObject({
      place: 'Клиника',
      price: 1500,
      specialistName: 'Доктор',
    })
    expect(payload?.input.scheduleRule).toMatchObject({
      preferredTime: null,
      reminderOffsetsMinutes: [],
      startDate: '2026-07-01',
      timezone: 'Europe/Samara',
    })
    expect(payload?.scheduleInput).toMatchObject({
      place: 'Клиника',
      price: 1500,
      reminderOffsetsMinutes: [60],
      scheduledFor: '2026-07-01',
      scheduledTime: '10:30',
    })
  })

  it('keeps create validation in the form model', () => {
    const draft = createCustomCreateDraft({
      measurementUnit: '',
      title: 'Вес',
      type: 'measurement',
    })

    expect(getSelfCareCustomCreateFormModel(draft).canSubmit).toBe(false)
    expect(buildSelfCareCustomCreatePayload(draft)).toBeNull()
  })

  it('builds edit payloads outside the UI component', () => {
    const payload = buildSelfCareEditPayload(
      createEditDraft({
        entry: createEditEntry('task', {
          preferredTime: null,
          reminderOffsets: [],
        }),
        preferredTimePreference: 'exact',
        reminderOffsetsMinutes: [15],
        scheduledDate: '2026-07-02',
        scheduledTime: '08:15',
        title: ' Витамины ',
      }),
    )

    expect(payload?.input).toMatchObject({
      expectedVersion: 7,
      title: 'Витамины',
    })
    expect(payload?.input.scheduleRule).toMatchObject({
      preferredTime: '08:15',
      reminderOffsetsMinutes: [15],
      repeatKind: 'daily',
      startDate: '2026-06-30',
    })
    expect(payload?.scheduleInput).toMatchObject({
      reminderOffsetsMinutes: [15],
      scheduledFor: '2026-07-02',
      scheduledTime: '08:15',
    })
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
  } as unknown as SelfCareTodayItem
}

function createCustomCreateDraft(
  overrides: Partial<SelfCareCustomCreateFormDraft> = {},
): SelfCareCustomCreateFormDraft {
  return {
    category: 'custom',
    courseBreakDays: '7',
    courseRepeatMode: 'once',
    courseScheduleMode: 'daily',
    courseTotalCount: '30',
    courseType: 'days',
    dayOfMonth: '30',
    daysOfWeek: [2],
    defaultCurrency: 'RUB',
    description: '',
    detailsContact: '',
    detailsPlace: '',
    detailsPrice: '',
    detailsSpecialist: '',
    exerciseMetricValue: 'count:reps',
    exercisePlannedSets: '3',
    exercisePlannedValue: '',
    exerciseUseSets: false,
    flexiblePeriod: 'week',
    flexibleTargetCount: '3',
    icon: '',
    intervalUnit: 'week',
    intervalValue: '4',
    measurementUnit: 'кг',
    measurementValueLabel: 'Значение',
    monthOfYear: '6',
    plannerTimeZone: 'Europe/Samara',
    preferredTimePreference: 'anytime',
    reminderOffsetsMinutes: [],
    repeatKind: 'none',
    scheduledDate: '2026-06-30',
    scheduledTime: '',
    stepsText: '',
    title: 'Забота',
    todayKey: '2026-06-30',
    type: 'task',
    ...overrides,
  }
}

function createEditDraft(
  overrides: Partial<SelfCareEditFormDraft> = {},
): SelfCareEditFormDraft {
  const entry = overrides.entry ?? createEditEntry('task')

  return {
    category: entry.item.category,
    courseBreakDays: '7',
    courseRepeatMode: 'once',
    courseScheduleMode: 'keep',
    courseTotalCount: '30',
    courseType: 'days',
    dayOfMonth: '30',
    daysOfWeek: [2],
    description: entry.item.description,
    entry,
    exerciseMetricValue: 'count:reps',
    exercisePlannedSets: '3',
    exercisePlannedValue: '',
    exerciseUseSets: false,
    flexiblePeriod: 'week',
    flexibleTargetCount: '3',
    icon: '',
    intervalUnit: 'week',
    intervalValue: '4',
    measurementUnit: 'кг',
    measurementValueLabel: 'Значение',
    monthOfYear: '6',
    plannerTimeZone: 'Europe/Samara',
    preferredTimePreference: 'anytime',
    procedureContact: '',
    procedureCurrency: 'RUB',
    procedurePlace: '',
    procedurePrice: '',
    procedureSpecialist: '',
    reminderOffsetsMinutes: [],
    repeatMode: 'keep',
    scheduledDate: '2026-06-30',
    scheduledTime: '',
    stepsText: '',
    title: entry.item.title,
    todayKey: '2026-06-30',
    ...overrides,
  }
}

function createEditEntry(
  type: SelfCareItemType,
  options: {
    preferredTime?: string | null | undefined
    reminderOffsets?: number[] | undefined
  } = {},
): SelfCareTodayItem {
  return {
    appointment: null,
    courseDetails: null,
    exercise: null,
    item: {
      category: 'custom',
      description: '',
      icon: null,
      preferredTimeOfDay: 'anytime',
      title: 'Забота',
      type,
      version: 7,
    },
    measurement: null,
    occurrence: null,
    procedure: null,
    scheduleRule: {
      allowMultiplePerDay: false,
      dayOfMonth: null,
      daysOfWeek: [],
      endDate: null,
      flexiblePeriod: null,
      flexibleTargetCount: null,
      generateInCalendar: false,
      generateInTaskList: true,
      intervalUnit: null,
      intervalValue: null,
      monthOfYear: null,
      preferredTime: options.preferredTime ?? null,
      reminderOffsetsMinutes: options.reminderOffsets ?? [],
      repeatKind: 'daily',
      startDate: '2026-06-30',
      timezone: 'Europe/Samara',
      weekOfMonth: null,
    },
    steps: [],
  } as unknown as SelfCareTodayItem
}
