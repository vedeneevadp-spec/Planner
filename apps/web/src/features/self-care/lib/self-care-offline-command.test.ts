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
  type SelfCareOfflineCommandResult,
  type SelfCareTodayItem,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import type { SelfCareOfflineOverlay } from './offline-self-care-store'
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

  it('keeps a flexible goal visible and advances its progress exactly once', () => {
    const item = createItem({
      id: 'water',
      title: 'Вода',
      type: 'flexible_goal',
    })
    const entry: SelfCareTodayItem = {
      ...createEntry(item, createOccurrence({ itemId: item.id }), null),
      flexibleProgress: {
        completedCount: 1,
        periodEnd: '2026-08-09',
        periodStart: '2026-08-03',
        remainingCount: 2,
        targetCount: 3,
      },
      occurrence: null,
    }
    const source = createSourceForEntry(entry, 'flexible')
    const command: Extract<
      SelfCareOfflineCommand,
      { type: 'complete_flexible_goal' }
    > = {
      completionId: generateUuidV7(),
      expectedVersion: item.version,
      input: createSimpleCompletionInput(),
      itemId: item.id,
      type: 'complete_flexible_goal',
    }
    const result = createOptimisticSelfCareResult(command, source)
    const projected = projectDashboard(source, command, result)
    const projectedEntry = projected.flexibleGoals[0]!

    expect(projectedEntry.completion).toBeNull()
    expect(projectedEntry.flexibleProgress).toMatchObject({
      completedCount: 2,
      remainingCount: 1,
      targetCount: 3,
    })
    expect(projectedEntry.item.isActive).toBe(true)

    const repeated = projectSelfCareRead(
      'dashboard',
      [],
      projected,
      createOverlay(command, result),
    ) as NonNullable<SelfCareOptimisticSource['dashboard']>

    expect(repeated.flexibleGoals[0]?.flexibleProgress?.completedCount).toBe(2)
    expect(repeated.flexibleGoals[0]?.completion).toBeNull()
  })

  it('keeps partial exercise progress on the scheduled card', () => {
    const item = createItem({
      id: 'push-ups',
      title: 'Отжимания',
      type: 'exercise',
    })
    const occurrence = createOccurrence({ itemId: item.id })
    const entry = createEntry(item, occurrence, null)
    const source = createSourceForEntry(entry)
    const command: Extract<
      SelfCareOfflineCommand,
      { type: 'complete_item_now' }
    > = {
      completionId: generateUuidV7(),
      expectedVersion: item.version,
      input: createRitualCompletionInput({
        completedVariant: null,
        exerciseSets: [
          { index: 1, value: 10 },
          { index: 2, value: 10 },
          { index: 3, value: 10 },
        ],
        measurementUnit: 'reps',
        measurementValue: 30,
        status: 'partial',
      }),
      itemId: item.id,
      type: 'complete_item_now',
    }
    const result = createOptimisticSelfCareResult(command, source)
    const projected = projectDashboard(source, command, result)
    const projectedEntry = projected.todayItems[0]!

    expect(projectedEntry.completion).toBeNull()
    expect(projectedEntry.occurrence).toEqual(occurrence)
    expect(projectedEntry.lastExercise).toMatchObject({
      exerciseSets: [
        { index: 1, value: 10 },
        { index: 2, value: 10 },
        { index: 3, value: 10 },
      ],
      measurementValue: 30,
      status: 'partial',
    })
    expect(projectedEntry.occurrence?.status).toBe('scheduled')

    const repeated = projectSelfCareRead(
      'dashboard',
      [],
      projected,
      createOverlay(command, result),
    ) as NonNullable<SelfCareOptimisticSource['dashboard']>

    expect(repeated.todayItems[0]?.occurrence).toEqual(occurrence)
    expect(repeated.todayItems[0]?.lastExercise?.exerciseSets).toHaveLength(3)
  })

  it('still closes a card when its concrete occurrence is completed', () => {
    const item = createItem({ id: 'measurement', type: 'measurement' })
    const occurrence = createOccurrence({ itemId: item.id })
    const entry = createEntry(item, occurrence, null)
    const source = createSourceForEntry(entry)
    const command: Extract<
      SelfCareOfflineCommand,
      { type: 'complete_occurrence' }
    > = {
      completionId: generateUuidV7(),
      expectedVersion: occurrence.version,
      input: createRitualCompletionInput({
        measurementUnit: 'kg',
        measurementValue: 62,
      }),
      occurrenceId: occurrence.id,
      type: 'complete_occurrence',
    }
    const result = createOptimisticSelfCareResult(command, source)
    const projectedEntry = projectDashboard(source, command, result)
      .todayItems[0]!

    expect(projectedEntry.completion?.id).toBe(command.completionId)
    expect(projectedEntry.lastMeasurement?.measurementValue).toBe(62)
    expect(projectedEntry.occurrence).toMatchObject({
      completedAt: OCCURRED_AT,
      status: 'done',
      version: occurrence.version + 1,
    })
  })

  it('advances an ad-hoc course without closing an unrelated occurrence', () => {
    const item = createItem()
    const courseDetails = createCourseDetails()
    const occurrence = createOccurrence()
    const entry = createEntry(item, occurrence, courseDetails)
    const source = createSourceForEntry(entry)
    const command: Extract<
      SelfCareOfflineCommand,
      { type: 'complete_course_session' }
    > = {
      completionId: generateUuidV7(),
      expectedVersion: item.version,
      input: createSimpleCompletionInput(),
      itemId: item.id,
      type: 'complete_course_session',
    }
    const result = createOptimisticSelfCareResult(command, source)
    const projected = projectDashboard(source, command, result)
    const projectedEntry = projected.todayItems[0]!

    expect(projectedEntry.completion).toBeNull()
    expect(projectedEntry.occurrence).toEqual(occurrence)
    expect(projectedEntry.courseDetails).toMatchObject({
      completedCount: 2,
      isCompleted: false,
    })

    const repeated = projectSelfCareRead(
      'dashboard',
      [],
      projected,
      createOverlay(command, result),
    ) as NonNullable<SelfCareOptimisticSource['dashboard']>

    expect(repeated.todayItems[0]?.courseDetails?.completedCount).toBe(2)
  })

  it('edits item-level exercise progress without closing its card', () => {
    const item = createItem({
      id: 'push-ups',
      title: 'Отжимания',
      type: 'exercise',
    })
    const occurrence = createOccurrence({ itemId: item.id })
    const previous = createCompletion({
      exerciseSets: [
        { index: 1, value: 10 },
        { index: 2, value: 10 },
      ],
      itemId: item.id,
      measurementUnit: 'reps',
      measurementValue: 20,
      occurrenceId: null,
      status: 'partial',
    })
    const entry: SelfCareTodayItem = {
      ...createEntry(item, occurrence, null),
      lastExercise: previous,
    }
    const source = createSourceForEntry(entry)
    source.history!.completions = [previous]
    const command: Extract<
      SelfCareOfflineCommand,
      { type: 'update_completion' }
    > = {
      completionId: previous.id,
      expectedVersion: previous.version,
      input: {
        exerciseSets: [
          { index: 1, value: 12 },
          { index: 2, value: 12 },
        ],
        measurementValue: 24,
      },
      type: 'update_completion',
    }
    const result = createOptimisticSelfCareResult(command, source)
    const projectedEntry = projectDashboard(source, command, result)
      .todayItems[0]!

    expect(projectedEntry.completion).toBeNull()
    expect(projectedEntry.occurrence).toEqual(occurrence)
    expect(projectedEntry.lastExercise).toMatchObject({
      measurementValue: 24,
      version: previous.version + 1,
    })
    expect(projectedEntry.occurrence?.status).toBe('scheduled')
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

function createItem(overrides: Partial<SelfCareItem> = {}): SelfCareItem {
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
    ...overrides,
  }
}

function createOccurrence(
  overrides: Partial<SelfCareOccurrence> = {},
): SelfCareOccurrence {
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
    ...overrides,
  }
}

