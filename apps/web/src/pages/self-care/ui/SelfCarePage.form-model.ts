import type {
  SelfCareCategory,
  SelfCareFlexiblePeriod,
  SelfCareIntervalUnit,
  SelfCareItemType,
  SelfCareItemUpdateInput,
  SelfCareTimeOfDay,
  SelfCareTodayItem,
} from '@planner/contracts'

import type { SelectPickerOption } from '@/shared/ui/SelectPicker'

import {
  buildCreateScheduleRule,
  buildDateTimeInput,
  getCourseVisibleRepeatKind,
  getCreateScheduleRepeatKind,
  getExerciseMetricOption,
  getInitialFlexibleGoalRepeatMode,
  getInitialScheduleTime,
  getVisibleRepeatKind,
  normalizeOptionalText,
  parseBoundedInteger,
  parseMultilineTitles,
  parseNonnegativeInteger,
  parseOptionalMeasurementNumber,
  parseOptionalPrice,
  parsePositiveInteger,
  repeatKindRequiresInterval,
  type SelfCareCourseEditScheduleMode,
  type SelfCareCourseRepeatMode,
  type SelfCareCourseScheduleMode,
  type SelfCareCourseType,
  type SelfCareCreateRepeatKind,
  type SelfCareCustomCreatePayload,
  type SelfCareEditRepeatMode,
  type SelfCareEditSubmitPayload,
  type SelfCareStandardRepeatKind,
  type SelfCareTimePreference,
  shouldShowVisitDetails,
  shouldUseExactSchedule,
  TIME_GROUP_SELECT_OPTIONS,
  TIME_PREFERENCE_SELECT_OPTIONS,
} from './SelfCarePage.helpers'
import { getDatePart } from './SelfCarePage.schedule'

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
  return (
    type === 'course' ||
    type === 'exercise' ||
    type === 'measurement' ||
    type === 'task'
  )
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
  if (type === 'exercise' || type === 'measurement' || type === 'task') {
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

type SelfCareExerciseMetric = ReturnType<typeof getExerciseMetricOption>

export type SelfCareCustomCreateFormDraft = {
  category: SelfCareCategory
  courseBreakDays: string
  courseRepeatMode: SelfCareCourseRepeatMode
  courseScheduleMode: SelfCareCourseScheduleMode
  courseTotalCount: string
  courseType: SelfCareCourseType
  dayOfMonth: string
  daysOfWeek: number[]
  defaultCurrency: string
  description: string
  detailsContact: string
  detailsPlace: string
  detailsPrice: string
  detailsSpecialist: string
  exerciseMetricValue: string
  exercisePlannedSets: string
  exercisePlannedValue: string
  exerciseUseSets: boolean
  flexiblePeriod: SelfCareFlexiblePeriod
  flexibleTargetCount: string
  icon: string
  intervalUnit: SelfCareIntervalUnit
  intervalValue: string
  measurementUnit: string
  measurementValueLabel: string
  monthOfYear: string
  plannerTimeZone: string
  preferredTimePreference: SelfCareTimePreference
  reminderOffsetsMinutes: number[]
  repeatKind: SelfCareStandardRepeatKind
  scheduledDate: string
  scheduledTime: string
  stepsText: string
  title: string
  todayKey: string
  type: SelfCareItemType
}

export type SelfCareCustomCreateFormModel = {
  canSubmit: boolean
  courseBreakDaysNumber: number | null
  courseTotalNumber: number | null
  dayOfMonthNumber: number | null
  exerciseMetric: SelfCareExerciseMetric
  exercisePlannedNumber: number | null
  exercisePlannedSetsNumber: number | null
  flexibleTargetNumber: number | null
  intervalNumber: number | null
  monthOfYearNumber: number | null
  needsInterval: boolean
  preferredTimeOfDay: SelfCareTimeOfDay | null
  scheduleRepeatKind: SelfCareCreateRepeatKind
  showCourseExactTimeField: boolean
  showExactScheduleTimeField: boolean
  showPreferredTimePreference: boolean
  usesExactSchedule: boolean
  usesExactTimePreference: boolean
  usesFlexibleGoalRepeat: boolean
  visibleRepeatKind: SelfCareCreateRepeatKind
}

export function getSelfCareCustomCreateFormModel(
  draft: SelfCareCustomCreateFormDraft,
): SelfCareCustomCreateFormModel {
  const showPreferredTimePreference = shouldShowPreferredTimePreference(
    draft.type,
  )
  const usesExactTimePreference =
    canUseExactTimePreference(draft.type) &&
    draft.preferredTimePreference === 'exact'
  const showExactScheduleTimeField = shouldShowExactScheduleTimeField(
    draft.type,
    usesExactTimePreference,
  )
  const showCourseExactTimeField =
    draft.type === 'course' && usesExactTimePreference
  const intervalNumber = parsePositiveInteger(draft.intervalValue)
  const flexibleTargetNumber = parsePositiveInteger(draft.flexibleTargetCount)
  const courseTotalNumber = parsePositiveInteger(draft.courseTotalCount)
  const courseBreakDaysNumber = parseNonnegativeInteger(draft.courseBreakDays)
  const exercisePlannedNumber = parseOptionalMeasurementNumber(
    draft.exercisePlannedValue,
  )
  const exercisePlannedSetsNumber = parsePositiveInteger(
    draft.exercisePlannedSets,
  )
  const exerciseMetric = getExerciseMetricOption(draft.exerciseMetricValue)
  const preferredTimeOfDay: SelfCareTimeOfDay | null =
    showPreferredTimePreference && draft.preferredTimePreference !== 'exact'
      ? draft.preferredTimePreference
      : null
  const usesExactSchedule = shouldUseExactSchedule(draft.type)
  const dayOfMonthNumber = parseBoundedInteger(draft.dayOfMonth, 1, 31)
  const monthOfYearNumber = parseBoundedInteger(draft.monthOfYear, 1, 12)
  const scheduleRepeatKind = getCreateScheduleRepeatKind(
    draft.type,
    draft.repeatKind,
  )
  const visibleRepeatKind = getVisibleRepeatKind(draft.type, draft.repeatKind, {
    courseScheduleMode: draft.courseScheduleMode,
  })
  const needsInterval =
    repeatKindRequiresInterval(scheduleRepeatKind) ||
    (draft.type === 'course' && draft.courseScheduleMode === 'interval')
  const usesFlexibleGoalRepeat = draft.type === 'flexible_goal'
  const canSubmit =
    draft.title.trim().length > 0 &&
    (!needsInterval || Boolean(intervalNumber)) &&
    (usesFlexibleGoalRepeat ||
      visibleRepeatKind !== 'weekly' ||
      draft.daysOfWeek.length > 0) &&
    (usesFlexibleGoalRepeat ||
      visibleRepeatKind !== 'monthly' ||
      Boolean(dayOfMonthNumber)) &&
    (usesFlexibleGoalRepeat ||
      visibleRepeatKind !== 'yearly' ||
      (Boolean(dayOfMonthNumber) && Boolean(monthOfYearNumber))) &&
    (draft.type !== 'flexible_goal' || Boolean(flexibleTargetNumber)) &&
    (draft.type !== 'course' || Boolean(courseTotalNumber)) &&
    (draft.type !== 'course' ||
      draft.courseRepeatMode !== 'cycle' ||
      courseBreakDaysNumber !== null) &&
    (draft.type !== 'exercise' ||
      !draft.exerciseUseSets ||
      Boolean(exercisePlannedSetsNumber)) &&
    (!usesExactSchedule || draft.scheduledDate.length > 0) &&
    (!usesExactTimePreference || draft.scheduledTime.length > 0) &&
    (!(usesExactSchedule && showExactScheduleTimeField) ||
      draft.reminderOffsetsMinutes.length === 0 ||
      draft.scheduledTime.length > 0) &&
    (draft.type !== 'measurement' || draft.measurementUnit.trim().length > 0)

  return {
    canSubmit,
    courseBreakDaysNumber,
    courseTotalNumber,
    dayOfMonthNumber,
    exerciseMetric,
    exercisePlannedNumber,
    exercisePlannedSetsNumber,
    flexibleTargetNumber,
    intervalNumber,
    monthOfYearNumber,
    needsInterval,
    preferredTimeOfDay,
    scheduleRepeatKind,
    showCourseExactTimeField,
    showExactScheduleTimeField,
    showPreferredTimePreference,
    usesExactSchedule,
    usesExactTimePreference,
    usesFlexibleGoalRepeat,
    visibleRepeatKind,
  }
}

export function buildSelfCareCustomCreatePayload(
  draft: SelfCareCustomCreateFormDraft,
): SelfCareCustomCreatePayload | null {
  const model = getSelfCareCustomCreateFormModel(draft)

  if (!model.canSubmit) {
    return null
  }

  const detailsPriceValue = parseOptionalPrice(draft.detailsPrice)
  const defaultDetailsCurrency = normalizeOptionalText(draft.defaultCurrency)
  const normalizedScheduledTime = normalizeOptionalText(draft.scheduledTime)
  const normalizedExactTime = model.usesExactTimePreference
    ? normalizedScheduledTime
    : null
  const reminderTimeZone = getClientTimeZone(draft.plannerTimeZone)
  const reminderOffsetsForExactTime = normalizedExactTime
    ? draft.reminderOffsetsMinutes
    : []
  const canStoreVisitDetails = shouldShowVisitDetails(draft.type)
  const scheduleRule =
    draft.type === 'task' && model.scheduleRepeatKind === 'none'
      ? undefined
      : buildCreateScheduleRule({
          courseScheduleMode:
            draft.type === 'course' ? draft.courseScheduleMode : undefined,
          dayOfMonth:
            model.dayOfMonthNumber ?? getDatePart(draft.todayKey, 'day'),
          daysOfWeek: draft.daysOfWeek,
          flexiblePeriod: draft.flexiblePeriod,
          flexibleTargetCount: model.flexibleTargetNumber ?? 1,
          hasFlexibleGoal: draft.type === 'flexible_goal',
          intervalUnit: draft.intervalUnit,
          intervalValue: model.intervalNumber ?? 1,
          monthOfYear:
            model.monthOfYearNumber ?? getDatePart(draft.todayKey, 'month'),
          preferredTime: normalizedExactTime,
          reminderOffsetsMinutes: reminderOffsetsForExactTime,
          repeatKind: model.scheduleRepeatKind,
          startDate: model.usesExactSchedule
            ? draft.scheduledDate
            : draft.todayKey,
          timezone: reminderTimeZone,
        })
  const scheduledStartsAt = buildDateTimeInput(
    draft.scheduledDate,
    normalizedScheduledTime,
    reminderTimeZone,
  )

  return {
    input: {
      alternatives: [],
      appointmentDetails:
        draft.type === 'appointment'
          ? {
              currency:
                detailsPriceValue === null ? null : defaultDetailsCurrency,
              endsAt: null,
              place: normalizeOptionalText(draft.detailsPlace),
              preparationNote: null,
              price: detailsPriceValue,
              resultNote: null,
              specialistContact: normalizeOptionalText(draft.detailsContact),
              specialistName: normalizeOptionalText(draft.detailsSpecialist),
              startsAt: scheduledStartsAt,
            }
          : undefined,
      category: draft.category,
      color: null,
      courseDetails:
        draft.type === 'course'
          ? {
              breakDays:
                draft.courseRepeatMode === 'cycle'
                  ? (model.courseBreakDaysNumber ?? 0)
                  : 0,
              completedCount: 0,
              courseType: draft.courseType,
              endDate: null,
              isCompleted: false,
              isPaused: false,
              repeatAfterCompletion: draft.courseRepeatMode === 'cycle',
              startDate: draft.todayKey,
              totalCount: model.courseTotalNumber ?? 1,
            }
          : undefined,
      customCategoryId: null,
      defaultDurationMinutes: null,
      description: draft.description.trim(),
      exerciseDetails:
        draft.type === 'exercise'
          ? {
              metricType: model.exerciseMetric.metricType,
              plannedSets:
                draft.exerciseUseSets && model.exercisePlannedSetsNumber
                  ? model.exercisePlannedSetsNumber
                  : null,
              plannedValue: model.exercisePlannedNumber,
              unit: model.exerciseMetric.unit,
              useSets: draft.exerciseUseSets,
            }
          : undefined,
      icon: normalizeOptionalText(draft.icon),
      importance: 'recommended',
      isActive: true,
      isArchived: false,
      isPrivate: true,
      measurementDetails:
        draft.type === 'measurement'
          ? {
              targetMax: null,
              targetMin: null,
              unit: draft.measurementUnit.trim(),
              valueLabel: draft.measurementValueLabel.trim() || 'Значение',
            }
          : undefined,
      medicalDetails:
        draft.type === 'medical'
          ? {
              analysisList: [],
              clinicAddress: normalizeOptionalText(draft.detailsPlace),
              clinicName: null,
              documentUrls: [],
              doctorName: normalizeOptionalText(draft.detailsSpecialist),
              nextControlDate: draft.scheduledDate || null,
              phone: normalizeOptionalText(draft.detailsContact),
              reminderStrategy: 'soft',
              resultNote: null,
              website: null,
            }
          : undefined,
      migratedFromHabitId: null,
      preferredTimeOfDay: model.preferredTimeOfDay,
      procedureDetails:
        draft.type === 'procedure'
          ? {
              contact: normalizeOptionalText(draft.detailsContact),
              currency: defaultDetailsCurrency,
              defaultPrice: detailsPriceValue,
              place: normalizeOptionalText(draft.detailsPlace),
              specialistName: normalizeOptionalText(draft.detailsSpecialist),
            }
          : undefined,
      scheduleRule,
      steps:
        draft.type === 'ritual'
          ? parseMultilineTitles(draft.stepsText).map((stepTitle, index) => ({
              defaultChecked: false,
              isOptional: false,
              order: index,
              title: stepTitle,
            }))
          : [],
      title: draft.title.trim(),
      type: draft.type,
    },
    scheduleInput: model.usesExactSchedule
      ? {
          currency:
            !canStoreVisitDetails || detailsPriceValue === null
              ? null
              : defaultDetailsCurrency,
          note: '',
          place: canStoreVisitDetails
            ? normalizeOptionalText(draft.detailsPlace)
            : null,
          price: canStoreVisitDetails ? detailsPriceValue : null,
          reminderOffsetsMinutes:
            model.showExactScheduleTimeField && normalizedScheduledTime
              ? draft.reminderOffsetsMinutes
              : [],
          scheduledFor: draft.scheduledDate,
          scheduledTime: model.showExactScheduleTimeField
            ? normalizedScheduledTime
            : null,
          specialistContact: canStoreVisitDetails
            ? normalizeOptionalText(draft.detailsContact)
            : null,
          specialistName: canStoreVisitDetails
            ? normalizeOptionalText(draft.detailsSpecialist)
            : null,
          timezone: reminderTimeZone,
        }
      : undefined,
  }
}

export type SelfCareEditFormDraft = {
  category: SelfCareCategory
  courseBreakDays: string
  courseRepeatMode: SelfCareCourseRepeatMode
  courseScheduleMode: SelfCareCourseEditScheduleMode
  courseTotalCount: string
  courseType: SelfCareCourseType
  dayOfMonth: string
  daysOfWeek: number[]
  description: string
  entry: SelfCareTodayItem
  exerciseMetricValue: string
  exercisePlannedSets: string
  exercisePlannedValue: string
  exerciseUseSets: boolean
  flexiblePeriod: SelfCareFlexiblePeriod
  flexibleTargetCount: string
  icon: string
  intervalUnit: SelfCareIntervalUnit
  intervalValue: string
  measurementUnit: string
  measurementValueLabel: string
  monthOfYear: string
  plannerTimeZone: string
  preferredTimePreference: SelfCareTimePreference
  procedureContact: string
  procedureCurrency: string
  procedurePlace: string
  procedurePrice: string
  procedureSpecialist: string
  reminderOffsetsMinutes: number[]
  repeatMode: SelfCareEditRepeatMode
  scheduledDate: string
  scheduledTime: string
  stepsText: string
  title: string
  todayKey: string
}

export type SelfCareEditFormModel = {
  canStoreVisitDetails: boolean
  canSubmit: boolean
  courseBreakDaysNumber: number | null
  courseTotalNumber: number | null
  dayOfMonthNumber: number | null
  editVisibleRepeatKind: SelfCareCreateRepeatKind | null
  exerciseMetric: SelfCareExerciseMetric
  exercisePlannedNumber: number | null
  exercisePlannedSetsNumber: number | null
  flexibleTargetNumber: number | null
  intervalNumber: number | null
  isFlexibleGoal: boolean
  monthOfYearNumber: number | null
  preferredTimeOfDay: SelfCareTimeOfDay | null
  selectedCourseScheduleMode: SelfCareCourseScheduleMode | null
  selectedRepeatKind: SelfCareStandardRepeatKind | null
  showCourseExactTimeField: boolean
  showExactScheduleTimeField: boolean
  showPreferredTimePreference: boolean
  usesExactSchedule: boolean
  usesExactTimePreference: boolean
  usesFlexibleGoalRepeat: boolean
}

export function getSelfCareEditFormModel(
  draft: SelfCareEditFormDraft,
): SelfCareEditFormModel {
  const intervalNumber = parsePositiveInteger(draft.intervalValue)
  const flexibleTargetNumber = parsePositiveInteger(draft.flexibleTargetCount)
  const courseTotalNumber = parsePositiveInteger(draft.courseTotalCount)
  const courseBreakDaysNumber = parseNonnegativeInteger(draft.courseBreakDays)
  const exercisePlannedNumber = parseOptionalMeasurementNumber(
    draft.exercisePlannedValue,
  )
  const exercisePlannedSetsNumber = parsePositiveInteger(
    draft.exercisePlannedSets,
  )
  const exerciseMetric = getExerciseMetricOption(draft.exerciseMetricValue)
  const showPreferredTimePreference = shouldShowPreferredTimePreference(
    draft.entry.item.type,
  )
  const usesExactTimePreference =
    canUseExactTimePreference(draft.entry.item.type) &&
    draft.preferredTimePreference === 'exact'
  const showExactScheduleTimeField = shouldShowExactScheduleTimeField(
    draft.entry.item.type,
    usesExactTimePreference,
  )
  const showCourseExactTimeField =
    draft.entry.item.type === 'course' && usesExactTimePreference
  const preferredTimeOfDay: SelfCareTimeOfDay | null =
    showPreferredTimePreference && draft.preferredTimePreference !== 'exact'
      ? draft.preferredTimePreference
      : null
  const dayOfMonthNumber = parseBoundedInteger(draft.dayOfMonth, 1, 31)
  const monthOfYearNumber = parseBoundedInteger(draft.monthOfYear, 1, 12)
  const selectedRepeatKind =
    draft.repeatMode === 'keep' ? null : draft.repeatMode
  const selectedCourseScheduleMode =
    draft.courseScheduleMode === 'keep' ? null : draft.courseScheduleMode
  const isFlexibleGoal = draft.entry.item.type === 'flexible_goal'
  const usesFlexibleGoalRepeat = draft.entry.item.type === 'flexible_goal'
  const editVisibleRepeatKind = selectedCourseScheduleMode
    ? getCourseVisibleRepeatKind(selectedCourseScheduleMode)
    : selectedRepeatKind
  const usesExactSchedule = shouldUseExactSchedule(draft.entry.item.type)
  const canStoreVisitDetails = shouldShowVisitDetails(draft.entry.item.type)
  const canSubmit =
    draft.title.trim().length > 0 &&
    (!usesExactSchedule || draft.scheduledDate.length > 0) &&
    (!editVisibleRepeatKind ||
      ((!(
        repeatKindRequiresInterval(editVisibleRepeatKind) ||
        selectedCourseScheduleMode === 'interval'
      ) ||
        Boolean(intervalNumber)) &&
        (usesFlexibleGoalRepeat ||
          editVisibleRepeatKind !== 'weekly' ||
          draft.daysOfWeek.length > 0) &&
        (usesFlexibleGoalRepeat ||
          editVisibleRepeatKind !== 'monthly' ||
          Boolean(dayOfMonthNumber)) &&
        (usesFlexibleGoalRepeat ||
          editVisibleRepeatKind !== 'yearly' ||
          (Boolean(dayOfMonthNumber) && Boolean(monthOfYearNumber))) &&
        (draft.entry.item.type !== 'flexible_goal' ||
          Boolean(flexibleTargetNumber)))) &&
    (!isFlexibleGoal || Boolean(flexibleTargetNumber)) &&
    (draft.entry.item.type !== 'course' || Boolean(courseTotalNumber)) &&
    (draft.entry.item.type !== 'course' ||
      draft.courseRepeatMode !== 'cycle' ||
      courseBreakDaysNumber !== null) &&
    (draft.entry.item.type !== 'exercise' ||
      !draft.exerciseUseSets ||
      Boolean(exercisePlannedSetsNumber)) &&
    (!usesExactTimePreference || draft.scheduledTime.length > 0) &&
    (!(usesExactSchedule && showExactScheduleTimeField) ||
      draft.reminderOffsetsMinutes.length === 0 ||
      draft.scheduledTime.length > 0) &&
    (draft.entry.item.type !== 'measurement' ||
      draft.measurementUnit.trim().length > 0)

  return {
    canStoreVisitDetails,
    canSubmit,
    courseBreakDaysNumber,
    courseTotalNumber,
    dayOfMonthNumber,
    editVisibleRepeatKind,
    exerciseMetric,
    exercisePlannedNumber,
    exercisePlannedSetsNumber,
    flexibleTargetNumber,
    intervalNumber,
    isFlexibleGoal,
    monthOfYearNumber,
    preferredTimeOfDay,
    selectedCourseScheduleMode,
    selectedRepeatKind,
    showCourseExactTimeField,
    showExactScheduleTimeField,
    showPreferredTimePreference,
    usesExactSchedule,
    usesExactTimePreference,
    usesFlexibleGoalRepeat,
  }
}

export function buildSelfCareEditPayload(
  draft: SelfCareEditFormDraft,
): SelfCareEditSubmitPayload | null {
  const model = getSelfCareEditFormModel(draft)

  if (!model.canSubmit) {
    return null
  }

  const detailsPriceValue = parseOptionalPrice(draft.procedurePrice)
  const normalizedProcedureCurrency = normalizeOptionalText(
    draft.procedureCurrency,
  )
  const normalizedScheduledTime = normalizeOptionalText(draft.scheduledTime)
  const normalizedExactTime = model.usesExactTimePreference
    ? normalizedScheduledTime
    : null
  const reminderOffsetsForExactTime = normalizedExactTime
    ? draft.reminderOffsetsMinutes
    : []
  const reminderTimeZone = getClientTimeZone(draft.plannerTimeZone)
  const input: SelfCareItemUpdateInput = {
    category: draft.category,
    description: draft.description.trim(),
    expectedVersion: draft.entry.item.version,
    icon: normalizeOptionalText(draft.icon),
    minimumVersion: null,
    preferredTimeOfDay: model.preferredTimeOfDay,
    title: draft.title.trim(),
  }

  if (draft.entry.item.type === 'course' && model.selectedCourseScheduleMode) {
    input.scheduleRule = buildCreateScheduleRule({
      courseScheduleMode: model.selectedCourseScheduleMode,
      dayOfMonth: model.dayOfMonthNumber ?? getDatePart(draft.todayKey, 'day'),
      daysOfWeek: draft.daysOfWeek,
      flexiblePeriod: draft.flexiblePeriod,
      flexibleTargetCount: model.flexibleTargetNumber ?? 1,
      hasFlexibleGoal: false,
      intervalUnit: draft.intervalUnit,
      intervalValue: model.intervalNumber ?? 1,
      monthOfYear:
        model.monthOfYearNumber ?? getDatePart(draft.todayKey, 'month'),
      preferredTime: normalizedExactTime,
      reminderOffsetsMinutes: reminderOffsetsForExactTime,
      repeatKind: 'course',
      startDate: draft.entry.scheduleRule?.startDate ?? draft.todayKey,
      timezone: reminderTimeZone,
    })
  } else if (draft.entry.item.type === 'flexible_goal') {
    const flexibleRepeatKind =
      model.selectedRepeatKind ??
      (draft.entry.scheduleRule?.repeatKind === 'flexible_goal'
        ? 'flexible_goal'
        : getInitialFlexibleGoalRepeatMode(draft.entry.scheduleRule))
    input.isActive = true
    input.scheduleRule = buildCreateScheduleRule({
      dayOfMonth: model.dayOfMonthNumber ?? getDatePart(draft.todayKey, 'day'),
      daysOfWeek: draft.daysOfWeek,
      flexiblePeriod: draft.flexiblePeriod,
      flexibleTargetCount: model.flexibleTargetNumber ?? 1,
      hasFlexibleGoal: true,
      intervalUnit: draft.intervalUnit,
      intervalValue: model.intervalNumber ?? 1,
      monthOfYear:
        model.monthOfYearNumber ?? getDatePart(draft.todayKey, 'month'),
      repeatKind: flexibleRepeatKind,
      startDate: draft.entry.scheduleRule?.startDate ?? draft.todayKey,
    })
  } else if (model.selectedRepeatKind) {
    input.scheduleRule = buildCreateScheduleRule({
      dayOfMonth: model.dayOfMonthNumber ?? getDatePart(draft.todayKey, 'day'),
      daysOfWeek: draft.daysOfWeek,
      flexiblePeriod: draft.flexiblePeriod,
      flexibleTargetCount: model.flexibleTargetNumber ?? 1,
      hasFlexibleGoal: false,
      intervalUnit: draft.intervalUnit,
      intervalValue: model.intervalNumber ?? 1,
      monthOfYear:
        model.monthOfYearNumber ?? getDatePart(draft.todayKey, 'month'),
      preferredTime: normalizedExactTime,
      reminderOffsetsMinutes: reminderOffsetsForExactTime,
      repeatKind: model.selectedRepeatKind,
      startDate: model.usesExactSchedule
        ? draft.scheduledDate
        : (draft.entry.scheduleRule?.startDate ?? draft.todayKey),
      timezone: reminderTimeZone,
    })
  }

  if (
    canUseExactTimePreference(draft.entry.item.type) &&
    !model.selectedRepeatKind &&
    !(draft.entry.item.type === 'course' && model.selectedCourseScheduleMode) &&
    draft.entry.scheduleRule &&
    ((draft.entry.scheduleRule?.preferredTime ?? null) !==
      normalizedExactTime ||
      !areNumberArraysEqual(
        draft.entry.scheduleRule?.reminderOffsetsMinutes ?? [],
        reminderOffsetsForExactTime,
      ))
  ) {
    input.scheduleRule = {
      allowMultiplePerDay:
        draft.entry.scheduleRule?.allowMultiplePerDay ?? false,
      dayOfMonth: draft.entry.scheduleRule?.dayOfMonth ?? null,
      daysOfWeek: draft.entry.scheduleRule?.daysOfWeek ?? [],
      endDate: draft.entry.scheduleRule?.endDate ?? null,
      flexiblePeriod: draft.entry.scheduleRule?.flexiblePeriod ?? null,
      flexibleTargetCount:
        draft.entry.scheduleRule?.flexibleTargetCount ?? null,
      generateInCalendar: draft.entry.scheduleRule?.generateInCalendar ?? false,
      generateInTaskList: draft.entry.scheduleRule?.generateInTaskList ?? true,
      intervalUnit: draft.entry.scheduleRule?.intervalUnit ?? null,
      intervalValue: draft.entry.scheduleRule?.intervalValue ?? null,
      monthOfYear: draft.entry.scheduleRule?.monthOfYear ?? null,
      preferredTime: normalizedExactTime,
      reminderOffsetsMinutes: reminderOffsetsForExactTime,
      repeatKind: draft.entry.scheduleRule?.repeatKind ?? 'daily',
      startDate: draft.entry.scheduleRule?.startDate ?? draft.scheduledDate,
      timezone: reminderTimeZone ?? draft.entry.scheduleRule?.timezone ?? null,
      weekOfMonth: draft.entry.scheduleRule?.weekOfMonth ?? null,
    }
  }

  if (draft.entry.item.type === 'ritual') {
    input.steps = parseMultilineTitles(draft.stepsText).map(
      (stepTitle, index) => ({
        defaultChecked: false,
        isOptional: false,
        order: index,
        title: stepTitle,
      }),
    )
  }

  if (draft.entry.item.type === 'course') {
    input.courseDetails = {
      breakDays:
        draft.courseRepeatMode === 'cycle'
          ? (model.courseBreakDaysNumber ?? 0)
          : 0,
      completedCount: draft.entry.courseDetails?.completedCount ?? 0,
      courseType: draft.courseType,
      endDate: draft.entry.courseDetails?.endDate ?? null,
      isCompleted: draft.entry.courseDetails?.isCompleted ?? false,
      isPaused: draft.entry.courseDetails?.isPaused ?? false,
      repeatAfterCompletion: draft.courseRepeatMode === 'cycle',
      startDate:
        draft.entry.courseDetails?.startDate ??
        draft.entry.scheduleRule?.startDate ??
        draft.todayKey,
      totalCount:
        model.courseTotalNumber ?? draft.entry.courseDetails?.totalCount ?? 1,
    }
  }

  if (draft.entry.item.type === 'procedure') {
    input.procedureDetails = {
      contact: normalizeOptionalText(draft.procedureContact),
      currency: normalizedProcedureCurrency,
      defaultPrice: detailsPriceValue,
      place: normalizeOptionalText(draft.procedurePlace),
      specialistName: normalizeOptionalText(draft.procedureSpecialist),
    }
  }

  if (draft.entry.item.type === 'measurement') {
    input.measurementDetails = {
      targetMax: null,
      targetMin: null,
      unit: draft.measurementUnit.trim(),
      valueLabel: draft.measurementValueLabel.trim() || 'Значение',
    }
  }

  if (draft.entry.item.type === 'exercise') {
    input.exerciseDetails = {
      metricType: model.exerciseMetric.metricType,
      plannedSets:
        draft.exerciseUseSets && model.exercisePlannedSetsNumber
          ? model.exercisePlannedSetsNumber
          : null,
      plannedValue: model.exercisePlannedNumber,
      unit: model.exerciseMetric.unit,
      useSets: draft.exerciseUseSets,
    }
  }

  return {
    input,
    scheduleInput: model.usesExactSchedule
      ? {
          currency:
            !model.canStoreVisitDetails || detailsPriceValue === null
              ? null
              : normalizedProcedureCurrency,
          note: model.canStoreVisitDetails
            ? (draft.entry.appointment?.preparationNote ?? '')
            : '',
          place: model.canStoreVisitDetails
            ? normalizeOptionalText(draft.procedurePlace)
            : null,
          price: model.canStoreVisitDetails ? detailsPriceValue : null,
          reminderOffsetsMinutes:
            model.showExactScheduleTimeField && normalizedScheduledTime
              ? draft.reminderOffsetsMinutes
              : [],
          scheduledFor: draft.scheduledDate,
          scheduledTime: model.showExactScheduleTimeField
            ? normalizedScheduledTime
            : null,
          specialistContact: model.canStoreVisitDetails
            ? normalizeOptionalText(draft.procedureContact)
            : null,
          specialistName: model.canStoreVisitDetails
            ? normalizeOptionalText(draft.procedureSpecialist)
            : null,
          timezone: reminderTimeZone,
        }
      : undefined,
  }
}
