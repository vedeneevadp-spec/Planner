import {
  generateUuidV7,
  getTodayDate,
  makeFixedZoneDateTime,
  type SelfCareAppointmentDetails,
  type SelfCareAppointmentDetailsInput,
  type SelfCareCompletion,
  type SelfCareCompletionInput,
  type SelfCareCompletionStatus,
  type SelfCareCourseDetails,
  type SelfCareCourseDetailsInput,
  type SelfCareDailyState,
  type SelfCareDailyStateInput,
  type SelfCareExerciseDetails,
  type SelfCareExerciseDetailsInput,
  type SelfCareItem,
  type SelfCareItemInput,
  type SelfCareMeasurementDetails,
  type SelfCareMeasurementDetailsInput,
  type SelfCareMedicalDetails,
  type SelfCareMedicalDetailsInput,
  type SelfCareMinimumItem,
  type SelfCareMinimumItemInput,
  type SelfCareOccurrence,
  type SelfCareProcedureDetails,
  type SelfCareProcedureDetailsInput,
  type SelfCareRitualCompletionInput,
  type SelfCareRitualStep,
  type SelfCareRitualStepCompletion,
  type SelfCareRitualStepInput,
  type SelfCareScheduleRule,
  type SelfCareScheduleRuleInput,
  type SelfCareSettings,
} from '@planner/contracts'

import { normalizeDaysOfWeek } from './self-care.recurrence.js'
import type { CreateSelfCareRecordsResult } from './self-care.shared.js'
const DEFAULT_MINIMUM_TITLES = [
  'вода',
  'еда',
  'умыться',
  'выйти на воздух',
  'лечь спать',
]
export function createSelfCareRecords(
  input: SelfCareItemInput,
  context: {
    actorUserId: string
    clientTimeZone?: string | undefined
    createdFromTemplateId?: string | null | undefined
    workspaceId: string
  },
): CreateSelfCareRecordsResult {
  const now = new Date().toISOString()
  const itemId = input.id ?? generateUuidV7()
  const minimum = input.minimumVersion
  const item: SelfCareItem = {
    category: input.category,
    color: input.color,
    createdAt: now,
    createdFromTemplateId: context.createdFromTemplateId ?? null,
    customCategoryId: input.customCategoryId,
    defaultDurationMinutes: input.defaultDurationMinutes,
    deletedAt: null,
    description: input.description,
    icon: input.icon,
    id: itemId,
    importance: input.importance,
    isActive: input.isActive,
    isArchived: input.isArchived,
    isPrivate: input.isPrivate,
    migratedFromHabitId: input.migratedFromHabitId,
    minimumVersionDescription: minimum?.description || null,
    minimumVersionDurationMinutes: minimum?.durationMinutes ?? null,
    minimumVersionTitle: minimum?.title ?? null,
    pausePeriods: [],
    preferredTimeOfDay: input.preferredTimeOfDay,
    title: input.title,
    type: input.type,
    updatedAt: now,
    userId: context.actorUserId,
    version: 1,
    workspaceId: context.workspaceId,
  }

  return {
    alternatives: input.alternatives.map((alternative) => ({
      countsAsCompletion: alternative.countsAsCompletion,
      description: alternative.description,
      id: alternative.id ?? generateUuidV7(),
      itemId,
      title: alternative.title,
    })),
    appointmentDetails: input.appointmentDetails
      ? createAppointmentDetailsRecord(itemId, input.appointmentDetails, now)
      : null,
    courseDetails: input.courseDetails
      ? createCourseDetailsRecord(itemId, input.courseDetails, now)
      : null,
    exerciseDetails: input.exerciseDetails
      ? createExerciseDetailsRecord(itemId, input.exerciseDetails, now)
      : null,
    item,
    medicalDetails: input.medicalDetails
      ? createMedicalDetailsRecord(itemId, input.medicalDetails, now)
      : null,
    measurementDetails: input.measurementDetails
      ? createMeasurementDetailsRecord(itemId, input.measurementDetails, now)
      : null,
    procedureDetails: input.procedureDetails
      ? createProcedureDetailsRecord(itemId, input.procedureDetails, now)
      : null,
    scheduleRule: input.scheduleRule
      ? createScheduleRuleRecord(itemId, input.scheduleRule, now)
      : inferDefaultScheduleRule(item, now, context.clientTimeZone),
    steps: input.steps.map((step, index) =>
      createRitualStepRecord(itemId, step, index, now),
    ),
  }
}

