import type {
  SelfCareAppointmentDetails,
  SelfCareCourseDetails,
  SelfCareDailyState,
  SelfCareExerciseDetails,
  SelfCareItemAlternative,
  SelfCareMeasurementDetails,
  SelfCareMedicalDetails,
  SelfCareMinimumItem,
  SelfCareProcedureDetails,
  SelfCareRitualStep,
  SelfCareRitualStepCompletion,
  SelfCareRitualStepDraft,
  SelfCareScheduleRule,
  SelfCareSettings,
  SelfCareTemplate,
} from '@planner/contracts'
import { type Selectable, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { DatabaseExecutor } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  CompleteSelfCareItemNowCommand,
  ScheduleSelfCareItemCommand,
  StoredSelfCareCompletionRecord,
  StoredSelfCareItemRecord,
  StoredSelfCareOccurrenceRecord,
  StoredSelfCareRitualStepDraftRecord,
} from './self-care.model.js'
import {
  addDays,
  parseJsonArray,
  serializeDate,
  serializeNullableDate,
  serializeNullableTime,
  serializeNullableTimestamp,
  serializeTimestamp,
} from './self-care.shared.js'

export type ItemRow = Selectable<DatabaseSchema['app.self_care_items']>
export type AlternativeRow = Selectable<
  DatabaseSchema['app.self_care_item_alternatives']
>
export type RuleRow = Selectable<DatabaseSchema['app.self_care_schedule_rules']>
export type OccurrenceRow = Selectable<
  DatabaseSchema['app.self_care_occurrences']
>
export type CompletionRow = Selectable<
  DatabaseSchema['app.self_care_completions']
>
export type ExerciseRow = Selectable<
  DatabaseSchema['app.self_care_exercise_details']
>
export type StepRow = Selectable<DatabaseSchema['app.self_care_ritual_steps']>
export type StepCompletionRow = Selectable<
  DatabaseSchema['app.self_care_ritual_step_completions']
>
export type StepDraftRow = Selectable<
  DatabaseSchema['app.self_care_ritual_step_drafts']
>
export type ProcedureRow = Selectable<
  DatabaseSchema['app.self_care_procedure_details']
>
export type AppointmentRow = Selectable<
  DatabaseSchema['app.self_care_appointment_details']
>
export type MedicalRow = Selectable<
  DatabaseSchema['app.self_care_medical_details']
>
export type MeasurementRow = Selectable<
  DatabaseSchema['app.self_care_measurement_details']
>
export type CourseRow = Selectable<
  DatabaseSchema['app.self_care_course_details']
>
export type DailyStateRow = Selectable<
  DatabaseSchema['app.self_care_daily_states']
>
export type TemplateRow = Selectable<DatabaseSchema['app.self_care_templates']>
export type SettingsRow = Selectable<DatabaseSchema['app.self_care_settings']>
export type MinimumRow = Selectable<
  DatabaseSchema['app.self_care_minimum_items']
>

export interface SelfCareDateRange {
  from: string
  to: string
}

export function mapItemRow(row: ItemRow): StoredSelfCareItemRecord {
  return {
    category: row.category,
    color: row.color,
    createdAt: serializeTimestamp(row.created_at),
    createdFromTemplateId: row.created_from_template_id,
    customCategoryId: row.custom_category_id,
    defaultDurationMinutes: row.default_duration_minutes,
    deletedAt: serializeNullableTimestamp(row.deleted_at),
    description: row.description,
    icon: row.icon,
    id: row.id,
    importance: row.importance,
    isActive: row.is_active,
    isArchived: row.is_archived,
    isPrivate: row.is_private,
    migratedFromHabitId: row.migrated_from_habit_id,
    minimumVersionDescription: row.minimum_version_description,
    minimumVersionDurationMinutes: row.minimum_version_duration_minutes,
    minimumVersionTitle: row.minimum_version_title,
    preferredTimeOfDay: row.preferred_time_of_day,
    title: row.title,
    type: row.type,
    updatedAt: serializeTimestamp(row.updated_at),
    userId: row.user_id,
    version: Number(row.version),
    workspaceId: row.workspace_id,
  }
}