function createCourseDetails(
  overrides: Partial<SelfCareCourseDetails> = {},
): SelfCareCourseDetails {
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
    ...overrides,
  }
}

function createEntry(
  item: SelfCareItem,
  occurrence: SelfCareOccurrence | null,
  courseDetails: SelfCareCourseDetails | null,
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

function createSourceForEntry(
  entry: SelfCareTodayItem,
  placement: 'flexible' | 'today' = 'today',
): SelfCareOptimisticSource {
  const source = createSource()

  source.dashboard = {
    ...source.dashboard!,
    flexibleGoals: placement === 'flexible' ? [entry] : [],
    todayItems: placement === 'today' ? [entry] : [],
  }
  source.history = {
    ...source.history!,
    completions: [],
    items: [entry.item],
  }
  source.list = {
    ...source.list!,
    courseDetails: entry.courseDetails ? [entry.courseDetails] : [],
    items: [entry.item],
  }
  source.plan = {
    ...source.plan!,
    courses: entry.item.type === 'course' ? [entry] : [],
    occurrences: entry.occurrence ? [entry] : [],
  }

  return source
}

function projectDashboard(
  source: SelfCareOptimisticSource,
  command: SelfCareOfflineCommand,
  result: SelfCareOfflineCommandResult,
): NonNullable<SelfCareOptimisticSource['dashboard']> {
  return projectSelfCareRead(
    'dashboard',
    [],
    source.dashboard!,
    createOverlay(command, result),
  ) as NonNullable<SelfCareOptimisticSource['dashboard']>
}

function createOverlay(
  command: SelfCareOfflineCommand,
  result: SelfCareOfflineCommandResult,
): SelfCareOfflineOverlay {
  return {
    command,
    operationId: generateUuidV7(),
    result,
    sequence: 1,
    status: 'pending',
  }
}

function createRitualCompletionInput(
  overrides: Partial<
    Extract<SelfCareOfflineCommand, { type: 'complete_item_now' }>['input']
  > = {},
): Extract<SelfCareOfflineCommand, { type: 'complete_item_now' }>['input'] {
  return {
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
    ...overrides,
  }
}

function createSimpleCompletionInput(
  overrides: Partial<
    Extract<SelfCareOfflineCommand, { type: 'complete_flexible_goal' }>['input']
  > = {},
): Extract<
  SelfCareOfflineCommand,
  { type: 'complete_flexible_goal' }
>['input'] {
  const { steps: _steps, ...input } = createRitualCompletionInput(overrides)

  return input
}

function createCompletion(
  overrides: Partial<SelfCareCompletion> = {},
): SelfCareCompletion {
  return {
    alternativeTitle: null,
    completedAt: OCCURRED_AT,
    completedVariant: null,
    createdAt: OCCURRED_AT,
    currency: null,
    durationMinutes: null,
    energyAfter: null,
    energyBefore: null,
    exerciseSets: [],
    id: generateUuidV7(),
    itemId: ITEM_ID,
    measurementUnit: null,
    measurementValue: null,
    moodAfter: null,
    moodBefore: null,
    note: '',
    occurrenceId: OCCURRENCE_ID,
    price: null,
    scheduledFor: '2026-08-07',
    status: 'done',
    updatedAt: OCCURRED_AT,
    userId: 'user-1',
    version: 1,
    ...overrides,
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