export function createScheduleRuleRecord(
  itemId: string,
  input: SelfCareScheduleRuleInput,
  now = new Date().toISOString(),
): SelfCareScheduleRule {
  return {
    allowMultiplePerDay: input.allowMultiplePerDay,
    createdAt: now,
    dayOfMonth: input.dayOfMonth,
    daysOfWeek: normalizeDaysOfWeek(input.daysOfWeek),
    endDate: input.endDate,
    flexiblePeriod: input.flexiblePeriod,
    flexibleTargetCount: input.flexibleTargetCount,
    generateInCalendar: input.generateInCalendar,
    generateInTaskList: input.generateInTaskList,
    id: input.id ?? generateUuidV7(),
    intervalUnit: input.intervalUnit,
    intervalValue: input.intervalValue,
    itemId,
    monthOfYear: input.monthOfYear,
    preferredTime: input.preferredTime,
    reminderOffsetsMinutes: normalizeNumbers(input.reminderOffsetsMinutes),
    repeatKind: input.repeatKind,
    startDate: input.startDate,
    timezone: input.timezone,
    updatedAt: now,
    weekOfMonth: input.weekOfMonth,
  }
}

export function createRitualStepRecord(
  itemId: string,
  input: SelfCareRitualStepInput,
  index: number,
  now = new Date().toISOString(),
): SelfCareRitualStep {
  return {
    createdAt: now,
    defaultChecked: input.defaultChecked,
    id: input.id ?? generateUuidV7(),
    isOptional: input.isOptional,
    itemId,
    order: input.order ?? index,
    title: input.title,
    updatedAt: now,
  }
}

export function createProcedureDetailsRecord(
  itemId: string,
  input: SelfCareProcedureDetailsInput,
  now = new Date().toISOString(),
): SelfCareProcedureDetails {
  return {
    contact: input.contact,
    createdAt: now,
    currency: input.currency,
    defaultPrice: input.defaultPrice,
    id: generateUuidV7(),
    itemId,
    place: input.place,
    specialistName: input.specialistName,
    updatedAt: now,
  }
}

export function createAppointmentDetailsRecord(
  itemId: string,
  input: SelfCareAppointmentDetailsInput,
  now = new Date().toISOString(),
): SelfCareAppointmentDetails {
  return {
    createdAt: now,
    currency: input.currency,
    endsAt: input.endsAt,
    id: generateUuidV7(),
    itemId,
    occurrenceId: null,
    place: input.place,
    preparationNote: input.preparationNote,
    price: input.price,
    resultNote: input.resultNote,
    specialistContact: input.specialistContact,
    specialistName: input.specialistName,
    startsAt: input.startsAt,
    updatedAt: now,
  }
}

export function createMedicalDetailsRecord(
  itemId: string,
  input: SelfCareMedicalDetailsInput,
  now = new Date().toISOString(),
): SelfCareMedicalDetails {
  return {
    analysisList: input.analysisList,
    clinicAddress: input.clinicAddress,
    clinicName: input.clinicName,
    createdAt: now,
    documentUrls: input.documentUrls,
    doctorName: input.doctorName,
    id: generateUuidV7(),
    itemId,
    nextControlDate: input.nextControlDate,
    phone: input.phone,
    reminderStrategy: input.reminderStrategy,
    resultNote: input.resultNote,
    updatedAt: now,
    website: input.website,
  }
}

export function createCourseDetailsRecord(
  itemId: string,
  input: SelfCareCourseDetailsInput,
  now = new Date().toISOString(),
): SelfCareCourseDetails {
  return {
    breakDays: input.breakDays,
    completedCount: input.completedCount,
    courseType: input.courseType,
    createdAt: now,
    endDate: input.endDate,
    id: generateUuidV7(),
    isCompleted: input.isCompleted || input.completedCount >= input.totalCount,
    isPaused: input.isPaused,
    itemId,
    repeatAfterCompletion: input.repeatAfterCompletion,
    startDate: input.startDate,
    totalCount: input.totalCount,
    updatedAt: now,
  }
}