export function mapAlternativeRow(
  row: AlternativeRow,
): SelfCareItemAlternative {
  return {
    countsAsCompletion: row.counts_as_completion,
    description: row.description,
    id: row.id,
    itemId: row.item_id,
    title: row.title,
  }
}

export function mapRuleRow(row: RuleRow): SelfCareScheduleRule {
  return {
    allowMultiplePerDay: row.allow_multiple_per_day,
    createdAt: serializeTimestamp(row.created_at),
    dayOfMonth: row.day_of_month,
    daysOfWeek: parseJsonArray<number>(row.days_of_week, []),
    endDate: serializeNullableDate(row.end_date),
    flexiblePeriod: row.flexible_period,
    flexibleTargetCount: row.flexible_target_count,
    generateInCalendar: row.generate_in_calendar,
    generateInTaskList: row.generate_in_task_list,
    id: row.id,
    intervalUnit: row.interval_unit,
    intervalValue: row.interval_value,
    itemId: row.item_id,
    monthOfYear: row.month_of_year,
    preferredTime: serializeNullableTime(row.preferred_time),
    reminderOffsetsMinutes: parseJsonArray<number>(
      row.reminder_offsets_minutes,
      [],
    ),
    repeatKind: row.repeat_kind,
    startDate: serializeNullableDate(row.start_date),
    timezone: row.timezone,
    updatedAt: serializeTimestamp(row.updated_at),
    weekOfMonth: row.week_of_month,
  }
}

export function mapOccurrenceRow(
  row: OccurrenceRow,
): StoredSelfCareOccurrenceRecord {
  return {
    completedAt: serializeNullableTimestamp(row.completed_at),
    createdAt: serializeTimestamp(row.created_at),
    dueAt: serializeNullableTimestamp(row.due_at),
    generatedAt: serializeNullableTimestamp(row.generated_at),
    id: row.id,
    itemId: row.item_id,
    movedTo: serializeNullableDate(row.moved_to),
    reminderOffsetsMinutes: parseJsonArray<number>(
      row.reminder_offsets_minutes,
      [],
    ),
    reminderTimeZone: row.reminder_time_zone,
    scheduledFor: serializeDate(row.scheduled_for),
    scheduleRuleId: row.schedule_rule_id,
    status: row.status,
    updatedAt: serializeTimestamp(row.updated_at),
    userId: row.user_id,
  }
}

export function mapCompletionRow(
  row: CompletionRow,
): StoredSelfCareCompletionRecord {
  return {
    alternativeTitle: row.alternative_title,
    completedAt: serializeTimestamp(row.completed_at),
    completedVariant: row.completed_variant,
    createdAt: serializeTimestamp(row.created_at),
    currency: row.currency,
    durationMinutes: row.duration_minutes,
    energyAfter: row.energy_after,
    energyBefore: row.energy_before,
    exerciseSets: parseJsonArray<{ index: number; value: number }>(
      row.exercise_sets,
      [],
    ),
    id: row.id,
    itemId: row.item_id,
    measurementUnit: row.measurement_unit,
    measurementValue:
      row.measurement_value === null ? null : Number(row.measurement_value),
    moodAfter: row.mood_after,
    moodBefore: row.mood_before,
    note: row.note,
    occurrenceId: row.occurrence_id,
    price: row.price === null ? null : Number(row.price),
    scheduledFor: serializeNullableDate(row.scheduled_for),
    status: row.status,
    userId: row.user_id,
  }
}

export function mapStepRow(row: StepRow): SelfCareRitualStep {
  return {
    createdAt: serializeTimestamp(row.created_at),
    defaultChecked: row.default_checked,
    id: row.id,
    isOptional: row.is_optional,
    itemId: row.item_id,
    order: row.sort_order,
    title: row.title,
    updatedAt: serializeTimestamp(row.updated_at),
  }
}

export function mapStepCompletionRow(
  row: StepCompletionRow,
): SelfCareRitualStepCompletion {
  return {
    completionId: row.completion_id,
    id: row.id,
    isDone: row.is_done,
    stepId: row.step_id,
  }
}

export function mapStepDraftRow(
  row: StepDraftRow,
): StoredSelfCareRitualStepDraftRecord {
  return {
    date: serializeDate(row.date),
    itemId: row.item_id,
    occurrenceId: row.occurrence_id,
    stepIds: parseJsonArray<string>(row.step_ids, []),
    userId: row.user_id,
    workspaceId: row.workspace_id,
  }
}

