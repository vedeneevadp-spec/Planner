import type {
  SelfCareAppointmentDetails,
  SelfCareCompletion,
  SelfCareCourseDetails,
  SelfCareDailyState,
  SelfCareItemAlternative,
  SelfCareMeasurementDetails,
  SelfCareMedicalDetails,
  SelfCareMinimumItem,
  SelfCareOccurrence,
  SelfCareProcedureDetails,
  SelfCareRitualStep,
  SelfCareRitualStepCompletion,
  SelfCareRitualStepDraft,
  SelfCareScheduleRule,
  SelfCareSettings,
  SelfCareTemplate,
} from '@planner/contracts'
import { type Kysely, type Selectable, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import { getDatabaseErrorCode } from '../../infrastructure/db/errors.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  ArchiveSelfCareItemCommand,
  CancelSelfCareOccurrenceCommand,
  CompleteCourseSessionCommand,
  CompleteFlexibleGoalCommand,
  CompleteSelfCareItemNowCommand,
  CompleteSelfCareOccurrenceCommand,
  CreateSelfCareItemCommand,
  CreateSelfCareItemFromTemplateCommand,
  DeleteSelfCareItemCommand,
  DeleteSelfCareRitualStepDraftCommand,
  GenerateSelfCareOccurrencesCommand,
  GetSelfCareDashboardCommand,
  GetSelfCareOccurrencesCommand,
  GetSelfCarePlanCommand,
  GetSelfCareRitualStepDraftsCommand,
  MoveSelfCareOccurrenceCommand,
  RestoreSelfCareItemCommand,
  ScheduleSelfCareItemCommand,
  SelfCareListFilters,
  SelfCareReadContext,
  SkipSelfCareOccurrenceCommand,
  StoredSelfCareCompletionRecord,
  StoredSelfCareItemRecord,
  StoredSelfCareOccurrenceRecord,
  StoredSelfCareRitualStepDraftRecord,
  ToggleSelfCareGentleModeCommand,
  UpdateSelfCareItemCommand,
  UpdateSelfCareMinimumItemsCommand,
  UpdateSelfCareRitualStepsCommand,
  UpdateSelfCareSettingsCommand,
  UpsertSelfCareDailyStateCommand,
  UpsertSelfCareRitualStepDraftCommand,
} from './self-care.model.js'
import type { SelfCareRepository } from './self-care.repository.js'
import {
  buildAnalyticsResponse,
  buildDashboardResponse,
  buildDueAt,
  buildHistoryResponse,
  buildItemInputFromTemplate,
  buildPlanResponse,
  buildSelfCareListResponse,
  buildSystemSelfCareTemplates,
  createAppointmentDetailsRecord,
  createCompletionRecord,
  createCourseDetailsRecord,
  createDailyStateRecord,
  createDefaultMinimumItems,
  createDefaultSelfCareSettings,
  createMeasurementDetailsRecord,
  createMedicalDetailsRecord,
  createMinimumItemRecord,
  createOccurrenceRecord,
  createProcedureDetailsRecord,
  createRitualStepCompletions,
  createRitualStepRecord,
  createScheduleRuleRecord,
  createSelfCareRecords,
  generateSelfCareOccurrencesForRange,
  getSelfCareCompletionDateKey,
  inferRitualCompletionStatus,
  isCompletionProgressStatus,
  parseJsonArray,
  serializeDate,
  serializeNullableDate,
  serializeNullableTime,
  serializeNullableTimestamp,
  serializeTimestamp,
  shouldDeduplicateSelfCareItemCompletion,
  shouldMarkSelfCareOccurrenceMissed,
  updateOccurrenceStatus,
} from './self-care.shared.js'

type ItemRow = Selectable<DatabaseSchema['app.self_care_items']>
type AlternativeRow = Selectable<
  DatabaseSchema['app.self_care_item_alternatives']
>
type RuleRow = Selectable<DatabaseSchema['app.self_care_schedule_rules']>
type OccurrenceRow = Selectable<DatabaseSchema['app.self_care_occurrences']>
type CompletionRow = Selectable<DatabaseSchema['app.self_care_completions']>
type StepRow = Selectable<DatabaseSchema['app.self_care_ritual_steps']>
type StepCompletionRow = Selectable<
  DatabaseSchema['app.self_care_ritual_step_completions']
>
type StepDraftRow = Selectable<
  DatabaseSchema['app.self_care_ritual_step_drafts']
>
type ProcedureRow = Selectable<
  DatabaseSchema['app.self_care_procedure_details']
>
type AppointmentRow = Selectable<
  DatabaseSchema['app.self_care_appointment_details']
>
type MedicalRow = Selectable<DatabaseSchema['app.self_care_medical_details']>
type MeasurementRow = Selectable<
  DatabaseSchema['app.self_care_measurement_details']
>
type CourseRow = Selectable<DatabaseSchema['app.self_care_course_details']>
type DailyStateRow = Selectable<DatabaseSchema['app.self_care_daily_states']>
type TemplateRow = Selectable<DatabaseSchema['app.self_care_templates']>
type SettingsRow = Selectable<DatabaseSchema['app.self_care_settings']>
type MinimumRow = Selectable<DatabaseSchema['app.self_care_minimum_items']>