export function createMeasurementDetailsRecord(
  itemId: string,
  input: SelfCareMeasurementDetailsInput,
  now = new Date().toISOString(),
): SelfCareMeasurementDetails {
  return {
    createdAt: now,
    id: generateUuidV7(),
    itemId,
    targetMax: input.targetMax,
    targetMin: input.targetMin,
    unit: input.unit,
    updatedAt: now,
    valueLabel: input.valueLabel,
  }
}

export function createExerciseDetailsRecord(
  itemId: string,
  input: SelfCareExerciseDetailsInput,
  now = new Date().toISOString(),
): SelfCareExerciseDetails {
  return {
    createdAt: now,
    id: generateUuidV7(),
    itemId,
    metricType: input.metricType,
    plannedSets: input.plannedSets,
    plannedValue: input.plannedValue,
    unit: input.unit,
    updatedAt: now,
    useSets: input.useSets,
  }
}

export function createDefaultSelfCareSettings(input: {
  date?: string | undefined
  userId: string
}): SelfCareSettings {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    currency: 'RUB',
    defaultReminderTone: 'soft',
    gentleModeDate: null,
    gentleModeEnabledToday: false,
    id: generateUuidV7(),
    quietHoursEnd: '08:00',
    quietHoursStart: '22:00',
    showAppointmentsInCalendar: true,
    showSelfCareInMainTasks: true,
    updatedAt: now,
    userId: input.userId,
    version: 1,
  }
}

export function createDefaultMinimumItems(
  userId: string,
): SelfCareMinimumItem[] {
  const now = new Date().toISOString()

  return DEFAULT_MINIMUM_TITLES.map((title, index) => ({
    createdAt: now,
    id: generateUuidV7(),
    isActive: true,
    linkedItemId: null,
    order: index,
    title,
    updatedAt: now,
    userId,
    version: 1,
  }))
}

export function createMinimumItemRecord(
  input: SelfCareMinimumItemInput,
  context: { index: number; userId: string },
): SelfCareMinimumItem {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    id: input.id ?? generateUuidV7(),
    isActive: input.isActive,
    linkedItemId: input.linkedItemId,
    order: input.order ?? context.index,
    title: input.title,
    updatedAt: now,
    userId: context.userId,
    version: 1,
  }
}

export function createDailyStateRecord(
  date: string,
  input: SelfCareDailyStateInput,
  context: { userId: string },
): SelfCareDailyState {
  const now = new Date().toISOString()

  return {
    createdAt: now,
    date,
    energy: input.energy,
    id: generateUuidV7(),
    mood: input.mood,
    note: input.note,
    pain: input.pain,
    sleepQuality: input.sleepQuality,
    stress: input.stress,
    updatedAt: now,
    userId: context.userId,
    version: 1,
  }
}

export function createCompletionRecord(
  input: SelfCareCompletionInput,
  context: {
    completionId?: string | undefined
    itemId: string
    occurrence?: SelfCareOccurrence | null | undefined
    scheduledFor?: string | null | undefined
    userId: string
  },
): SelfCareCompletion {
  const completedAt = input.completedAt ?? new Date().toISOString()
  const persistedAt = new Date().toISOString()

  return {
    alternativeTitle: input.alternativeTitle,
    completedAt,
    completedVariant: input.completedVariant,
    createdAt: persistedAt,
    currency: input.currency,
    durationMinutes: input.durationMinutes,
    energyAfter: input.energyAfter,
    energyBefore: input.energyBefore,
    exerciseSets: input.exerciseSets,
    id: context.completionId ?? generateUuidV7(),
    itemId: context.itemId,
    measurementUnit: input.measurementUnit ?? null,
    measurementValue: input.measurementValue ?? null,
    moodAfter: input.moodAfter,
    moodBefore: input.moodBefore,
    note: input.note,
    occurrenceId: context.occurrence?.id ?? null,
    price: input.price,
    scheduledFor:
      context.scheduledFor ?? context.occurrence?.scheduledFor ?? null,
    status: input.status,
    updatedAt: persistedAt,
    userId: context.userId,
    version: 1,
  }
}