export function mapProcedureRow(row: ProcedureRow): SelfCareProcedureDetails {
  return {
    contact: row.contact,
    createdAt: serializeTimestamp(row.created_at),
    currency: row.currency,
    defaultPrice: row.default_price === null ? null : Number(row.default_price),
    id: row.id,
    itemId: row.item_id,
    place: row.place,
    specialistName: row.specialist_name,
    updatedAt: serializeTimestamp(row.updated_at),
  }
}

export function mapAppointmentRow(
  row: AppointmentRow,
): SelfCareAppointmentDetails {
  return {
    createdAt: serializeTimestamp(row.created_at),
    currency: row.currency,
    endsAt: serializeNullableTimestamp(row.ends_at),
    id: row.id,
    itemId: row.item_id,
    occurrenceId: row.occurrence_id,
    place: row.place,
    preparationNote: row.preparation_note,
    price: row.price === null ? null : Number(row.price),
    resultNote: row.result_note,
    specialistContact: row.specialist_contact,
    specialistName: row.specialist_name,
    startsAt: serializeTimestamp(row.starts_at),
    updatedAt: serializeTimestamp(row.updated_at),
  }
}

export function mapMedicalRow(row: MedicalRow): SelfCareMedicalDetails {
  return {
    analysisList: parseJsonArray<string>(row.analysis_list, []),
    clinicAddress: row.clinic_address,
    clinicName: row.clinic_name,
    createdAt: serializeTimestamp(row.created_at),
    documentUrls: parseJsonArray<string>(row.document_urls, []),
    doctorName: row.doctor_name,
    id: row.id,
    itemId: row.item_id,
    nextControlDate: serializeNullableDate(row.next_control_date),
    phone: row.phone,
    reminderStrategy: row.reminder_strategy,
    resultNote: row.result_note,
    updatedAt: serializeTimestamp(row.updated_at),
    website: row.website,
  }
}

export function mapMeasurementRow(
  row: MeasurementRow,
): SelfCareMeasurementDetails {
  return {
    createdAt: serializeTimestamp(row.created_at),
    id: row.id,
    itemId: row.item_id,
    targetMax: row.target_max === null ? null : Number(row.target_max),
    targetMin: row.target_min === null ? null : Number(row.target_min),
    unit: row.unit,
    updatedAt: serializeTimestamp(row.updated_at),
    valueLabel: row.value_label,
  }
}

export function mapExerciseRow(row: ExerciseRow): SelfCareExerciseDetails {
  return {
    createdAt: serializeTimestamp(row.created_at),
    id: row.id,
    itemId: row.item_id,
    metricType: row.metric_type,
    plannedSets: row.planned_sets,
    plannedValue: row.planned_value === null ? null : Number(row.planned_value),
    unit: row.unit,
    updatedAt: serializeTimestamp(row.updated_at),
    useSets: row.use_sets,
  }
}

export function mapCourseRow(row: CourseRow): SelfCareCourseDetails {
  return {
    breakDays: row.break_days,
    completedCount: row.completed_count,
    courseType: row.course_type,
    createdAt: serializeTimestamp(row.created_at),
    endDate: serializeNullableDate(row.end_date),
    id: row.id,
    isCompleted: row.is_completed,
    isPaused: row.is_paused,
    itemId: row.item_id,
    repeatAfterCompletion: row.repeat_after_completion,
    startDate: serializeNullableDate(row.start_date),
    totalCount: row.total_count,
    updatedAt: serializeTimestamp(row.updated_at),
  }
}

export function mapDailyStateRow(row: DailyStateRow): SelfCareDailyState {
  return {
    createdAt: serializeTimestamp(row.created_at),
    date: serializeDate(row.date),
    energy: row.energy,
    id: row.id,
    mood: row.mood,
    note: row.note,
    pain: row.pain,
    sleepQuality: row.sleep_quality,
    stress: row.stress,
    updatedAt: serializeTimestamp(row.updated_at),
    userId: row.user_id,
  }
}