export class PostgresSelfCareRepository implements SelfCareRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listItems(
    context: SelfCareReadContext,
    filters: SelfCareListFilters = {},
  ) {
    return buildSelfCareListResponse(await this.loadState(context), filters)
  }

  async createItem(command: CreateSelfCareItemCommand) {
    const records = createSelfCareRecords(command.input, {
      actorUserId: command.context.actorUserId,
      workspaceId: command.context.workspaceId,
    })

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        await this.insertCreatedRecords(
          trx,
          records,
          command.context.actorUserId,
        )
      },
      command.context.actorUserId,
    )

    return records.item
  }

  async updateItem(command: UpdateSelfCareItemCommand) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.self_care_items')
          .set({
            ...(command.input.category !== undefined
              ? { category: command.input.category }
              : {}),
            ...(command.input.color !== undefined
              ? { color: command.input.color }
              : {}),
            ...(command.input.customCategoryId !== undefined
              ? { custom_category_id: command.input.customCategoryId }
              : {}),
            ...(command.input.defaultDurationMinutes !== undefined
              ? {
                  default_duration_minutes:
                    command.input.defaultDurationMinutes,
                }
              : {}),
            ...(command.input.description !== undefined
              ? { description: command.input.description }
              : {}),
            ...(command.input.icon !== undefined
              ? { icon: command.input.icon }
              : {}),
            ...(command.input.importance !== undefined
              ? { importance: command.input.importance }
              : {}),
            ...(command.input.isActive !== undefined
              ? { is_active: command.input.isActive }
              : {}),
            ...(command.input.isArchived !== undefined
              ? { is_archived: command.input.isArchived }
              : {}),
            ...(command.input.isPrivate !== undefined
              ? { is_private: command.input.isPrivate }
              : {}),
            ...(command.input.minimumVersion !== undefined
              ? {
                  minimum_version_description:
                    command.input.minimumVersion?.description || null,
                  minimum_version_duration_minutes:
                    command.input.minimumVersion?.durationMinutes ?? null,
                  minimum_version_title:
                    command.input.minimumVersion?.title ?? null,
                }
              : {}),
            ...(command.input.preferredTimeOfDay !== undefined
              ? { preferred_time_of_day: command.input.preferredTimeOfDay }
              : {}),
            ...(command.input.title !== undefined
              ? { title: command.input.title }
              : {}),
            ...(command.input.type !== undefined
              ? { type: command.input.type }
              : {}),
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.itemId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('user_id', '=', command.context.actorUserId)
          .where('deleted_at', 'is', null)
          .where('is_archived', '=', false)

        if (command.input.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            command.input.expectedVersion,
          )
        }

        const updated = await updateQuery.returningAll().executeTakeFirst()

        if (!updated) {
          throw new HttpError(
            404,
            'self_care_item_not_found',
            'Self-care item not found.',
          )
        }

        if (command.input.scheduleRule) {
          await this.upsertScheduleRule(
            trx,
            createScheduleRuleRecord(
              command.itemId,
              command.input.scheduleRule,
            ),
            command.context.actorUserId,
          )
        }

        if (command.input.steps) {
          await trx
            .deleteFrom('app.self_care_ritual_step_drafts')
            .where('item_id', '=', command.itemId)
            .execute()
          await trx
            .deleteFrom('app.self_care_ritual_steps')
            .where('item_id', '=', command.itemId)
            .execute()
          for (const [index, step] of command.input.steps.entries()) {
            await this.insertStep(
              trx,
              createRitualStepRecord(command.itemId, step, index),
            )
          }
        }

        if (command.input.alternatives) {
          await trx
            .deleteFrom('app.self_care_item_alternatives')
            .where('item_id', '=', command.itemId)
            .execute()
          for (const alternative of command.input.alternatives) {
            await trx
              .insertInto('app.self_care_item_alternatives')
              .values({
                counts_as_completion: alternative.countsAsCompletion,
                description: alternative.description,
                id: alternative.id,
                item_id: command.itemId,
                title: alternative.title,
              })
              .execute()
          }
        }

        if (command.input.procedureDetails) {
          await trx
            .deleteFrom('app.self_care_procedure_details')
            .where('item_id', '=', command.itemId)
            .execute()
          await this.insertProcedureDetails(
            trx,
            createProcedureDetailsRecord(
              command.itemId,
              command.input.procedureDetails,
            ),
          )
        }

        if (command.input.appointmentDetails) {
          await trx
            .deleteFrom('app.self_care_appointment_details')
            .where('item_id', '=', command.itemId)
            .execute()
          await this.insertAppointmentDetails(
            trx,
            createAppointmentDetailsRecord(
              command.itemId,
              command.input.appointmentDetails,
            ),
          )
        }

        if (command.input.medicalDetails) {
          await trx
            .deleteFrom('app.self_care_medical_details')
            .where('item_id', '=', command.itemId)
            .execute()
          await this.insertMedicalDetails(
            trx,
            createMedicalDetailsRecord(
              command.itemId,
              command.input.medicalDetails,
            ),
          )
        }

        if (command.input.measurementDetails) {
          await trx
            .deleteFrom('app.self_care_measurement_details')
            .where('item_id', '=', command.itemId)
            .execute()
          await this.insertMeasurementDetails(
            trx,
            createMeasurementDetailsRecord(
              command.itemId,
              command.input.measurementDetails,
            ),
          )
        }

        if (command.input.courseDetails) {
          await trx
            .deleteFrom('app.self_care_course_details')
            .where('item_id', '=', command.itemId)
            .execute()
          await this.insertCourseDetails(
            trx,
            createCourseDetailsRecord(
              command.itemId,
              command.input.courseDetails,
            ),
          )
        }

        if (
          updated.migrated_from_habit_id &&
          (command.input.isActive !== undefined ||
            command.input.isArchived !== undefined)
        ) {
          await this.updateMigratedHabitState(trx, command.context, {
            habitId: updated.migrated_from_habit_id,
            isActive: updated.is_active && !updated.is_archived,
          })
        }

        return this.mapItem(updated)
      },
      command.context.actorUserId,
    )
  }

  async archiveItem(command: ArchiveSelfCareItemCommand) {
    return this.setArchiveState(command.context, command.itemId, true)
  }

  async restoreItem(command: RestoreSelfCareItemCommand) {
    return this.setArchiveState(command.context, command.itemId, false)
  }

  async deleteItem(command: DeleteSelfCareItemCommand) {
    const deletedAt = new Date().toISOString()

    if (command.context.auth) {
      const deleted = await withWriteTransaction(
        this.db,
        command.context.auth,
        async (trx) => {
          const result = await sql<{
            deleted: boolean
            migrated_from_habit_id: string | null
          }>`
            select deleted, migrated_from_habit_id
            from app.soft_delete_self_care_item(
              ${command.itemId},
              ${command.context.workspaceId},
              ${command.context.actorUserId}
            )
          `.execute(trx)
          const row = result.rows[0]

          if (!row?.deleted) {
            return null
          }

          if (row.migrated_from_habit_id) {
            await sql`
              select app.soft_delete_habit(
                ${row.migrated_from_habit_id},
                ${command.context.workspaceId},
                ${command.context.actorUserId}
              )
            `.execute(trx)
          }

          await trx
            .deleteFrom('app.self_care_ritual_step_drafts')
            .where('item_id', '=', command.itemId)
            .execute()

          return row
        },
        command.context.actorUserId,
      )

      if (!deleted) {
        throw new HttpError(
          404,
          'self_care_item_not_found',
          'Self-care item not found.',
        )
      }

      return
    }

    const updated = await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const row = await trx
          .selectFrom('app.self_care_items')
          .select(['id', 'migrated_from_habit_id'])
          .where('id', '=', command.itemId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('user_id', '=', command.context.actorUserId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()

        if (!row) {
          return null
        }

        const deleteResult = await trx
          .updateTable('app.self_care_items')
          .set({
            deleted_at: deletedAt,
            is_active: false,
            is_archived: true,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.itemId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('user_id', '=', command.context.actorUserId)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()

        if (Number(deleteResult.numUpdatedRows) === 0) {
          return null
        }

        if (row.migrated_from_habit_id) {
          await this.updateMigratedHabitState(trx, command.context, {
            deletedAt,
            habitId: row.migrated_from_habit_id,
            isActive: false,
          })
        }

        await trx
          .deleteFrom('app.self_care_ritual_step_drafts')
          .where('item_id', '=', command.itemId)
          .execute()

        return row
      },
      command.context.actorUserId,
    )

    if (!updated) {
      throw new HttpError(
        404,
        'self_care_item_not_found',
        'Self-care item not found.',
      )
    }
  }

  async generateOccurrences(command: GenerateSelfCareOccurrencesCommand) {
    const state = await this.loadState(command.context)
    const generated: StoredSelfCareOccurrenceRecord[] = []

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        for (const item of state.items) {
          const rule =
            state.scheduleRules.find(
              (candidate) => candidate.itemId === item.id,
            ) ?? null
          const course =
            state.courseDetails.find(
              (candidate) => candidate.itemId === item.id,
            ) ?? null
          const occurrences = generateSelfCareOccurrencesForRange({
            completions: state.completions,
            courseDetails: course,
            existingOccurrences: state.occurrences,
            from: command.from,
            item,
            scheduleRule: rule,
            to: command.to,
          })

          for (const occurrence of occurrences) {
            const inserted = await this.insertOccurrence(
              trx,
              occurrence,
              command.context.actorUserId,
            )
            if (inserted) {
              generated.push(inserted)
            }
          }
        }
      },
      command.context.actorUserId,
    )

    return generated
  }

  async getDashboard(command: GetSelfCareDashboardCommand) {
    await this.generateReadOccurrences(
      command.context,
      command.date,
      command.date,
    )
    await this.markMissedOccurrences(command.context, command.date)
    return buildDashboardResponse({
      date: command.date,
      state: await this.loadState(command.context),
    })
  }

  async getPlan(command: GetSelfCarePlanCommand) {
    await this.generateReadOccurrences(
      command.context,
      command.from,
      command.to,
    )
    await this.markMissedOccurrences(command.context, command.from)
    return buildPlanResponse({
      from: command.from,
      state: await this.loadState(command.context),
      to: command.to,
    })
  }

  async getOccurrences(command: GetSelfCareOccurrencesCommand) {
    await this.generateReadOccurrences(
      command.context,
      command.from,
      command.to,
    )
    await this.markMissedOccurrences(command.context, command.from)
    const state = await this.loadState(command.context)
    return state.occurrences.filter(
      (occurrence) =>
        occurrence.scheduledFor >= command.from &&
        occurrence.scheduledFor <= command.to,
    )
  }

  async completeOccurrence(command: CompleteSelfCareOccurrenceCommand) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const occurrenceRow = await this.loadOccurrenceRow(
          trx,
          command.context.actorUserId,
          command.occurrenceId,
        )
        const occurrence = this.mapOccurrence(occurrenceRow)
        const itemRow = await this.loadActiveItemRow(
          trx,
          command.context,
          occurrence.itemId,
        )
        const item = this.mapItem(itemRow)
        assertMeasurementCompletionInput(item, command.input)
        assertMoodCheckCompletionInput(item, command.input)
        const stepRows = await trx
          .selectFrom('app.self_care_ritual_steps')
          .selectAll()
          .where('item_id', '=', item.id)
          .execute()
        const steps = stepRows.map((row) => this.mapStep(row))
        const pendingStepCompletions = createRitualStepCompletions(
          'pending',
          command.input,
        )
        const status = inferRitualCompletionStatus({
          requestedStatus: command.input.status,
          stepCompletions: pendingStepCompletions,
          steps,
        })
        const completion = createCompletionRecord(
          { ...command.input, status },
          { itemId: item.id, occurrence, userId: command.context.actorUserId },
        )
        await this.insertCompletion(
          trx,
          completion,
          command.context.actorUserId,
        )
        for (const step of pendingStepCompletions) {
          await trx
            .insertInto('app.self_care_ritual_step_completions')
            .values({
              completion_id: completion.id,
              id: step.id,
              is_done: step.isDone,
              step_id: step.stepId,
            })
            .execute()
        }
        await this.updateOccurrence(
          trx,
          updateOccurrenceStatus(
            occurrence,
            mapCompletionStatusToOccurrenceStatus(status),
            { completedAt: completion.completedAt },
          ),
          command.context.actorUserId,
        )
        const completionDate = getSelfCareCompletionDateKey(command.input)
        await this.deleteRitualStepDraftRow(trx, {
          date: completionDate,
          itemId: item.id,
          occurrenceId: occurrence.id,
          userId: command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        if (occurrence.scheduledFor !== completionDate) {
          await this.deleteRitualStepDraftRow(trx, {
            date: occurrence.scheduledFor,
            itemId: item.id,
            occurrenceId: occurrence.id,
            userId: command.context.actorUserId,
            workspaceId: command.context.workspaceId,
          })
        }
        await this.incrementCourse(trx, item.id)
        return completion
      },
      command.context.actorUserId,
    )
  }

  async completeItemNow(command: CompleteSelfCareItemNowCommand) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const item = this.mapItem(
          await this.loadActiveItemRow(trx, command.context, command.itemId),
        )
        assertMeasurementCompletionInput(item, command.input)
        assertMoodCheckCompletionInput(item, command.input)
        const ruleRow = await trx
          .selectFrom('app.self_care_schedule_rules')
          .selectAll()
          .where('item_id', '=', item.id)
          .executeTakeFirst()
        const scheduleRule = ruleRow ? this.mapRule(ruleRow) : null
        const completionDate = getSelfCareCompletionDateKey(command.input)
        const existingCompletion = shouldDeduplicateSelfCareItemCompletion({
          item,
          scheduleRule,
        })
          ? await this.loadProgressCompletionForDate(trx, {
              date: completionDate,
              itemId: item.id,
              userId: command.context.actorUserId,
            })
          : null

        if (existingCompletion) {
          return existingCompletion
        }

        const stepRows = await trx
          .selectFrom('app.self_care_ritual_steps')
          .selectAll()
          .where('item_id', '=', item.id)
          .execute()
        const steps = stepRows.map((row) => this.mapStep(row))
        const pendingStepCompletions = createRitualStepCompletions(
          'pending',
          command.input,
        )
        const status = inferRitualCompletionStatus({
          requestedStatus: command.input.status,
          stepCompletions: pendingStepCompletions,
          steps,
        })
        const completion = createCompletionRecord(
          { ...command.input, status },
          {
            itemId: item.id,
            scheduledFor: completionDate,
            userId: command.context.actorUserId,
          },
        )
        await this.insertCompletion(
          trx,
          completion,
          command.context.actorUserId,
        )
        for (const step of pendingStepCompletions) {
          await trx
            .insertInto('app.self_care_ritual_step_completions')
            .values({
              completion_id: completion.id,
              id: step.id,
              is_done: step.isDone,
              step_id: step.stepId,
            })
            .execute()
        }
        await this.deleteRitualStepDraftRow(trx, {
          date: completionDate,
          itemId: item.id,
          occurrenceId: null,
          userId: command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        await this.incrementCourse(trx, item.id)
        return completion
      },
      command.context.actorUserId,
    )
  }

  completeFlexibleGoal(command: CompleteFlexibleGoalCommand) {
    return this.completeItemNow({
      context: command.context,
      input: { ...command.input, steps: [] },
      itemId: command.itemId,
    })
  }

  completeCourseSession(command: CompleteCourseSessionCommand) {
    return this.completeItemNow({
      context: command.context,
      input: { ...command.input, steps: [] },
      itemId: command.itemId,
    })
  }

  skipOccurrence(command: SkipSelfCareOccurrenceCommand) {
    return this.recordOccurrenceStatus(
      command.context,
      command.occurrenceId,
      'skipped',
      command.input.reason,
    )
  }

  moveOccurrence(command: MoveSelfCareOccurrenceCommand) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const occurrence = this.mapOccurrence(
          await this.loadOccurrenceRow(
            trx,
            command.context.actorUserId,
            command.occurrenceId,
          ),
        )
        const completion = createCompletionRecord(
          {
            alternativeTitle: null,
            completedVariant: null,
            durationMinutes: null,
            energyAfter: null,
            energyBefore: null,
            measurementUnit: null,
            measurementValue: null,
            moodAfter: null,
            moodBefore: null,
            note: command.input.note,
            status: 'moved',
          },
          {
            itemId: occurrence.itemId,
            occurrence,
            userId: command.context.actorUserId,
          },
        )
        await this.insertCompletion(
          trx,
          completion,
          command.context.actorUserId,
        )
        const next = updateOccurrenceStatus(occurrence, 'moved', {
          movedTo: command.input.newDate,
        })
        await this.updateOccurrence(trx, next, command.context.actorUserId)
        return next
      },
      command.context.actorUserId,
    )
  }

  scheduleItem(command: ScheduleSelfCareItemCommand) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const item = this.mapItem(
          await this.loadActiveItemRow(trx, command.context, command.itemId),
        )
        const ruleRow = await trx
          .selectFrom('app.self_care_schedule_rules')
          .selectAll()
          .where('item_id', '=', item.id)
          .executeTakeFirst()
        const scheduleRule = ruleRow ? this.mapRule(ruleRow) : null
        const existingRow = await trx
          .selectFrom('app.self_care_occurrences')
          .selectAll()
          .where('item_id', '=', item.id)
          .where('scheduled_for', '=', command.input.scheduledFor)
          .$if(Boolean(scheduleRule?.allowMultiplePerDay), (query) =>
            query.where('schedule_rule_id', '=', scheduleRule?.id ?? ''),
          )
          .$if(
            Boolean(scheduleRule && !scheduleRule.allowMultiplePerDay),
            (query) =>
              query.where((expressionBuilder) =>
                expressionBuilder.or([
                  expressionBuilder(
                    'schedule_rule_id',
                    '=',
                    scheduleRule?.id ?? '',
                  ),
                  expressionBuilder('schedule_rule_id', 'is', null),
                ]),
              ),
          )
          .$if(!scheduleRule, (query) =>
            query.where('schedule_rule_id', 'is', null),
          )
          .orderBy(sql`case when schedule_rule_id is null then 1 else 0 end`)
          .executeTakeFirst()
        const scheduledTime = command.input.scheduledTime ?? null
        const dueAt = buildDueAt(
          command.input.scheduledFor,
          scheduledTime ?? scheduleRule?.preferredTime ?? null,
        )

        if (existingRow) {
          const occurrence = {
            ...this.mapOccurrence(existingRow),
            completedAt: null,
            dueAt,
            movedTo: null,
            scheduleRuleId: scheduleRule?.id ?? null,
            status: 'scheduled' as const,
            updatedAt: new Date().toISOString(),
          }
          await this.updateOccurrence(
            trx,
            occurrence,
            command.context.actorUserId,
          )

          await this.upsertScheduledDetails(
            trx,
            item,
            occurrence,
            command.input,
          )
          return occurrence
        }

        const occurrence = createOccurrenceRecord({
          dueAt,
          item,
          scheduledFor: command.input.scheduledFor,
          scheduleRule,
        })
        const inserted = await this.insertOccurrence(
          trx,
          occurrence,
          command.context.actorUserId,
        )

        if (inserted) {
          await this.upsertScheduledDetails(trx, item, inserted, command.input)
          return inserted
        }

        const fallback = await trx
          .selectFrom('app.self_care_occurrences')
          .selectAll()
          .where('item_id', '=', item.id)
          .where('scheduled_for', '=', command.input.scheduledFor)
          .$if(Boolean(scheduleRule?.allowMultiplePerDay), (query) =>
            query.where('schedule_rule_id', '=', scheduleRule?.id ?? ''),
          )
          .$if(
            Boolean(scheduleRule && !scheduleRule.allowMultiplePerDay),
            (query) =>
              query.where((expressionBuilder) =>
                expressionBuilder.or([
                  expressionBuilder(
                    'schedule_rule_id',
                    '=',
                    scheduleRule?.id ?? '',
                  ),
                  expressionBuilder('schedule_rule_id', 'is', null),
                ]),
              ),
          )
          .$if(!scheduleRule, (query) =>
            query.where('schedule_rule_id', 'is', null),
          )
          .orderBy(sql`case when schedule_rule_id is null then 1 else 0 end`)
          .executeTakeFirst()

        if (!fallback) {
          throw new HttpError(
            500,
            'self_care_schedule_failed',
            'Self-care occurrence was not scheduled.',
          )
        }

        const mappedFallback = this.mapOccurrence(fallback)
        await this.upsertScheduledDetails(
          trx,
          item,
          mappedFallback,
          command.input,
        )
        return mappedFallback
      },
      command.context.actorUserId,
    )
  }

  cancelOccurrence(command: CancelSelfCareOccurrenceCommand) {
    return this.recordOccurrenceStatus(
      command.context,
      command.occurrenceId,
      'cancelled',
      '',
    )
  }

  async getDailyState(context: SelfCareReadContext, date: string) {
    const state = await this.loadState(context)
    return state.dailyStates.find((item) => item.date === date) ?? null
  }

  async upsertDailyState(command: UpsertSelfCareDailyStateCommand) {
    const record = createDailyStateRecord(command.date, command.input, {
      userId: command.context.actorUserId,
    })
    const row = await withWriteTransaction(
      this.db,
      command.context.auth,
      (trx) =>
        trx
          .insertInto('app.self_care_daily_states')
          .values({
            date: record.date,
            energy: record.energy,
            id: record.id,
            mood: record.mood,
            note: record.note,
            pain: record.pain,
            sleep_quality: record.sleepQuality,
            stress: record.stress,
            user_id: record.userId,
          })
          .onConflict((conflict) =>
            conflict.columns(['user_id', 'date']).doUpdateSet({
              energy: record.energy,
              mood: record.mood,
              note: record.note,
              pain: record.pain,
              sleep_quality: record.sleepQuality,
              stress: record.stress,
            }),
          )
          .returningAll()
          .executeTakeFirstOrThrow(),
      command.context.actorUserId,
    )
    return this.mapDailyState(row)
  }

  async getSettings(context: SelfCareReadContext) {
    const state = await this.loadState(context)
    return { minimumItems: state.minimumItems, settings: state.settings }
  }

  async updateSettings(command: UpdateSelfCareSettingsCommand) {
    await this.upsertSettings(command.context, command.input)
    return this.getSettings(command.context)
  }

  async enableGentleMode(command: ToggleSelfCareGentleModeCommand) {
    await this.upsertSettings(
      command.context,
      {},
      { gentleModeDate: command.date, gentleModeEnabledToday: true },
    )
    return this.getSettings(command.context)
  }

  async disableGentleMode(command: ToggleSelfCareGentleModeCommand) {
    await this.upsertSettings(
      command.context,
      {},
      { gentleModeDate: command.date, gentleModeEnabledToday: false },
    )
    return this.getSettings(command.context)
  }

  async updateMinimumItems(command: UpdateSelfCareMinimumItemsCommand) {
    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        await trx
          .deleteFrom('app.self_care_minimum_items')
          .where('user_id', '=', command.context.actorUserId)
          .execute()
        for (const [index, item] of command.input.items.entries()) {
          const record = createMinimumItemRecord(item, {
            index,
            userId: command.context.actorUserId,
          })
          await trx
            .insertInto('app.self_care_minimum_items')
            .values({
              id: record.id,
              is_active: record.isActive,
              linked_item_id: record.linkedItemId,
              sort_order: record.order,
              title: record.title,
              user_id: record.userId,
            })
            .execute()
        }
      },
      command.context.actorUserId,
    )
    return this.getSettings(command.context)
  }

  async updateRitualSteps(command: UpdateSelfCareRitualStepsCommand) {
    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        await this.loadActiveItemRow(trx, command.context, command.itemId)
        await trx
          .deleteFrom('app.self_care_ritual_step_drafts')
          .where('item_id', '=', command.itemId)
          .execute()
        await trx
          .deleteFrom('app.self_care_ritual_steps')
          .where('item_id', '=', command.itemId)
          .execute()
        for (const [index, step] of command.steps.entries()) {
          await this.insertStep(
            trx,
            createRitualStepRecord(command.itemId, step, index),
          )
        }
      },
      command.context.actorUserId,
    )
    return this.listItems(command.context)
  }

  async getRitualStepDrafts(command: GetSelfCareRitualStepDraftsCommand) {
    const actorUserId =
      command.context.actorUserId ??
      (await this.findUserIdForWorkspace(
        command.context.workspaceId,
        command.context.auth,
      ))

    if (!actorUserId) {
      return { date: command.date, drafts: [] }
    }

    const rows = await withOptionalRls(
      this.db,
      command.context.auth,
      (executor) =>
        executor
          .selectFrom('app.self_care_ritual_step_drafts')
          .selectAll()
          .where('workspace_id', '=', command.context.workspaceId)
          .where('user_id', '=', actorUserId)
          .where('date', '=', command.date)
          .execute(),
      actorUserId,
    )

    return {
      date: command.date,
      drafts: rows.map((row) =>
        toPublicRitualStepDraft(this.mapStepDraft(row)),
      ),
    }
  }

  async upsertRitualStepDraft(command: UpsertSelfCareRitualStepDraftCommand) {
    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const itemRow = await this.loadActiveItemRow(
          trx,
          command.context,
          command.input.itemId,
        )

        if (command.input.occurrenceId) {
          const occurrenceRow = await this.loadOccurrenceRow(
            trx,
            command.context.actorUserId,
            command.input.occurrenceId,
          )

          if (occurrenceRow.item_id !== itemRow.id) {
            throw new HttpError(
              400,
              'self_care_ritual_step_draft_occurrence_mismatch',
              'Self-care occurrence does not belong to this item.',
            )
          }
        }

        await this.assertRitualStepDraftSteps(trx, {
          itemId: itemRow.id,
          stepIds: command.input.stepIds,
        })
        await this.deleteRitualStepDraftRow(trx, {
          date: command.input.date,
          itemId: itemRow.id,
          occurrenceId: command.input.occurrenceId,
          userId: command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        await trx
          .insertInto('app.self_care_ritual_step_drafts')
          .values({
            date: command.input.date,
            item_id: itemRow.id,
            occurrence_id: command.input.occurrenceId,
            step_ids: [...new Set(command.input.stepIds)],
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .execute()
      },
      command.context.actorUserId,
    )

    return this.getRitualStepDrafts({
      context: command.context,
      date: command.input.date,
    })
  }

  async deleteRitualStepDraft(command: DeleteSelfCareRitualStepDraftCommand) {
    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        await this.loadActiveItemRow(trx, command.context, command.itemId)
        await this.deleteRitualStepDraftRow(trx, {
          date: command.date,
          itemId: command.itemId,
          occurrenceId: command.occurrenceId,
          userId: command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
      },
      command.context.actorUserId,
    )

    return this.getRitualStepDrafts({
      context: command.context,
      date: command.date,
    })
  }

  async getHistory(context: SelfCareReadContext, from: string, to: string) {
    return buildHistoryResponse({
      from,
      state: await this.loadState(context),
      to,
    })
  }

  async getAnalytics(context: SelfCareReadContext, from: string, to: string) {
    return buildAnalyticsResponse({
      from,
      state: await this.loadState(context),
      to,
    })
  }

  async listTemplates(context: SelfCareReadContext) {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        executor.selectFrom('app.self_care_templates').selectAll().execute(),
      context.actorUserId,
    )
    const templates = rows.map((row) => this.mapTemplate(row))
    return templates.length > 0 ? templates : buildSystemSelfCareTemplates()
  }

  async createItemFromTemplate(command: CreateSelfCareItemFromTemplateCommand) {
    const templates = await this.listTemplates(command.context)
    const template = templates.find(
      (candidate) => candidate.id === command.templateId,
    )
    if (!template) {
      throw new HttpError(
        404,
        'self_care_template_not_found',
        'Self-care template not found.',
      )
    }
    const records = createSelfCareRecords(
      buildItemInputFromTemplate(template, command.input.overrides),
      {
        actorUserId: command.context.actorUserId,
        createdFromTemplateId: template.id,
        workspaceId: command.context.workspaceId,
      },
    )
    await withWriteTransaction(
      this.db,
      command.context.auth,
      (trx) =>
        this.insertCreatedRecords(trx, records, command.context.actorUserId),
      command.context.actorUserId,
    )
    return records.item
  }

  private async setArchiveState(
    context: ArchiveSelfCareItemCommand['context'],
    itemId: string,
    isArchived: boolean,
  ) {
    const row = await withWriteTransaction(
      this.db,
      context.auth,
      async (trx) => {
        const updated = await trx
          .updateTable('app.self_care_items')
          .set({
            is_active: isArchived ? false : true,
            is_archived: isArchived,
            updated_by: context.actorUserId,
          })
          .where('id', '=', itemId)
          .where('workspace_id', '=', context.workspaceId)
          .where('user_id', '=', context.actorUserId)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst()

        if (updated?.migrated_from_habit_id) {
          await this.updateMigratedHabitState(trx, context, {
            habitId: updated.migrated_from_habit_id,
            isActive: !isArchived,
          })
        }

        return updated
      },
      context.actorUserId,
    )
    if (!row)
      throw new HttpError(
        404,
        'self_care_item_not_found',
        'Self-care item not found.',
      )
    return this.mapItem(row)
  }

  private async updateMigratedHabitState(
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

  private async recordOccurrenceStatus(
    context: SkipSelfCareOccurrenceCommand['context'],
    occurrenceId: string,
    status: 'cancelled' | 'skipped',
    note: string,
  ) {
    return withWriteTransaction(
      this.db,
      context.auth,
      async (trx) => {
        const occurrence = this.mapOccurrence(
          await this.loadOccurrenceRow(trx, context.actorUserId, occurrenceId),
        )
        const completion = createCompletionRecord(
          {
            alternativeTitle: null,
            completedVariant: null,
            durationMinutes: null,
            energyAfter: null,
            energyBefore: null,
            measurementUnit: null,
            measurementValue: null,
            moodAfter: null,
            moodBefore: null,
            note,
            status,
          },
          {
            itemId: occurrence.itemId,
            occurrence,
            userId: context.actorUserId,
          },
        )
        await this.insertCompletion(trx, completion, context.actorUserId)
        const next = updateOccurrenceStatus(occurrence, status)
        await this.updateOccurrence(trx, next, context.actorUserId)
        return next
      },
      context.actorUserId,
    )
  }

  private async generateReadOccurrences(
    context: SelfCareReadContext,
    from: string,
    to: string,
  ) {
    const actorUserId =
      context.actorUserId ??
      (await this.findUserIdForWorkspace(context.workspaceId, context.auth))

    if (!actorUserId) {
      return
    }

    await this.generateOccurrences({
      context: { ...context, actorUserId },
      from,
      to,
    })
  }

  private async findUserIdForWorkspace(
    workspaceId: string,
    auth: SelfCareReadContext['auth'],
  ): Promise<string | null> {
    return withOptionalRls(this.db, auth, async (executor) => {
      const row = await executor
        .selectFrom('app.self_care_items')
        .select('user_id')
        .where('workspace_id', '=', workspaceId)
        .where('deleted_at', 'is', null)
        .orderBy('created_at asc')
        .executeTakeFirst()

      return row?.user_id ?? null
    })
  }

  private async loadProgressCompletionForDate(
    executor: DatabaseExecutor,
    input: {
      date: string
      itemId: string
      userId: string
    },
  ): Promise<StoredSelfCareCompletionRecord | null> {
    const rows = await executor
      .selectFrom('app.self_care_completions')
      .selectAll()
      .where('user_id', '=', input.userId)
      .where('item_id', '=', input.itemId)
      .execute()

    return (
      rows
        .map((row) => this.mapCompletion(row))
        .filter(
          (completion) =>
            completion.completedAt.slice(0, 10) === input.date &&
            isCompletionProgressStatus(completion.status),
        )
        .sort((left, right) =>
          right.completedAt.localeCompare(left.completedAt),
        )[0] ?? null
    )
  }

  private async markMissedOccurrences(
    context: SelfCareReadContext,
    date: string,
  ) {
    if (!context.actorUserId) {
      return
    }

    const actorUserId = context.actorUserId
    const state = await this.loadState(context)
    const itemById = new Map(state.items.map((item) => [item.id, item]))
    const missedOccurrenceIds = state.occurrences
      .filter((occurrence) => {
        const item = itemById.get(occurrence.itemId)
        return item
          ? shouldMarkSelfCareOccurrenceMissed({
              date,
              item,
              occurrence,
              state,
            })
          : false
      })
      .map((occurrence) => occurrence.id)

    if (missedOccurrenceIds.length === 0) {
      return
    }

    await withWriteTransaction(
      this.db,
      context.auth,
      (trx) =>
        trx
          .updateTable('app.self_care_occurrences')
          .set({
            status: 'missed',
            updated_by: actorUserId,
          })
          .where('user_id', '=', actorUserId)
          .where('status', '=', 'scheduled')
          .where('id', 'in', missedOccurrenceIds)
          .execute(),
      actorUserId,
    )
  }

  private async loadState(context: SelfCareReadContext) {
    const actorUserId = context.actorUserId
    const [
      itemRows,
      alternativeRows,
      ruleRows,
      occurrenceRows,
      completionRows,
      stepRows,
      stepCompletionRows,
      procedureRows,
      appointmentRows,
      medicalRows,
      measurementRows,
      courseRows,
      dailyStateRows,
      settingsRows,
      minimumRows,
      templateRows,
    ] = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const itemQuery = executor
          .selectFrom('app.self_care_items')
          .selectAll()
          .where('workspace_id', '=', context.workspaceId)
          .where('deleted_at', 'is', null)
        const items = actorUserId
          ? await itemQuery.where('user_id', '=', actorUserId).execute()
          : await itemQuery.execute()
        const itemIds = items.map((item) => item.id)
        const userId =
          actorUserId ??
          items[0]?.user_id ??
          '00000000-0000-0000-0000-000000000000'

        return [
          items,
          await selectChildren(
            executor,
            'app.self_care_item_alternatives',
            itemIds,
          ),
          await selectChildren(
            executor,
            'app.self_care_schedule_rules',
            itemIds,
          ),
          await (actorUserId
            ? executor
                .selectFrom('app.self_care_occurrences')
                .selectAll()
                .where('user_id', '=', actorUserId)
                .execute()
            : executor
                .selectFrom('app.self_care_occurrences')
                .selectAll()
                .execute()),
          await (actorUserId
            ? executor
                .selectFrom('app.self_care_completions')
                .selectAll()
                .where('user_id', '=', actorUserId)
                .execute()
            : executor
                .selectFrom('app.self_care_completions')
                .selectAll()
                .execute()),
          await selectChildren(executor, 'app.self_care_ritual_steps', itemIds),
          await executor
            .selectFrom('app.self_care_ritual_step_completions')
            .selectAll()
            .execute(),
          await selectChildren(
            executor,
            'app.self_care_procedure_details',
            itemIds,
          ),
          await selectChildren(
            executor,
            'app.self_care_appointment_details',
            itemIds,
          ),
          await selectChildren(
            executor,
            'app.self_care_medical_details',
            itemIds,
          ),
          await selectChildren(
            executor,
            'app.self_care_measurement_details',
            itemIds,
          ),
          await selectChildren(
            executor,
            'app.self_care_course_details',
            itemIds,
          ),
          await executor
            .selectFrom('app.self_care_daily_states')
            .selectAll()
            .where('user_id', '=', userId)
            .execute(),
          await executor
            .selectFrom('app.self_care_settings')
            .selectAll()
            .where('user_id', '=', userId)
            .execute(),
          await executor
            .selectFrom('app.self_care_minimum_items')
            .selectAll()
            .where('user_id', '=', userId)
            .execute(),
          await executor
            .selectFrom('app.self_care_templates')
            .selectAll()
            .execute(),
        ] as const
      },
      context.actorUserId,
    )
    const userId =
      actorUserId ??
      itemRows[0]?.user_id ??
      '00000000-0000-0000-0000-000000000000'
    const settings = settingsRows[0]
      ? this.mapSettings(settingsRows[0])
      : createDefaultSelfCareSettings({ userId })
    const minimumItems =
      minimumRows.length > 0
        ? minimumRows.map((row) => this.mapMinimum(row))
        : createDefaultMinimumItems(userId)

    return {
      alternatives: alternativeRows.map((row) => this.mapAlternative(row)),
      appointmentDetails: appointmentRows.map((row) =>
        this.mapAppointment(row),
      ),
      completions: completionRows.map((row) => this.mapCompletion(row)),
      courseDetails: courseRows.map((row) => this.mapCourse(row)),
      dailyStates: dailyStateRows.map((row) => this.mapDailyState(row)),
      items: itemRows.map((row) => this.mapItem(row)),
      medicalDetails: medicalRows.map((row) => this.mapMedical(row)),
      measurementDetails: measurementRows.map((row) =>
        this.mapMeasurement(row),
      ),
      minimumItems,
      occurrences: occurrenceRows.map((row) => this.mapOccurrence(row)),
      procedureDetails: procedureRows.map((row) => this.mapProcedure(row)),
      scheduleRules: ruleRows.map((row) => this.mapRule(row)),
      settings,
      stepCompletions: stepCompletionRows.map((row) =>
        this.mapStepCompletion(row),
      ),
      steps: stepRows.map((row) => this.mapStep(row)),
      templates: templateRows.map((row) => this.mapTemplate(row)),
    }
  }

  private async insertCreatedRecords(
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
    if (records.courseDetails)
      await this.insertCourseDetails(executor, records.courseDetails)
  }

  private insertScheduleRule(
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

  private async upsertScheduleRule(
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

    await this.relinkOpenOccurrencesToScheduleRule(
      executor,
      existing.id,
      rule,
      actorUserId,
    )

    return existing.id
  }

  private async relinkOpenOccurrencesToScheduleRule(
    executor: DatabaseExecutor,
    scheduleRuleId: string,
    rule: SelfCareScheduleRule,
    actorUserId: string,
  ) {
    await executor
      .updateTable('app.self_care_occurrences')
      .set({
        schedule_rule_id: scheduleRuleId,
        updated_by: actorUserId,
      })
      .where('item_id', '=', rule.itemId)
      .where('schedule_rule_id', 'is', null)
      .where('completed_at', 'is', null)
      .where('status', 'in', ['scheduled', 'missed'])
      .execute()
  }

  private insertStep(executor: DatabaseExecutor, step: SelfCareRitualStep) {
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

  private insertProcedureDetails(
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

  private insertAppointmentDetails(
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

  private async upsertScheduledDetails(
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

  private insertMedicalDetails(
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

  private insertMeasurementDetails(
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

  private insertCourseDetails(
    executor: DatabaseExecutor,
    details: SelfCareCourseDetails,
  ) {
    return executor
      .insertInto('app.self_care_course_details')
      .values({
        completed_count: details.completedCount,
        course_type: details.courseType,
        end_date: details.endDate,
        id: details.id,
        is_completed: details.isCompleted,
        is_paused: details.isPaused,
        item_id: details.itemId,
        start_date: details.startDate,
        total_count: details.totalCount,
      })
      .execute()
  }

  private async insertOccurrence(
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
          scheduled_for: occurrence.scheduledFor,
          schedule_rule_id: occurrence.scheduleRuleId,
          status: occurrence.status,
          updated_by: actorUserId,
          user_id: occurrence.userId,
        })
        .returningAll()
        .executeTakeFirst()
      return row ? this.mapOccurrence(row) : null
    } catch (error) {
      if (getDatabaseErrorCode(error) === '23505') {
        return null
      }

      throw error
    }
  }

  private insertCompletion(
    executor: DatabaseExecutor,
    completion: SelfCareCompletion,
    actorUserId: string,
  ) {
    return executor
      .insertInto('app.self_care_completions')
      .values({
        alternative_title: completion.alternativeTitle,
        completed_at: completion.completedAt,
        completed_variant: completion.completedVariant,
        created_by: actorUserId,
        duration_minutes: completion.durationMinutes,
        energy_after: completion.energyAfter,
        energy_before: completion.energyBefore,
        id: completion.id,
        item_id: completion.itemId,
        measurement_unit: completion.measurementUnit,
        measurement_value: completion.measurementValue,
        mood_after: completion.moodAfter,
        mood_before: completion.moodBefore,
        note: completion.note,
        occurrence_id: completion.occurrenceId,
        scheduled_for: completion.scheduledFor,
        status: completion.status,
        user_id: completion.userId,
      })
      .execute()
  }

  private updateOccurrence(
    executor: DatabaseExecutor,
    occurrence: SelfCareOccurrence,
    actorUserId: string,
  ) {
    return executor
      .updateTable('app.self_care_occurrences')
      .set({
        completed_at: occurrence.completedAt,
        due_at: occurrence.dueAt,
        moved_to: occurrence.movedTo,
        status: occurrence.status,
        updated_by: actorUserId,
      })
      .where('id', '=', occurrence.id)
      .execute()
  }

  private async incrementCourse(executor: DatabaseExecutor, itemId: string) {
    const row = await executor
      .selectFrom('app.self_care_course_details')
      .selectAll()
      .where('item_id', '=', itemId)
      .executeTakeFirst()
    if (!row || row.is_completed) return
    const completedCount = Math.min(row.total_count, row.completed_count + 1)
    await executor
      .updateTable('app.self_care_course_details')
      .set({
        completed_count: completedCount,
        is_completed: completedCount >= row.total_count,
      })
      .where('id', '=', row.id)
      .execute()
  }

  private async upsertSettings(
    context: UpdateSelfCareSettingsCommand['context'],
    input: Partial<UpdateSelfCareSettingsCommand['input']>,
    overrides: Partial<
      Pick<SelfCareSettings, 'gentleModeDate' | 'gentleModeEnabledToday'>
    > = {},
  ) {
    const defaults = createDefaultSelfCareSettings({
      userId: context.actorUserId,
    })
    await withWriteTransaction(
      this.db,
      context.auth,
      (trx) =>
        trx
          .insertInto('app.self_care_settings')
          .values({
            currency: input.currency ?? defaults.currency,
            default_reminder_tone: defaults.defaultReminderTone,
            gentle_mode_date:
              overrides.gentleModeDate ?? defaults.gentleModeDate,
            gentle_mode_enabled_today:
              overrides.gentleModeEnabledToday ??
              defaults.gentleModeEnabledToday,
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
          })
          .onConflict((conflict) =>
            conflict.column('user_id').doUpdateSet({
              ...(input.currency !== undefined
                ? { currency: input.currency }
                : {}),
              ...(input.showAppointmentsInCalendar !== undefined
                ? {
                    show_appointments_in_calendar:
                      input.showAppointmentsInCalendar,
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
              updated_at: sql`now()`,
            }),
          )
          .execute(),
      context.actorUserId,
    )
  }

  private async loadOccurrenceRow(
    executor: DatabaseExecutor,
    userId: string,
    occurrenceId: string,
  ) {
    const row = await executor
      .selectFrom('app.self_care_occurrences')
      .selectAll()
      .where('id', '=', occurrenceId)
      .where('user_id', '=', userId)
      .executeTakeFirst()
    if (!row)
      throw new HttpError(
        404,
        'self_care_occurrence_not_found',
        'Self-care occurrence not found.',
      )
    return row
  }

  private async loadActiveItemRow(
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
      .where('is_archived', '=', false)
      .executeTakeFirst()
    if (!row)
      throw new HttpError(
        404,
        'self_care_item_not_found',
        'Self-care item not found.',
      )
    return row
  }

  private async assertRitualStepDraftSteps(
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

  private deleteRitualStepDraftRow(
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

  private mapItem(row: ItemRow): StoredSelfCareItemRecord {
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

  private mapAlternative(row: AlternativeRow): SelfCareItemAlternative {
    return {
      countsAsCompletion: row.counts_as_completion,
      description: row.description,
      id: row.id,
      itemId: row.item_id,
      title: row.title,
    }
  }

  private mapRule(row: RuleRow): SelfCareScheduleRule {
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

  private mapOccurrence(row: OccurrenceRow): StoredSelfCareOccurrenceRecord {
    return {
      completedAt: serializeNullableTimestamp(row.completed_at),
      createdAt: serializeTimestamp(row.created_at),
      dueAt: serializeNullableTimestamp(row.due_at),
      generatedAt: serializeNullableTimestamp(row.generated_at),
      id: row.id,
      itemId: row.item_id,
      movedTo: serializeNullableDate(row.moved_to),
      scheduledFor: serializeDate(row.scheduled_for),
      scheduleRuleId: row.schedule_rule_id,
      status: row.status,
      updatedAt: serializeTimestamp(row.updated_at),
      userId: row.user_id,
    }
  }

  private mapCompletion(row: CompletionRow): StoredSelfCareCompletionRecord {
    return {
      alternativeTitle: row.alternative_title,
      completedAt: serializeTimestamp(row.completed_at),
      completedVariant: row.completed_variant,
      createdAt: serializeTimestamp(row.created_at),
      durationMinutes: row.duration_minutes,
      energyAfter: row.energy_after,
      energyBefore: row.energy_before,
      id: row.id,
      itemId: row.item_id,
      measurementUnit: row.measurement_unit,
      measurementValue:
        row.measurement_value === null ? null : Number(row.measurement_value),
      moodAfter: row.mood_after,
      moodBefore: row.mood_before,
      note: row.note,
      occurrenceId: row.occurrence_id,
      scheduledFor: serializeNullableDate(row.scheduled_for),
      status: row.status,
      userId: row.user_id,
    }
  }

  private mapStep(row: StepRow): SelfCareRitualStep {
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

  private mapStepCompletion(
    row: StepCompletionRow,
  ): SelfCareRitualStepCompletion {
    return {
      completionId: row.completion_id,
      id: row.id,
      isDone: row.is_done,
      stepId: row.step_id,
    }
  }

  private mapStepDraft(row: StepDraftRow): StoredSelfCareRitualStepDraftRecord {
    return {
      date: serializeDate(row.date),
      itemId: row.item_id,
      occurrenceId: row.occurrence_id,
      stepIds: parseJsonArray<string>(row.step_ids, []),
      userId: row.user_id,
      workspaceId: row.workspace_id,
    }
  }

  private mapProcedure(row: ProcedureRow): SelfCareProcedureDetails {
    return {
      contact: row.contact,
      createdAt: serializeTimestamp(row.created_at),
      currency: row.currency,
      defaultPrice:
        row.default_price === null ? null : Number(row.default_price),
      id: row.id,
      itemId: row.item_id,
      place: row.place,
      specialistName: row.specialist_name,
      updatedAt: serializeTimestamp(row.updated_at),
    }
  }

  private mapAppointment(row: AppointmentRow): SelfCareAppointmentDetails {
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

  private mapMedical(row: MedicalRow): SelfCareMedicalDetails {
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

  private mapMeasurement(row: MeasurementRow): SelfCareMeasurementDetails {
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

  private mapCourse(row: CourseRow): SelfCareCourseDetails {
    return {
      completedCount: row.completed_count,
      courseType: row.course_type,
      createdAt: serializeTimestamp(row.created_at),
      endDate: serializeNullableDate(row.end_date),
      id: row.id,
      isCompleted: row.is_completed,
      isPaused: row.is_paused,
      itemId: row.item_id,
      startDate: serializeNullableDate(row.start_date),
      totalCount: row.total_count,
      updatedAt: serializeTimestamp(row.updated_at),
    }
  }

  private mapDailyState(row: DailyStateRow): SelfCareDailyState {
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

  private mapTemplate(row: TemplateRow): SelfCareTemplate {
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

  private mapSettings(row: SettingsRow): SelfCareSettings {
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

  private mapMinimum(row: MinimumRow): SelfCareMinimumItem {
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
}

async function selectChildren<TTable extends keyof DatabaseSchema>(
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

function mapCompletionStatusToOccurrenceStatus(
  status: StoredSelfCareCompletionRecord['status'],
): StoredSelfCareOccurrenceRecord['status'] {
  if (status === 'alternative_done') return 'partial'
  return status
}

function toPublicRitualStepDraft(
  draft: StoredSelfCareRitualStepDraftRecord,
): SelfCareRitualStepDraft {
  return {
    date: draft.date,
    itemId: draft.itemId,
    occurrenceId: draft.occurrenceId,
    stepIds: draft.stepIds,
  }
}

function assertMeasurementCompletionInput(
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

function assertMoodCheckCompletionInput(
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

function hasScheduleDetails(
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

function shouldStoreAppointmentDetails(
  item: StoredSelfCareItemRecord,
  input: ScheduleSelfCareItemCommand['input'],
): boolean {
  return (
    item.type === 'appointment' ||
    Boolean(input.scheduledTime) ||
    hasScheduleDetails(input)
  )
}

function buildScheduleDetailsStartsAt(scheduledFor: string): string {
  return `${scheduledFor}T00:00:00.000Z`
}
