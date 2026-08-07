import {
  generateUuidV7,
  type SelfCareCompletion,
  type SelfCareCourseDetails,
  type SelfCareHistoryResponse,
  type SelfCareItem,
  type SelfCareItemScheduleInput,
  type SelfCareListResponse,
  type SelfCareOccurrence,
  type SelfCareOfflineCommand,
  type SelfCareTodayItem,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import {
  createOptimisticSelfCareResult,
  type SelfCareOptimisticSource,
} from './self-care-offline-command'
import { projectSelfCareRead } from './self-care-offline-projection'

const OCCURRED_AT = '2026-08-06T10:00:00.000Z'
const ITEM_ID = 'self-care-course-1'
const OCCURRENCE_ID = 'self-care-occurrence-1'

describe('optimistic self-care commands', () => {
  it('updates a same-date occurrence in place without creating move history', () => {
    const source = createSource()
    const input = createScheduleInput({
      note: 'Вход со двора',
      reminderOffsetsMinutes: [30, 120],
      scheduledTime: '18:30',
      specialistName: 'Анна',
      timezone: 'Europe/Samara',
    })
    const command: SelfCareOfflineCommand = {
      existingOccurrenceId: OCCURRENCE_ID,
      expectedOccurrenceVersion: 4,
      expectedVersion: 7,
      input,
      itemId: ITEM_ID,
      type: 'schedule_item',
    }

    const result = createOptimisticSelfCareResult(command, source)

    expect(result).toMatchObject({
      kind: 'occurrence',
      occurrence: {
        id: OCCURRENCE_ID,
        itemId: ITEM_ID,
        movedTo: null,
        reminderOffsetsMinutes: [30, 120],
        reminderTimeZone: 'Europe/Samara',
        scheduledFor: '2026-08-07',
        status: 'scheduled',
        updatedAt: OCCURRED_AT,
        version: 5,
      },
    })

    const history = projectSelfCareRead(
      'history',
      ['2026-08-01', '2026-08-31'],
      source.history!,
      {
        command,
        operationId: generateUuidV7(),
        result,
        sequence: 1,
        status: 'pending',
      },
    ) as SelfCareHistoryResponse

    expect(history.completions).toEqual([])
    expect(history.items).toEqual([source.list!.items[0]])
  })

  it('does not consume an item version when a scheduled course occurrence completes', () => {
    const source = createSource()
    const command: SelfCareOfflineCommand = {
      completionId: generateUuidV7(),
      expectedVersion: 4,
      input: {
        alternativeTitle: null,
        completedAt: OCCURRED_AT,
        completedVariant: 'full',
        currency: null,
        durationMinutes: null,
        energyAfter: null,
        energyBefore: null,
        exerciseSets: [],
        measurementUnit: null,
        measurementValue: null,
        moodAfter: null,
        moodBefore: null,
        note: '',
        price: null,
        status: 'done',
        steps: [],
      },
      occurrenceId: OCCURRENCE_ID,
      type: 'complete_occurrence',
    }

    const result = createOptimisticSelfCareResult(command, source)

    expect(result.kind).toBe('completion')
    if (result.kind !== 'completion') {
      throw new Error('Expected a completion result.')
    }

    expect(result.item).toBeUndefined()
    expect(result.courseDetails).toMatchObject({
      completedCount: 2,
      isCompleted: false,
    })
    expect(source.list?.items[0]?.version).toBe(7)
  })
})

function createSource(): SelfCareOptimisticSource {
  const item = createItem()
  const occurrence = createOccurrence()
  const courseDetails = createCourseDetails()
  const entry = createEntry(item, occurrence, courseDetails)
  const list: SelfCareListResponse = {
    alternatives: [],
    appointmentDetails: [],
    courseDetails: [courseDetails],
    exerciseDetails: [],
    items: [item],
    medicalDetails: [],
    measurementDetails: [],
    procedureDetails: [],
    scheduleRules: [],
    steps: [],
  }

  return {
    actorUserId: 'user-1',
    dashboard: {
      dailyState: null,
      date: '2026-08-07',
      flexibleGoals: [],
      gentleMode: false,
      minimumItems: [],
      overdueItems: [],
      planningHints: [],
      settings: createSettings(),
      todayItems: [entry],
      upcomingImportant: [],
    },
    drafts: undefined,
    history: {
      appointmentDetails: [],
      completions: [] as SelfCareCompletion[],
      items: [item],
      procedureDetails: [],
      stepCompletions: [],
    },
    list,
    occurredAt: OCCURRED_AT,
    plan: {
      courses: [entry],
      from: '2026-08-01',
      medical: [],
      occurrences: [entry],
      planningHints: [],
      to: '2026-08-31',
    },
    settings: {
      minimumItems: [],
      settings: createSettings(),
    },
    templates: undefined,
    workspaceId: 'workspace-1',
  }
}

function createItem(): SelfCareItem {
  return {
    category: 'health',
    color: null,
    createdAt: '2026-08-01T08:00:00.000Z',
    createdFromTemplateId: null,
    customCategoryId: null,
    defaultDurationMinutes: null,
    deletedAt: null,
    description: '',
    icon: null,
    id: ITEM_ID,
    importance: 'recommended',
    isActive: true,
    isArchived: false,
    isPrivate: true,
    migratedFromHabitId: null,
    minimumVersionDescription: null,
    minimumVersionDurationMinutes: null,
    minimumVersionTitle: null,
    preferredTimeOfDay: 'evening',
    title: 'Курс массажа',
    type: 'course',
    updatedAt: '2026-08-05T08:00:00.000Z',
    userId: 'user-1',
    version: 7,
    workspaceId: 'workspace-1',
  }
}

function createOccurrence(): SelfCareOccurrence {
  return {
    completedAt: null,
    createdAt: '2026-08-01T08:00:00.000Z',
    dueAt: null,
    generatedAt: '2026-08-01T08:00:00.000Z',
    id: OCCURRENCE_ID,
    itemId: ITEM_ID,
    movedTo: null,
    reminderOffsetsMinutes: [60],
    reminderTimeZone: 'Europe/Samara',
    scheduledFor: '2026-08-07',
    scheduleRuleId: null,
    status: 'scheduled',
    updatedAt: '2026-08-05T08:00:00.000Z',
    userId: 'user-1',
    version: 4,
  }
}

function createCourseDetails(): SelfCareCourseDetails {
  return {
    breakDays: 0,
    completedCount: 1,
    courseType: 'sessions',
    createdAt: '2026-08-01T08:00:00.000Z',
    endDate: null,
    id: 'course-details-1',
    isCompleted: false,
    isPaused: false,
    itemId: ITEM_ID,
    repeatAfterCompletion: false,
    startDate: '2026-08-01',
    totalCount: 3,
    updatedAt: '2026-08-05T08:00:00.000Z',
  }
}

function createEntry(
  item: SelfCareItem,
  occurrence: SelfCareOccurrence,
  courseDetails: SelfCareCourseDetails,
): SelfCareTodayItem {
  return {
    appointment: null,
    completion: null,
    courseDetails,
    exercise: null,
    flexibleProgress: null,
    item,
    lastExercise: null,
    lastMeasurement: null,
    measurement: null,
    occurrence,
    procedure: null,
    scheduleRule: null,
    steps: [],
    timeGroup: 'evening',
  }
}

function createScheduleInput(
  overrides: Partial<SelfCareItemScheduleInput> = {},
): SelfCareItemScheduleInput {
  return {
    currency: 'RUB',
    note: '',
    place: 'Клиника',
    price: 3200,
    reminderOffsetsMinutes: [60],
    scheduledFor: '2026-08-07',
    scheduledTime: '18:00',
    specialistContact: null,
    specialistName: null,
    timezone: 'Europe/Samara',
    ...overrides,
  }
}

function createSettings() {
  return {
    createdAt: '2026-08-01T08:00:00.000Z',
    currency: 'RUB',
    defaultReminderTone: 'soft' as const,
    gentleModeDate: null,
    gentleModeEnabledToday: false,
    id: 'settings-1',
    quietHoursEnd: null,
    quietHoursStart: null,
    showAppointmentsInCalendar: true,
    showSelfCareInMainTasks: true,
    updatedAt: '2026-08-05T08:00:00.000Z',
    userId: 'user-1',
    version: 5,
  }
}
