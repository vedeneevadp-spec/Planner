import {
  getDateKeyInTimeZone,
  getDayRangeUtc,
  type SelfCareAppointmentDetails,
  type SelfCareCompletion,
  type SelfCareCourseDetails,
  type SelfCareExerciseDetails,
  type SelfCareMeasurementDetails,
  type SelfCareMedicalDetails,
  type SelfCareOccurrence,
  type SelfCareProcedureDetails,
  type SelfCareRitualStep,
  type SelfCareScheduleRule,
  type SelfCareSettings,
} from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import { getDatabaseErrorCode } from '../../infrastructure/db/errors.js'
import { type DatabaseExecutor } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  ArchiveSelfCareItemCommand,
  ScheduleSelfCareItemCommand,
  StoredSelfCareCompletionRecord,
  StoredSelfCareItemRecord,
  StoredSelfCareOccurrenceRecord,
  UpdateSelfCareItemCommand,
  UpdateSelfCareRitualStepsCommand,
  UpdateSelfCareSettingsCommand,
} from './self-care.model.js'
import {
  buildScheduleDetailsStartsAt,
  hasScheduleDetails,
  mapCompletionRow,
  mapCourseRow,
  mapOccurrenceRow,
  mapRuleRow,
  mapStepDraftRow,
  shouldStoreAppointmentDetails,
} from './self-care.repository.postgres.helpers.js'
import { withWriteTransaction } from './self-care.repository.postgres.transactions.js'
import { resolveSelfCareReminderTimeZone } from './self-care.repository.postgres.validation.js'
import { assertSelfCareVersion } from './self-care.repository.postgres.validation.js'
import { reconcileSelfCareSchedule } from './self-care.schedule-reconciliation.js'
import type { createSelfCareRecords } from './self-care.shared.js'
import {
  addDays,
  createAppointmentDetailsRecord,
  createDefaultSelfCareSettings,
  createProcedureDetailsRecord,
  createRitualStepRecord,
  shouldDeactivateCompletedFlexibleGoal,
} from './self-care.shared.js'