export function mapTemplateRow(row: TemplateRow): SelfCareTemplate {
  return {
    category: row.category,
    color: row.color,
    createdAt: serializeTimestamp(row.created_at),
    defaultSchedule: row.default_schedule,
    defaultSteps: parseJsonArray<string>(row.default_steps, []),
    description: row.description,
    icon: row.icon,
    id: row.id,
    importance: row.importance,
    isSystem: row.is_system,
    title: row.title,
    type: row.type,
    updatedAt: serializeTimestamp(row.updated_at),
  }
}

export function mapSettingsRow(row: SettingsRow): SelfCareSettings {
  return {
    createdAt: serializeTimestamp(row.created_at),
    currency: row.currency,
    defaultReminderTone: row.default_reminder_tone,
    gentleModeDate: serializeNullableDate(row.gentle_mode_date),
    gentleModeEnabledToday: row.gentle_mode_enabled_today,
    id: row.id,
    quietHoursEnd: row.quiet_hours_end,
    quietHoursStart: row.quiet_hours_start,
    showAppointmentsInCalendar: row.show_appointments_in_calendar,
    showSelfCareInMainTasks: row.show_self_care_in_main_tasks,
    updatedAt: serializeTimestamp(row.updated_at),
    userId: row.user_id,
  }
}

export function mapMinimumRow(row: MinimumRow): SelfCareMinimumItem {
  return {
    createdAt: serializeTimestamp(row.created_at),
    id: row.id,
    isActive: row.is_active,
    linkedItemId: row.linked_item_id,
    order: row.sort_order,
    title: row.title,
    updatedAt: serializeTimestamp(row.updated_at),
    userId: row.user_id,
  }
}

export async function selectChildren<TTable extends keyof DatabaseSchema>(
  executor: DatabaseExecutor,
  table: TTable,
  itemIds: string[],
) {
  if (itemIds.length === 0) {
    return [] as Array<Selectable<DatabaseSchema[TTable]>>
  }

  const result = await sql<Selectable<DatabaseSchema[TTable]>>`
    select *
    from ${sql.table(String(table))}
    where item_id = any(${itemIds})
  `.execute(executor)

  return result.rows
}

export function selectOccurrences(
  executor: DatabaseExecutor,
  input: {
    actorUserId: string | null
    includeAllScheduledOccurrences?: boolean | undefined
    itemIds?: string[] | undefined
    occurrenceRange?: SelfCareDateRange | undefined
    scheduledOccurrencesBefore?: string | undefined
  },
) {
  let query = executor.selectFrom('app.self_care_occurrences').selectAll()

  if (input.actorUserId) {
    query = query.where('user_id', '=', input.actorUserId)
  }

  if (input.itemIds) {
    if (input.itemIds.length === 0) {
      return Promise.resolve([] as OccurrenceRow[])
    }

    query = query.where('item_id', 'in', input.itemIds)
  }

  if (input.occurrenceRange && input.includeAllScheduledOccurrences) {
    query = query.where(sql<boolean>`
      (
        (scheduled_for >= ${input.occurrenceRange.from}
          and scheduled_for <= ${input.occurrenceRange.to})
        or status = 'scheduled'
      )
    `)
  } else if (input.occurrenceRange && input.scheduledOccurrencesBefore) {
    query = query.where(sql<boolean>`
      (
        (scheduled_for >= ${input.occurrenceRange.from}
          and scheduled_for <= ${input.occurrenceRange.to})
        or (status = 'scheduled'
          and scheduled_for < ${input.scheduledOccurrencesBefore})
      )
    `)
  } else if (input.occurrenceRange) {
    query = query
      .where('scheduled_for', '>=', input.occurrenceRange.from)
      .where('scheduled_for', '<=', input.occurrenceRange.to)
  } else if (input.scheduledOccurrencesBefore) {
    query = query
      .where('status', '=', 'scheduled')
      .where('scheduled_for', '<', input.scheduledOccurrencesBefore)
  }

  return query.execute()
}