export function createRitualStepCompletions(
  completionId: string,
  input: SelfCareRitualCompletionInput,
  steps: SelfCareRitualStep[] = [],
): SelfCareRitualStepCompletion[] {
  return input.steps.map((step) => ({
    completionId,
    id: generateUuidV7(),
    isDone: step.isDone,
    stepId: step.stepId,
    stepTitle:
      steps.find((candidate) => candidate.id === step.stepId)?.title ?? null,
    stepOrder:
      steps.find((candidate) => candidate.id === step.stepId)?.order ?? null,
  }))
}

export function inferRitualCompletionStatus(input: {
  requestedStatus: SelfCareCompletionStatus
  stepCompletions: SelfCareRitualStepCompletion[]
  steps: SelfCareRitualStep[]
}): SelfCareCompletionStatus {
  if (input.requestedStatus !== 'done') {
    return input.requestedStatus
  }

  if (input.steps.length === 0 || input.stepCompletions.length === 0) {
    return input.requestedStatus
  }

  const doneStepIds = new Set(
    input.stepCompletions
      .filter((completion) => completion.isDone)
      .map((completion) => completion.stepId),
  )
  const requiredSteps = input.steps.filter((step) => !step.isOptional)

  return requiredSteps.every((step) => doneStepIds.has(step.id))
    ? 'done'
    : 'partial'
}

export function createOccurrenceRecord(input: {
  dueAt: string | null
  item: SelfCareItem
  occurrenceId?: string | undefined
  scheduledFor: string
  scheduleRule: SelfCareScheduleRule | null
}): SelfCareOccurrence {
  const now = new Date().toISOString()

  return {
    completedAt: null,
    createdAt: now,
    dueAt: input.dueAt,
    generatedAt: now,
    id: input.occurrenceId ?? generateUuidV7(),
    itemId: input.item.id,
    movedTo: null,
    reminderOffsetsMinutes: [],
    reminderTimeZone: null,
    scheduledFor: input.scheduledFor,
    scheduleRuleId: input.scheduleRule?.id ?? null,
    status: 'scheduled',
    updatedAt: now,
    userId: input.item.userId,
    version: 1,
  }
}

export function buildSelfCareDueAtInstant(
  dateKey: string,
  preferredTime: string | null,
  timeZone: string | null | undefined,
): string | null {
  if (!preferredTime) {
    return null
  }

  const match = preferredTime.match(/^(\d{2}:\d{2})(?::\d{2})?$/)

  if (!match) {
    return null
  }

  return makeFixedZoneDateTime({
    localDate: dateKey,
    localTime: match[1]!,
    timeZone: timeZone ?? 'UTC',
  }).instantUtc
}

export function updateOccurrenceStatus(
  occurrence: SelfCareOccurrence,
  status: SelfCareOccurrence['status'],
  extra: Partial<Pick<SelfCareOccurrence, 'completedAt' | 'movedTo'>> = {},
): SelfCareOccurrence {
  return {
    ...occurrence,
    ...extra,
    status,
    updatedAt: new Date().toISOString(),
    version: occurrence.version + 1,
  }
}

export function inferDefaultScheduleRule(
  item: SelfCareItem,
  now: string,
  plannerTimeZone: string | undefined,
): SelfCareScheduleRule | null {
  if (item.type === 'appointment' || item.type === 'task') {
    return null
  }

  const startDate = getTodayDate(plannerTimeZone ?? 'UTC')

  if (item.type === 'flexible_goal') {
    return createScheduleRuleRecord(
      item.id,
      {
        allowMultiplePerDay: false,
        dayOfMonth: null,
        daysOfWeek: [],
        endDate: null,
        flexiblePeriod: 'week',
        flexibleTargetCount: 3,
        generateInCalendar: false,
        generateInTaskList: true,
        intervalUnit: null,
        intervalValue: null,
        monthOfYear: null,
        preferredTime: null,
        reminderOffsetsMinutes: [],
        repeatKind: 'flexible_goal',
        startDate,
        timezone: null,
        weekOfMonth: null,
      },
      now,
    )
  }

  return createScheduleRuleRecord(
    item.id,
    {
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
      preferredTime: null,
      reminderOffsetsMinutes: [],
      repeatKind: item.type === 'course' ? 'course' : 'daily',
      startDate,
      timezone: null,
      weekOfMonth: null,
    },
    now,
  )
}

export function normalizeNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((left, right) => left - right)
}