export class PostgresSelfCarePersistence {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}
  async updateMigratedHabitState(
    executor: DatabaseExecutor,
    context: ArchiveSelfCareItemCommand['context'],
    input: {
      deletedAt?: string | null | undefined
      habitId: string
      isActive: boolean
    },
  ) {
    await executor
      .updateTable('app.habits')
      .set({
        ...(input.deletedAt !== undefined
          ? { deleted_at: input.deletedAt }
          : {}),
        is_active: input.isActive,
        updated_by: context.actorUserId,
      })
      .where('id', '=', input.habitId)
      .where('workspace_id', '=', context.workspaceId)
      .where('user_id', '=', context.actorUserId)
      .where((expressionBuilder) =>
        input.deletedAt === undefined
          ? expressionBuilder('deleted_at', 'is', null)
          : expressionBuilder.or([
              expressionBuilder('deleted_at', 'is', null),
              expressionBuilder('deleted_at', '=', input.deletedAt),
            ]),
      )
      .execute()
  }

  async loadProgressCompletionForDate(
    executor: DatabaseExecutor,
    input: {
      date: string
      itemId: string
      plannerTimeZone?: string | undefined
      userId: string
    },
  ): Promise<StoredSelfCareCompletionRecord | null> {
    const dayRange = getDayRangeUtc({
      localDate: input.date,
      timeZone: input.plannerTimeZone ?? 'UTC',
    })
    const row = await executor
      .selectFrom('app.self_care_completions')
      .selectAll()
      .where('user_id', '=', input.userId)
      .where('item_id', '=', input.itemId)
      .where('completed_at', '>=', dayRange.startUtc)
      .where('completed_at', '<', dayRange.endUtc)
      .where('status', 'in', ['done', 'partial', 'alternative_done'])
      .orderBy('completed_at', 'desc')
      .executeTakeFirst()

    return row ? mapCompletionRow(row) : null
  }

  async insertCreatedRecords(
    executor: DatabaseExecutor,
    records: ReturnType<typeof createSelfCareRecords>,
    actorUserId: string,
  ) {
    await executor
      .insertInto('app.self_care_items')
      .values({
        category: records.item.category,
        color: records.item.color,
        created_by: actorUserId,
        created_from_template_id: records.item.createdFromTemplateId,
        custom_category_id: records.item.customCategoryId,
        default_duration_minutes: records.item.defaultDurationMinutes,
        deleted_at: null,
        description: records.item.description,
        icon: records.item.icon,
        id: records.item.id,
        importance: records.item.importance,
        is_active: records.item.isActive,
        is_archived: records.item.isArchived,
        is_private: records.item.isPrivate,
        migrated_from_habit_id: records.item.migratedFromHabitId,
        minimum_version_description: records.item.minimumVersionDescription,
        minimum_version_duration_minutes:
          records.item.minimumVersionDurationMinutes,
        minimum_version_title: records.item.minimumVersionTitle,
        preferred_time_of_day: records.item.preferredTimeOfDay,
        title: records.item.title,
        type: records.item.type,
        updated_by: actorUserId,
        user_id: records.item.userId,
        workspace_id: records.item.workspaceId,
      })
      .execute()
    for (const alternative of records.alternatives) {
      await executor
        .insertInto('app.self_care_item_alternatives')
        .values({
          counts_as_completion: alternative.countsAsCompletion,
          description: alternative.description,
          id: alternative.id,
          item_id: alternative.itemId,
          title: alternative.title,
        })
        .execute()
    }
    if (records.scheduleRule)
      await this.insertScheduleRule(executor, records.scheduleRule, actorUserId)
    for (const step of records.steps) await this.insertStep(executor, step)
    if (records.procedureDetails)
      await this.insertProcedureDetails(executor, records.procedureDetails)
    if (records.appointmentDetails)
      await this.insertAppointmentDetails(executor, records.appointmentDetails)
    if (records.medicalDetails)
      await this.insertMedicalDetails(executor, records.medicalDetails)
    if (records.measurementDetails)
      await this.insertMeasurementDetails(executor, records.measurementDetails)
    if (records.exerciseDetails)
      await this.insertExerciseDetails(executor, records.exerciseDetails)
    if (records.courseDetails)
      await this.insertCourseDetails(executor, records.courseDetails)
  }

  insertScheduleRule(
    executor: DatabaseExecutor,
    rule: SelfCareScheduleRule,
    actorUserId: string,
  ) {
    void actorUserId
    return executor
      .insertInto('app.self_care_schedule_rules')
      .values({
        allow_multiple_per_day: rule.allowMultiplePerDay,
        day_of_month: rule.dayOfMonth,
        days_of_week: rule.daysOfWeek,
        end_date: rule.endDate,
        flexible_period: rule.flexiblePeriod,
        flexible_target_count: rule.flexibleTargetCount,
        generate_in_calendar: rule.generateInCalendar,
        generate_in_task_list: rule.generateInTaskList,
        id: rule.id,
        interval_unit: rule.intervalUnit,
        interval_value: rule.intervalValue,
        item_id: rule.itemId,
        month_of_year: rule.monthOfYear,
        preferred_time: rule.preferredTime,
        reminder_offsets_minutes: rule.reminderOffsetsMinutes,
        repeat_kind: rule.repeatKind,
        start_date: rule.startDate,
        timezone: rule.timezone,
        week_of_month: rule.weekOfMonth,
      })
      .execute()
  }

  async upsertScheduleRule(
    executor: DatabaseExecutor,
    rule: SelfCareScheduleRule,
    actorUserId: string,
  ) {
    const existing = await executor
      .selectFrom('app.self_care_schedule_rules')
      .select('id')
      .where('item_id', '=', rule.itemId)
      .executeTakeFirst()

    if (!existing) {
      await this.insertScheduleRule(executor, rule, actorUserId)
      return rule.id
    }

    await executor
      .updateTable('app.self_care_schedule_rules')
      .set({
        allow_multiple_per_day: rule.allowMultiplePerDay,
        day_of_month: rule.dayOfMonth,
        days_of_week: rule.daysOfWeek,
        end_date: rule.endDate,
        flexible_period: rule.flexiblePeriod,
        flexible_target_count: rule.flexibleTargetCount,
        generate_in_calendar: rule.generateInCalendar,
        generate_in_task_list: rule.generateInTaskList,
        interval_unit: rule.intervalUnit,
        interval_value: rule.intervalValue,
        month_of_year: rule.monthOfYear,
        preferred_time: rule.preferredTime,
        reminder_offsets_minutes: rule.reminderOffsetsMinutes,
        repeat_kind: rule.repeatKind,
        start_date: rule.startDate,
        timezone: rule.timezone,
        updated_at: sql`now()`,
        week_of_month: rule.weekOfMonth,
      })
      .where('id', '=', existing.id)
      .execute()

    return existing.id
  }

  insertStep(executor: DatabaseExecutor, step: SelfCareRitualStep) {
    return executor
      .insertInto('app.self_care_ritual_steps')
      .values({
        default_checked: step.defaultChecked ?? false,
        id: step.id,
        is_optional: step.isOptional,
        item_id: step.itemId,
        sort_order: step.order,
        title: step.title,
      })
      .execute()
  }

  async reconcileStoredSchedule(
    executor: DatabaseExecutor,
    command: UpdateSelfCareItemCommand,
    item: StoredSelfCareItemRecord,
  ) {
    const [ruleRow, occurrenceRows, completionRows, courseRow, draftRows] =
      await Promise.all([
        executor
          .selectFrom('app.self_care_schedule_rules')
          .selectAll()
          .where('item_id', '=', item.id)
          .executeTakeFirst(),
        executor
          .selectFrom('app.self_care_occurrences')
          .selectAll()
          .where('item_id', '=', item.id)
          .execute(),
        executor
          .selectFrom('app.self_care_completions')
          .selectAll()
          .where('item_id', '=', item.id)
          .execute(),
        executor
          .selectFrom('app.self_care_course_details')
          .selectAll()
          .where('item_id', '=', item.id)
          .executeTakeFirst(),
        executor
          .selectFrom('app.self_care_ritual_step_drafts')
          .selectAll()
          .where('item_id', '=', item.id)
          .execute(),
      ])
    if (!ruleRow) return
    const rule = mapRuleRow(ruleRow)
    const timeZone = resolveSelfCareReminderTimeZone(
      rule.timezone,
      command.context.clientTimeZone,
    )
    const result = reconcileSelfCareSchedule({
      plannerTimeZone: command.context.clientTimeZone,
      completions: completionRows.map(mapCompletionRow),
      courseDetails: courseRow ? mapCourseRow(courseRow) : null,
      from: getDateKeyInTimeZone(
        command.actedAt ?? new Date(),
        command.context.clientTimeZone ?? timeZone,
      ),
      item,
      occurrences: occurrenceRows.map(mapOccurrenceRow),
      preserveOccurrenceId: command.preserveOccurrenceId,
      stepDrafts: draftRows.map(mapStepDraftRow),
      scheduleRule: { ...rule, timezone: timeZone },
    })
    if (result.removedIds.length > 0) {
      await executor
        .deleteFrom('app.self_care_occurrences')
        .where('item_id', '=', item.id)
        .where('id', 'in', result.removedIds)
        .execute()
    }
    for (const occurrence of result.updated) {
      await this.updateOccurrence(
        executor,
        occurrence,
        command.context.actorUserId,
      )
    }
    await this.cancelPendingOccurrenceReminders(
      executor,
      result.updated.map((entry) => entry.id),
    )
    await this.insertOccurrences(
      executor,
      result.inserted,
      command.context.actorUserId,
    )
  }

  async cancelPendingOccurrenceReminders(
    executor: DatabaseExecutor,
    occurrenceIds: string[],
  ) {
    if (occurrenceIds.length === 0) return
    await executor
      .updateTable('app.self_care_reminders')
      .set({ canceled_at: new Date().toISOString(), claimed_at: null })
      .where('occurrence_id', 'in', occurrenceIds)
      .where('sent_at', 'is', null)
      .execute()
  }

  async replaceRitualSteps(
    executor: DatabaseExecutor,
    itemId: string,
    input: UpdateSelfCareRitualStepsCommand['steps'],
  ) {
    const existing = await executor
      .selectFrom('app.self_care_ritual_steps')
      .select('id')
      .where('item_id', '=', itemId)
      .execute()
    const existingIds = new Set(existing.map((step) => step.id))
    const steps = input.map((step, index) =>
      createRitualStepRecord(itemId, step, index),
    )
    const ids = steps.map((step) => step.id)
    if (new Set(ids).size !== ids.length) {
      throw new HttpError(
        409,
        'self_care_ritual_step_conflict',
        'Ritual step identifiers must be unique.',
      )
    }
    await executor
      .deleteFrom('app.self_care_ritual_step_drafts')
      .where('item_id', '=', itemId)
      .execute()
    await executor
      .updateTable('app.self_care_ritual_steps')
      .set({
        deleted_at: sql`now()`,
        updated_at: sql`now()`,
      })
      .where('item_id', '=', itemId)
      .where('deleted_at', 'is', null)
      .$if(ids.length > 0, (query) => query.where('id', 'not in', ids))
      .execute()
    for (const step of steps) {
      if (!existingIds.has(step.id)) {
        await this.insertStep(executor, step)
        continue
      }
      await executor
        .updateTable('app.self_care_ritual_steps')
        .set({
          default_checked: step.defaultChecked ?? false,
          deleted_at: null,
          is_optional: step.isOptional,
          sort_order: step.order,
          title: step.title,
          updated_at: sql`now()`,
        })
        .where('id', '=', step.id)
        .where('item_id', '=', itemId)
        .execute()
    }
  }

  insertProcedureDetails(
    executor: DatabaseExecutor,
    details: SelfCareProcedureDetails,
  ) {
    return executor
      .insertInto('app.self_care_procedure_details')
      .values({
        contact: details.contact,
        currency: details.currency,
        default_price: details.defaultPrice,
        id: details.id,
        item_id: details.itemId,
        place: details.place,
        specialist_name: details.specialistName,
      })
      .execute()
  }

  insertAppointmentDetails(
    executor: DatabaseExecutor,
    details: SelfCareAppointmentDetails,
  ) {
    return executor
      .insertInto('app.self_care_appointment_details')
      .values({
        currency: details.currency,
        ends_at: details.endsAt,
        id: details.id,
        item_id: details.itemId,
        occurrence_id: details.occurrenceId,
        place: details.place,
        preparation_note: details.preparationNote,
        price: details.price,
        result_note: details.resultNote,
        specialist_contact: details.specialistContact,
        specialist_name: details.specialistName,
        starts_at: details.startsAt,
      })
      .execute()
  }

  async upsertScheduledDetails(
    executor: DatabaseExecutor,
    item: StoredSelfCareItemRecord,
    occurrence: StoredSelfCareOccurrenceRecord,
    input: ScheduleSelfCareItemCommand['input'],
  ) {
    const now = new Date().toISOString()

    if (shouldStoreAppointmentDetails(item, input)) {
      const startsAt =
        occurrence.dueAt ?? buildScheduleDetailsStartsAt(input.scheduledFor)
      const existingAppointment = await executor
        .selectFrom('app.self_care_appointment_details')
        .selectAll()
        .where('occurrence_id', '=', occurrence.id)
        .executeTakeFirst()

      if (existingAppointment) {
        await executor
          .updateTable('app.self_care_appointment_details')
          .set({
            currency: input.currency,
            place: input.place,
            preparation_note: input.note,
            price: input.price,
            specialist_contact: input.specialistContact,
            specialist_name: input.specialistName,
            starts_at: startsAt,
          })
          .where('id', '=', existingAppointment.id)
          .execute()
      } else {
        await this.insertAppointmentDetails(executor, {
          ...createAppointmentDetailsRecord(
            item.id,
            {
              currency: input.currency,
              endsAt: null,
              place: input.place,
              preparationNote: input.note,
              price: input.price,
              resultNote: null,
              specialistContact: input.specialistContact,
              specialistName: input.specialistName,
              startsAt,
            },
            now,
          ),
          occurrenceId: occurrence.id,
        })
      }
    }

    if (item.type === 'procedure' && hasScheduleDetails(input)) {
      const existingProcedure = await executor
        .selectFrom('app.self_care_procedure_details')
        .selectAll()
        .where('item_id', '=', item.id)
        .executeTakeFirst()

      if (existingProcedure) {
        await executor
          .updateTable('app.self_care_procedure_details')
          .set({
            contact: input.specialistContact,
            currency: input.currency,
            default_price: input.price,
            place: input.place,
            specialist_name: input.specialistName,
          })
          .where('id', '=', existingProcedure.id)
          .execute()
      } else {
        await this.insertProcedureDetails(
          executor,
          createProcedureDetailsRecord(
            item.id,
            {
              contact: input.specialistContact,
              currency: input.currency,
              defaultPrice: input.price,
              place: input.place,
              specialistName: input.specialistName,
            },
            now,
          ),
        )
      }
    }
  }

  insertMedicalDetails(
    executor: DatabaseExecutor,
    details: SelfCareMedicalDetails,
  ) {
    return executor
      .insertInto('app.self_care_medical_details')
      .values({
        analysis_list: details.analysisList,
        clinic_address: details.clinicAddress,
        clinic_name: details.clinicName,
        document_urls: details.documentUrls,
        doctor_name: details.doctorName,
        id: details.id,
        item_id: details.itemId,
        next_control_date: details.nextControlDate,
        phone: details.phone,
        reminder_strategy: details.reminderStrategy,
        result_note: details.resultNote,
        website: details.website,
      })
      .execute()
  }

  insertMeasurementDetails(
    executor: DatabaseExecutor,
    details: SelfCareMeasurementDetails,
  ) {
    return executor
      .insertInto('app.self_care_measurement_details')
      .values({
        id: details.id,
        item_id: details.itemId,
        target_max: details.targetMax,
        target_min: details.targetMin,
        unit: details.unit,
        value_label: details.valueLabel,
      })
      .execute()
  }

  insertExerciseDetails(
    executor: DatabaseExecutor,
    details: SelfCareExerciseDetails,
  ) {
    return executor
      .insertInto('app.self_care_exercise_details')
      .values({
        id: details.id,
        item_id: details.itemId,
        metric_type: details.metricType,
        planned_sets: details.plannedSets,
        planned_value: details.plannedValue,
        unit: details.unit,
        use_sets: details.useSets,
      })
      .execute()
  }

  insertCourseDetails(
    executor: DatabaseExecutor,
    details: SelfCareCourseDetails,
  ) {
    return executor
      .insertInto('app.self_care_course_details')
      .values({
        break_days: details.breakDays,
        completed_count: details.completedCount,
        course_type: details.courseType,
        end_date: details.endDate,
        id: details.id,
        is_completed: details.isCompleted,
        is_paused: details.isPaused,
        item_id: details.itemId,
        repeat_after_completion: details.repeatAfterCompletion,
        start_date: details.startDate,
        total_count: details.totalCount,
      })
      .execute()
  }

  async insertOccurrence(
    executor: DatabaseExecutor,
    occurrence: SelfCareOccurrence,
    actorUserId: string,
  ) {
    try {
      const row = await executor
        .insertInto('app.self_care_occurrences')
        .values({
          completed_at: occurrence.completedAt,
          created_by: actorUserId,
          due_at: occurrence.dueAt,
          generated_at: occurrence.generatedAt,
          id: occurrence.id,
          item_id: occurrence.itemId,
          moved_to: occurrence.movedTo,
          reminder_offsets_minutes: occurrence.reminderOffsetsMinutes,
          reminder_time_zone: occurrence.reminderTimeZone,
          scheduled_for: occurrence.scheduledFor,
          schedule_rule_id: occurrence.scheduleRuleId,
          status: occurrence.status,
          updated_by: actorUserId,
          user_id: occurrence.userId,
        })
        .returningAll()
        .executeTakeFirst()
      return row ? mapOccurrenceRow(row) : null
    } catch (error) {
      if (getDatabaseErrorCode(error) === '23505') {
        return null
      }

      throw error
    }
  }

  async insertOccurrences(
    executor: DatabaseExecutor,
    occurrences: SelfCareOccurrence[],
    actorUserId: string,
  ) {
    if (occurrences.length === 0) {
      return []
    }

    const rows = await executor
      .insertInto('app.self_care_occurrences')
      .values(
        occurrences.map((occurrence) => ({
          completed_at: occurrence.completedAt,
          created_by: actorUserId,
          due_at: occurrence.dueAt,
          generated_at: occurrence.generatedAt,
          id: occurrence.id,
          item_id: occurrence.itemId,
          moved_to: occurrence.movedTo,
          reminder_offsets_minutes: occurrence.reminderOffsetsMinutes,
          reminder_time_zone: occurrence.reminderTimeZone,
          scheduled_for: occurrence.scheduledFor,
          schedule_rule_id: occurrence.scheduleRuleId,
          status: occurrence.status,
          updated_by: actorUserId,
          user_id: occurrence.userId,
        })),
      )
      .onConflict((conflict) => conflict.doNothing())
      .returningAll()
      .execute()

    return rows.map((row) => mapOccurrenceRow(row))
  }

  async insertCompletion(
    executor: DatabaseExecutor,
    completion: SelfCareCompletion,
    actorUserId: string,
  ): Promise<StoredSelfCareCompletionRecord> {
    try {
      const row = await executor
        .insertInto('app.self_care_completions')
        .values({
          alternative_title: completion.alternativeTitle,
          completed_at: completion.completedAt,
          completed_variant: completion.completedVariant,
          created_by: actorUserId,
          currency: completion.currency,
          duration_minutes: completion.durationMinutes,
          energy_after: completion.energyAfter,
          energy_before: completion.energyBefore,
          exercise_sets: JSON.stringify(completion.exerciseSets),
          id: completion.id,
          item_id: completion.itemId,
          measurement_unit: completion.measurementUnit,
          measurement_value: completion.measurementValue,
          mood_after: completion.moodAfter,
          mood_before: completion.moodBefore,
          note: completion.note,
          occurrence_id: completion.occurrenceId,
          price: completion.price,
          scheduled_for: completion.scheduledFor,
          status: completion.status,
          user_id: completion.userId,
        })
        .returningAll()
        .executeTakeFirstOrThrow()

      return mapCompletionRow(row)
    } catch (error) {
      if (getDatabaseErrorCode(error) === '23505') {
        throw new HttpError(
          409,
          'self_care_completion_id_conflict',
          'The self-care completion identifier is already in use.',
        )
      }

      throw error
    }
  }

  async updateOpenExerciseProgressCompletion(
    executor: DatabaseExecutor,
    input: {
      completion: SelfCareCompletion
      date: string
      itemId: string
      plannerTimeZone?: string | undefined
      userId: string
    },
  ): Promise<StoredSelfCareCompletionRecord | null> {
    const existingCompletion = await this.loadProgressCompletionForDate(
      executor,
      {
        date: input.date,
        itemId: input.itemId,
        plannerTimeZone: input.plannerTimeZone,
        userId: input.userId,
      },
    )

    if (!existingCompletion || existingCompletion.status !== 'partial') {
      return null
    }

    const row = await executor
      .updateTable('app.self_care_completions')
      .set({
        alternative_title: input.completion.alternativeTitle,
        completed_at: input.completion.completedAt,
        completed_variant: input.completion.completedVariant,
        currency: input.completion.currency,
        duration_minutes: input.completion.durationMinutes,
        energy_after: input.completion.energyAfter,
        energy_before: input.completion.energyBefore,
        exercise_sets: JSON.stringify(input.completion.exerciseSets),
        measurement_unit: input.completion.measurementUnit,
        measurement_value: input.completion.measurementValue,
        mood_after: input.completion.moodAfter,
        mood_before: input.completion.moodBefore,
        note: input.completion.note,
        occurrence_id: input.completion.occurrenceId,
        price: input.completion.price,
        scheduled_for: input.completion.scheduledFor,
        status: input.completion.status,
      })
      .where('id', '=', existingCompletion.id)
      .where('user_id', '=', input.userId)
      .returningAll()
      .executeTakeFirst()

    return row ? mapCompletionRow(row) : null
  }

  updateOccurrence(
    executor: DatabaseExecutor,
    occurrence: SelfCareOccurrence,
    actorUserId: string,
  ) {
    return executor
      .updateTable('app.self_care_occurrences')
      .set({
        completed_at: occurrence.completedAt,
        due_at: occurrence.dueAt,
        generated_at: occurrence.generatedAt,
        moved_to: occurrence.movedTo,
        reminder_offsets_minutes: occurrence.reminderOffsetsMinutes,
        reminder_time_zone: occurrence.reminderTimeZone,
        schedule_rule_id: occurrence.scheduleRuleId,
        status: occurrence.status,
        updated_by: actorUserId,
      })
      .where('id', '=', occurrence.id)
      .execute()
  }

  async incrementCourse(
    executor: DatabaseExecutor,
    itemId: string,
    completionDate: string,
  ) {
    const row = await executor
      .selectFrom('app.self_care_course_details')
      .selectAll()
      .where('item_id', '=', itemId)
      .executeTakeFirst()
    if (!row || row.is_completed) return
    const completedCount = Math.min(row.total_count, row.completed_count + 1)

    if (completedCount >= row.total_count && row.repeat_after_completion) {
      const nextStartDate = addDays(completionDate, row.break_days + 1)
      await executor
        .updateTable('app.self_care_course_details')
        .set({
          completed_count: 0,
          end_date: null,
          is_completed: false,
          start_date: nextStartDate,
          updated_at: sql`now()`,
        })
        .where('id', '=', row.id)
        .execute()
      await executor
        .updateTable('app.self_care_schedule_rules')
        .set({ start_date: nextStartDate, updated_at: sql`now()` })
        .where('item_id', '=', itemId)
        .where('repeat_kind', '=', 'course')
        .execute()
      return
    }

    await executor
      .updateTable('app.self_care_course_details')
      .set({
        completed_count: completedCount,
        is_completed: completedCount >= row.total_count,
        updated_at: sql`now()`,
      })
      .where('id', '=', row.id)
      .execute()
  }

  async deactivateFlexibleGoalIfCompleted(
    executor: DatabaseExecutor,
    input: {
      actorUserId: string
      plannerTimeZone?: string | undefined
      completion: SelfCareCompletion
      item: StoredSelfCareItemRecord
      scheduleRule: SelfCareScheduleRule | null
    },
  ): Promise<boolean> {
    const completionRows = await executor
      .selectFrom('app.self_care_completions')
      .selectAll()
      .where('item_id', '=', input.item.id)
      .where('user_id', '=', input.actorUserId)
      .execute()
    const completions = completionRows.map((row) => mapCompletionRow(row))

    if (
      !shouldDeactivateCompletedFlexibleGoal({
        completion: input.completion,
        plannerTimeZone: input.plannerTimeZone,
        completions,
        item: input.item,
        scheduleRule: input.scheduleRule,
      })
    ) {
      return false
    }

    await executor
      .updateTable('app.self_care_items')
      .set({
        is_active: false,
        updated_by: input.actorUserId,
      })
      .where('id', '=', input.item.id)
      .where('user_id', '=', input.actorUserId)
      .execute()
    return true
  }

  async upsertSettings(
    context: UpdateSelfCareSettingsCommand['context'],
    input: Partial<UpdateSelfCareSettingsCommand['input']>,
    overrides: Partial<
      Pick<SelfCareSettings, 'gentleModeDate' | 'gentleModeEnabledToday'>
    > = {},
    expectedVersion?: number,
  ) {
    const defaults = createDefaultSelfCareSettings({
      userId: context.actorUserId,
    })
    await withWriteTransaction(
      this.db,
      context.auth,
      async (trx) => {
        const values = {
          currency: input.currency ?? defaults.currency,
          default_reminder_tone: defaults.defaultReminderTone,
          gentle_mode_date: overrides.gentleModeDate ?? defaults.gentleModeDate,
          gentle_mode_enabled_today:
            overrides.gentleModeEnabledToday ?? defaults.gentleModeEnabledToday,
          id: defaults.id,
          quiet_hours_end: defaults.quietHoursEnd,
          quiet_hours_start: defaults.quietHoursStart,
          show_appointments_in_calendar:
            input.showAppointmentsInCalendar ??
            defaults.showAppointmentsInCalendar,
          show_daily_rituals_in_calendar: false,
          show_self_care_in_main_tasks:
            input.showSelfCareInMainTasks ?? defaults.showSelfCareInMainTasks,
          user_id: context.actorUserId,
        }
        const updates = {
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.showAppointmentsInCalendar !== undefined
            ? {
                show_appointments_in_calendar: input.showAppointmentsInCalendar,
              }
            : {}),
          ...(input.showSelfCareInMainTasks !== undefined
            ? {
                show_self_care_in_main_tasks: input.showSelfCareInMainTasks,
              }
            : {}),
          ...(overrides.gentleModeDate !== undefined
            ? { gentle_mode_date: overrides.gentleModeDate }
            : {}),
          ...(overrides.gentleModeEnabledToday !== undefined
            ? {
                gentle_mode_enabled_today: overrides.gentleModeEnabledToday,
              }
            : {}),
        }

        if (expectedVersion !== undefined) {
          await trx
            .insertInto('app.self_care_settings')
            .values(values)
            .onConflict((conflict) => conflict.column('user_id').doNothing())
            .execute()
          const current = await trx
            .selectFrom('app.self_care_settings')
            .select(['id', 'version'])
            .where('user_id', '=', context.actorUserId)
            .forUpdate()
            .executeTakeFirstOrThrow()
          assertSelfCareVersion(
            'settings',
            current.id,
            expectedVersion,
            Number(current.version),
          )
          await trx
            .updateTable('app.self_care_settings')
            .set(updates)
            .where('id', '=', current.id)
            .where('version', '=', expectedVersion)
            .execute()
          return
        }

        await trx
          .insertInto('app.self_care_settings')
          .values({ ...values, version: 2 })
          .onConflict((conflict) =>
            conflict.column('user_id').doUpdateSet(updates),
          )
          .execute()
      },
      context.actorUserId,
    )
  }

  async loadOccurrenceRow(
    executor: DatabaseExecutor,
    userId: string,
    occurrenceId: string,
    expectedItemId?: string,
  ) {
    const row = await executor
      .selectFrom('app.self_care_occurrences')
      .selectAll()
      .where('id', '=', occurrenceId)
      .where('user_id', '=', userId)
      .$if(expectedItemId !== undefined, (query) =>
        query.where('item_id', '=', expectedItemId!),
      )
      .forUpdate()
      .executeTakeFirst()
    if (!row && expectedItemId !== undefined) {
      throw new HttpError(
        409,
        'self_care_reschedule_item_conflict',
        'The occurrence selected for rescheduling belongs to another self-care item.',
      )
    }
    if (!row)
      throw new HttpError(
        404,
        'self_care_occurrence_not_found',
        'Self-care occurrence not found.',
      )
    return row
  }

  async loadOccurrenceWithActiveItemRowsForUpdate(
    executor: DatabaseExecutor,
    context: UpdateSelfCareItemCommand['context'],
    occurrenceId: string,
    expectedItemId?: string,
  ) {
    // All compound self-care writes lock the aggregate root first. The first
    // read intentionally does not lock: item_id is immutable, and the
    // occurrence is locked and revalidated immediately after the item.
    const reference = await executor
      .selectFrom('app.self_care_occurrences')
      .select(['id', 'item_id'])
      .where('id', '=', occurrenceId)
      .where('user_id', '=', context.actorUserId)
      .$if(expectedItemId !== undefined, (query) =>
        query.where('item_id', '=', expectedItemId!),
      )
      .executeTakeFirst()

    if (!reference) {
      if (expectedItemId !== undefined) {
        throw new HttpError(
          409,
          'self_care_reschedule_item_conflict',
          'The occurrence selected for rescheduling belongs to another self-care item.',
        )
      }
      throw new HttpError(
        404,
        'self_care_occurrence_not_found',
        'Self-care occurrence not found.',
      )
    }

    const itemRow = await this.loadActiveItemRow(
      executor,
      context,
      reference.item_id,
    )
    const occurrenceRow = await this.loadOccurrenceRow(
      executor,
      context.actorUserId,
      occurrenceId,
      expectedItemId,
    )

    if (occurrenceRow.item_id !== itemRow.id) {
      throw new HttpError(
        409,
        'self_care_occurrence_item_conflict',
        'Self-care occurrence no longer belongs to the expected item.',
      )
    }

    return { itemRow, occurrenceRow }
  }

  async loadActiveItemRow(
    executor: DatabaseExecutor,
    context: UpdateSelfCareItemCommand['context'],
    itemId: string,
  ) {
    const row = await this.loadOwnedItemRowForUpdate(executor, context, itemId)

    if (row.is_archived) {
      throw new HttpError(
        404,
        'self_care_item_not_found',
        'Self-care item not found.',
      )
    }

    return row
  }

  async loadOwnedItemRowForUpdate(
    executor: DatabaseExecutor,
    context: UpdateSelfCareItemCommand['context'],
    itemId: string,
  ) {
    const row = await executor
      .selectFrom('app.self_care_items')
      .selectAll()
      .where('id', '=', itemId)
      .where('workspace_id', '=', context.workspaceId)
      .where('user_id', '=', context.actorUserId)
      .where('deleted_at', 'is', null)
      .forUpdate()
      .executeTakeFirst()
    if (!row)
      throw new HttpError(
        404,
        'self_care_item_not_found',
        'Self-care item not found.',
      )
    return row
  }

  async assertRitualStepDraftSteps(
    executor: DatabaseExecutor,
    input: {
      itemId: string
      stepIds: string[]
    },
  ): Promise<void> {
    const expectedStepIds = new Set(input.stepIds)

    if (expectedStepIds.size === 0) {
      return
    }

    const rows = await executor
      .selectFrom('app.self_care_ritual_steps')
      .select('id')
      .where('item_id', '=', input.itemId)
      .where('deleted_at', 'is', null)
      .where('id', 'in', [...expectedStepIds])
      .execute()

    if (rows.length !== expectedStepIds.size) {
      throw new HttpError(
        400,
        'self_care_ritual_step_draft_invalid_step',
        'Self-care ritual step draft contains an unknown step.',
      )
    }
  }

  deleteRitualStepDraftRow(
    executor: DatabaseExecutor,
    input: {
      date: string
      itemId: string
      occurrenceId: string | null
      userId: string
      workspaceId: string
    },
  ) {
    const query = executor
      .deleteFrom('app.self_care_ritual_step_drafts')
      .where('workspace_id', '=', input.workspaceId)
      .where('user_id', '=', input.userId)
      .where('date', '=', input.date)
      .where('item_id', '=', input.itemId)

    return input.occurrenceId
      ? query.where('occurrence_id', '=', input.occurrenceId).execute()
      : query.where('occurrence_id', 'is', null).execute()
  }
}