export function selectCompletions(
  executor: DatabaseExecutor,
  input: {
    actorUserId: string | null
    completionRange?: SelfCareDateRange | undefined
    itemIds?: string[] | undefined
  },
) {
  let query = executor.selectFrom('app.self_care_completions').selectAll()

  if (input.actorUserId) {
    query = query.where('user_id', '=', input.actorUserId)
  }

  if (input.itemIds) {
    if (input.itemIds.length === 0) {
      return Promise.resolve([] as CompletionRow[])
    }

    query = query.where('item_id', 'in', input.itemIds)
  }

  if (input.completionRange) {
    query = query
      .where(
        'completed_at',
        '>=',
        toStartOfDayTimestamp(input.completionRange.from),
      )
      .where(
        'completed_at',
        '<',
        toStartOfDayTimestamp(addDays(input.completionRange.to, 1)),
      )
  }

  return query.execute()
}

export function selectDailyStates(
  executor: DatabaseExecutor,
  input: {
    dailyStateRange?: SelfCareDateRange | undefined
    userId: string
  },
) {
  let query = executor
    .selectFrom('app.self_care_daily_states')
    .selectAll()
    .where('user_id', '=', input.userId)

  if (input.dailyStateRange) {
    query = query
      .where('date', '>=', input.dailyStateRange.from)
      .where('date', '<=', input.dailyStateRange.to)
  }

  return query.execute()
}

export async function selectStepCompletions(
  executor: DatabaseExecutor,
  completionIds: string[],
) {
  if (completionIds.length === 0) {
    return [] as StepCompletionRow[]
  }

  const result = await sql<StepCompletionRow>`
    select *
    from app.self_care_ritual_step_completions
    where completion_id = any(${completionIds})
  `.execute(executor)

  return result.rows
}

export function toStartOfDayTimestamp(dateKey: string): string {
  return `${dateKey}T00:00:00.000Z`
}

export function mapCompletionStatusToOccurrenceStatus(
  status: StoredSelfCareCompletionRecord['status'],
): StoredSelfCareOccurrenceRecord['status'] {
  if (status === 'alternative_done') return 'partial'
  return status
}

export function toPublicRitualStepDraft(
  draft: StoredSelfCareRitualStepDraftRecord,
): SelfCareRitualStepDraft {
  return {
    date: draft.date,
    itemId: draft.itemId,
    occurrenceId: draft.occurrenceId,
    stepIds: draft.stepIds,
  }
}

export function assertMeasurementCompletionInput(
  item: StoredSelfCareItemRecord,
  input: CompleteSelfCareItemNowCommand['input'],
): void {
  if (item.type !== 'measurement') {
    return
  }

  if (input.measurementValue === null || input.measurementValue === undefined) {
    throw new HttpError(
      400,
      'self_care_measurement_value_required',
      'Measurement value is required.',
    )
  }
}

export function assertExerciseCompletionInput(
  item: StoredSelfCareItemRecord,
  input: CompleteSelfCareItemNowCommand['input'],
): void {
  if (item.type !== 'exercise') {
    return
  }

  if (input.measurementValue === null || input.measurementValue === undefined) {
    throw new HttpError(
      400,
      'self_care_exercise_value_required',
      'Exercise value is required.',
    )
  }
}

export function assertMoodCheckCompletionInput(
  item: StoredSelfCareItemRecord,
  input: CompleteSelfCareItemNowCommand['input'],
): void {
  if (item.type !== 'mood_check') {
    return
  }

  if (
    (input.moodAfter === null || input.moodAfter === undefined) &&
    (input.energyAfter === null || input.energyAfter === undefined)
  ) {
    throw new HttpError(
      400,
      'self_care_state_value_required',
      'Mood or energy value is required.',
    )
  }
}

export function hasScheduleDetails(
  input: ScheduleSelfCareItemCommand['input'],
): boolean {
  return Boolean(
    input.place?.trim() ||
    input.specialistName?.trim() ||
    input.specialistContact?.trim() ||
    input.currency?.trim() ||
    input.note?.trim() ||
    input.price !== null,
  )
}

export function shouldStoreAppointmentDetails(
  item: StoredSelfCareItemRecord,
  input: ScheduleSelfCareItemCommand['input'],
): boolean {
  return (
    item.type === 'appointment' ||
    Boolean(input.scheduledTime) ||
    hasScheduleDetails(input)
  )
}

export function buildScheduleDetailsStartsAt(scheduledFor: string): string {
  return `${scheduledFor}T00:00:00.000Z`
}
