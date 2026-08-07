import {
  getDayRangeUtc,
  type SelfCareAppointmentDetails,
  type SelfCareCompletion,
  type SelfCareCourseDetails,
  type SelfCareExerciseDetails,
  type SelfCareMeasurementDetails,
  type SelfCareMedicalDetails,
  type SelfCareOccurrence,
  selfCareOfflineCommandResultSchema,
  type SelfCareProcedureDetails,
  type SelfCareRitualStep,
  type SelfCareScheduleRule,
  type SelfCareSettings,
} from '@planner/contracts'
import { type Kysely, sql, type Transaction } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import { getDatabaseErrorCode } from '../../infrastructure/db/errors.js'
import {
  type DatabaseExecutor,
  withOptionalRls as withRootOptionalRls,
  withWriteTransaction as withRootWriteTransaction,
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
  ExecuteSelfCareOfflineCommand,
  ExecuteSelfCareOfflineCommandResult,
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
  SelfCareWriteContext,
  SkipSelfCareOccurrenceCommand,
  StoredSelfCareCompletionRecord,
  StoredSelfCareItemRecord,
  StoredSelfCareOccurrenceRecord,
  ToggleSelfCareGentleModeCommand,
  UpdateSelfCareCompletionCommand,
  UpdateSelfCareItemCommand,
  UpdateSelfCareMinimumItemsCommand,
  UpdateSelfCareRitualStepsCommand,
  UpdateSelfCareSettingsCommand,
  UpsertSelfCareDailyStateCommand,
  UpsertSelfCareRitualStepDraftCommand,
} from './self-care.model.js'
import {
  dispatchSelfCareOfflineCommand,
  fingerprintSelfCareCommandRequest,
} from './self-care.offline-command.js'
import type { SelfCareRepository } from './self-care.repository.js'
import {
  assertExerciseCompletionInput,
  assertMeasurementCompletionInput,
  assertMoodCheckCompletionInput,
  buildScheduleDetailsStartsAt,
  hasScheduleDetails,
  mapCompletionRow,
  mapCompletionStatusToOccurrenceStatus,
  mapDailyStateRow,
  mapItemRow,
  mapOccurrenceRow,
  mapRuleRow,
  mapStepDraftRow,
  mapStepRow,
  mapTemplateRow,
  shouldStoreAppointmentDetails,
  toPublicRitualStepDraft,
} from './self-care.repository.postgres.helpers.js'
import { PostgresSelfCareReadModelLoader } from './self-care.repository.postgres.read-model.js'
import {
  addDays,
  buildAnalyticsResponse,
  buildDashboardResponse,
  buildHistoryResponse,
  buildItemInputFromTemplate,
  buildPlanResponse,
  buildSelfCareListResponse,
  buildSystemSelfCareTemplates,
  createAppointmentDetailsRecord,
  createCompletionRecord,
  createCourseDetailsRecord,
  createDailyStateRecord,
  createDefaultSelfCareSettings,
  createExerciseDetailsRecord,
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
  serializeTimestamp,
  shouldDeactivateCompletedFlexibleGoal,
  shouldDeduplicateSelfCareItemCompletion,
  updateOccurrenceStatus,
} from './self-care.shared.js'
import {
  createSelfCareReadGenerationKey,
  SelfCareReadGenerationCoordinator,
} from './self-care-read-generation-coordinator.js'

function withWriteTransaction<T>(
  db: Kysely<DatabaseSchema>,
  auth: SelfCareWriteContext['auth'],
  callback: (trx: Transaction<DatabaseSchema>) => Promise<T>,
  actorUserId?: string,
): Promise<T> {
  if (db.isTransaction) {
    return callback(db as Transaction<DatabaseSchema>)
  }

  return withRootWriteTransaction(db, auth, callback, actorUserId)
}

function withOptionalRls<T>(
  db: Kysely<DatabaseSchema>,
  auth: SelfCareReadContext['auth'],
  callback: (executor: DatabaseExecutor) => Promise<T>,
  actorUserId?: string,
): Promise<T> {
  if (db.isTransaction) {
    return callback(db)
  }

  return withRootOptionalRls(db, auth, callback, actorUserId)
}

export class PostgresSelfCareRepository implements SelfCareRepository {
  private readonly readModels: PostgresSelfCareReadModelLoader
  private readonly readGenerationCoordinator =
    new SelfCareReadGenerationCoordinator<SelfCareWriteContext>()

  constructor(private readonly db: Kysely<DatabaseSchema>) {
    this.readModels = new PostgresSelfCareReadModelLoader(db)
  }

  executeOfflineCommand(
    command: ExecuteSelfCareOfflineCommand,
  ): Promise<ExecuteSelfCareOfflineCommandResult> {
    const fingerprint = fingerprintSelfCareCommandRequest(command.request)

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        await sql`
          select app.lock_self_care_command_operation(
            ${command.context.workspaceId},
            ${command.context.actorUserId},
            ${command.request.operationId}
          )
        `.execute(trx)

        const receipt = await sql<{
          request_fingerprint: string
          response: unknown
        }>`
          select request_fingerprint, response
          from app.read_self_care_command_receipt(
            ${command.context.workspaceId},
            ${command.context.actorUserId},
            ${command.request.operationId}
          )
        `.execute(trx)
        const existing = receipt.rows[0]

        if (existing) {
          if (existing.request_fingerprint !== fingerprint) {
            throw new HttpError(
              409,
              'self_care_operation_id_reused',
              'The self-care operation identifier was already used for a different command.',
            )
          }

          return {
            operationId: command.request.operationId,
            replayed: true,
            result: selfCareOfflineCommandResultSchema.parse(existing.response),
          }
        }

        const transactionalRepository = new PostgresSelfCareRepository(trx)
        const result = selfCareOfflineCommandResultSchema.parse(
          await dispatchSelfCareOfflineCommand(
            transactionalRepository,
            command.context,
            command.dispatchCommand ?? command.request.command,
          ),
        )

        await sql`
          select app.record_self_care_command_receipt(
            ${command.context.workspaceId},
            ${command.context.actorUserId},
            ${command.request.operationId},
            ${fingerprint},
            ${JSON.stringify(result)}::jsonb
          )
        `.execute(trx)

        return {
          operationId: command.request.operationId,
          replayed: false,
          result,
        }
      },
      command.context.actorUserId,
    )
  }

  async listItems(
    context: SelfCareReadContext,
    filters: SelfCareListFilters = {},
  ) {
    return buildSelfCareListResponse(
      await this.readModels.loadListItemsReadModel(context),
      filters,
    )
  }

  async createItem(command: CreateSelfCareItemCommand) {
    const records = createSelfCareRecords(command.input, {
      actorUserId: command.context.actorUserId,
      clientTimeZone: command.context.clientTimeZone,
      workspaceId: command.context.workspaceId,
    })

    try {
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
    } catch (error) {
      if (getDatabaseErrorCode(error) === '23505') {
        throw new HttpError(
          409,
          'self_care_item_id_conflict',
          'The self-care item identifier is already in use.',
        )
      }

      throw error
    }

    return records.item
  }

  async updateItem(command: UpdateSelfCareItemCommand) {
    try {
      return await withWriteTransaction(
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
            if (command.input.expectedVersion !== undefined) {
              const current = await trx
                .selectFrom('app.self_care_items')
                .select(['id', 'version'])
                .where('id', '=', command.itemId)
                .where('workspace_id', '=', command.context.workspaceId)
                .where('user_id', '=', command.context.actorUserId)
                .where('deleted_at', 'is', null)
                .where('is_archived', '=', false)
                .executeTakeFirst()

              if (current) {
                assertSelfCareVersion(
                  'item',
                  current.id,
                  command.input.expectedVersion,
                  Number(current.version),
                )
              }
            }

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

          if (command.input.exerciseDetails) {
            await trx
              .deleteFrom('app.self_care_exercise_details')
              .where('item_id', '=', command.itemId)
              .execute()
            await this.insertExerciseDetails(
              trx,
              createExerciseDetailsRecord(
                command.itemId,
                command.input.exerciseDetails,
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

          return mapItemRow(updated)
        },
        command.context.actorUserId,
      )
    } catch (error) {
      if (getDatabaseErrorCode(error) === '23505') {
        throw new HttpError(
          409,
          'self_care_item_id_conflict',
          'A self-care item identifier is already in use.',
        )
      }

      throw error
    }
  }

  async archiveItem(command: ArchiveSelfCareItemCommand) {
    return this.setArchiveState(
      command.context,
      command.itemId,
      true,
      command.expectedVersion,
    )
  }

  async restoreItem(command: RestoreSelfCareItemCommand) {
    return this.setArchiveState(
      command.context,
      command.itemId,
      false,
      command.expectedVersion,
    )
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
    const state = await this.readModels.loadOccurrenceGenerationReadModel(
      command.context,
      { from: command.from, to: command.to },
    )
    const generated: StoredSelfCareOccurrenceRecord[] = []

    for (const item of state.items) {
      const rule =
        state.scheduleRules.find((candidate) => candidate.itemId === item.id) ??
        null
      const course =
        state.courseDetails.find((candidate) => candidate.itemId === item.id) ??
        null
      generated.push(
        ...generateSelfCareOccurrencesForRange({
          completions: state.completions,
          courseDetails: course,
          existingOccurrences: state.occurrences,
          from: command.from,
          item,
          scheduleRule: rule,
          to: command.to,
        }),
      )
    }

    if (generated.length === 0) {
      return []
    }

    const ruleById = new Map(state.scheduleRules.map((rule) => [rule.id, rule]))

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const occurrences: StoredSelfCareOccurrenceRecord[] = []

        for (const occurrence of generated) {
          const rule = occurrence.scheduleRuleId
            ? (ruleById.get(occurrence.scheduleRuleId) ?? null)
            : null

          occurrences.push({
            ...occurrence,
            dueAt: await this.buildSelfCareDueAt(
              trx,
              occurrence.scheduledFor,
              rule?.preferredTime ?? null,
              rule?.timezone ?? command.context.clientTimeZone ?? null,
            ),
          })
        }

        return this.insertOccurrences(
          trx,
          occurrences,
          command.context.actorUserId,
        )
      },
      command.context.actorUserId,
    )
  }

  async getDashboard(command: GetSelfCareDashboardCommand) {
    await this.generateReadOccurrences(
      command.context,
      command.date,
      command.date,
    )
    return buildDashboardResponse({
      date: command.date,
      state: await this.readModels.loadDashboardReadModel(
        command.context,
        command.date,
      ),
    })
  }

  async getPlan(command: GetSelfCarePlanCommand) {
    await this.generateReadOccurrences(
      command.context,
      command.from,
      command.to,
    )
    return buildPlanResponse({
      from: command.from,
      state: await this.readModels.loadPlanReadModel(
        command.context,
        command.from,
        command.to,
      ),
      to: command.to,
    })
  }

  async getOccurrences(command: GetSelfCareOccurrencesCommand) {
    await this.generateReadOccurrences(
      command.context,
      command.from,
      command.to,
    )
    const state = await this.readModels.loadOccurrencesReadModel(
      command.context,
      command.from,
      command.to,
    )
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
        const { itemRow, occurrenceRow } =
          await this.loadOccurrenceWithActiveItemRowsForUpdate(
            trx,
            command.context,
            command.occurrenceId,
          )
        const occurrence = mapOccurrenceRow(occurrenceRow)
        assertSelfCareVersion(
          'occurrence',
          occurrence.id,
          command.expectedVersion,
          occurrence.version,
        )
        assertSelfCareOccurrenceOpen(occurrence)
        const item = mapItemRow(itemRow)
        assertExerciseCompletionInput(item, command.input)
        assertMeasurementCompletionInput(item, command.input)
        assertMoodCheckCompletionInput(item, command.input)
        const stepRows = await trx
          .selectFrom('app.self_care_ritual_steps')
          .selectAll()
          .where('item_id', '=', item.id)
          .execute()
        const steps = stepRows.map((row) => mapStepRow(row))
        assertRitualCompletionSteps(item.id, steps, command.input.steps)
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
            completionId: command.completionId,
            itemId: item.id,
            occurrence,
            userId: command.context.actorUserId,
          },
        )
        const completionDate = getSelfCareCompletionDateKey(
          command.input,
          command.context.clientTimeZone,
        )
        const exerciseProgressCompletion =
          item.type === 'exercise'
            ? await this.updateOpenExerciseProgressCompletion(trx, {
                completion,
                date: completionDate,
                itemId: item.id,
                plannerTimeZone: command.context.clientTimeZone,
                userId: command.context.actorUserId,
              })
            : null
        const storedCompletion =
          exerciseProgressCompletion ??
          (await this.insertCompletion(
            trx,
            completion,
            command.context.actorUserId,
          ))

        if (!exerciseProgressCompletion) {
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
        }
        await this.updateOccurrence(
          trx,
          updateOccurrenceStatus(
            occurrence,
            mapCompletionStatusToOccurrenceStatus(status),
            { completedAt: storedCompletion.completedAt },
          ),
          command.context.actorUserId,
        )
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
        await this.incrementCourse(trx, item.id, completionDate)
        return storedCompletion
      },
      command.context.actorUserId,
    )
  }

  async completeItemNow(command: CompleteSelfCareItemNowCommand) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const item = mapItemRow(
          await this.loadActiveItemRow(trx, command.context, command.itemId),
        )
        assertSelfCareVersion(
          'item',
          item.id,
          command.expectedVersion,
          item.version,
        )
        assertExerciseCompletionInput(item, command.input)
        assertMeasurementCompletionInput(item, command.input)
        assertMoodCheckCompletionInput(item, command.input)
        const stepRows = await trx
          .selectFrom('app.self_care_ritual_steps')
          .selectAll()
          .where('item_id', '=', item.id)
          .execute()
        const steps = stepRows.map((row) => mapStepRow(row))
        assertRitualCompletionSteps(item.id, steps, command.input.steps)
        const ruleRow = await trx
          .selectFrom('app.self_care_schedule_rules')
          .selectAll()
          .where('item_id', '=', item.id)
          .executeTakeFirst()
        const scheduleRule = ruleRow ? mapRuleRow(ruleRow) : null
        const completionDate = getSelfCareCompletionDateKey(
          command.input,
          command.context.clientTimeZone,
        )
        const existingCompletion = shouldDeduplicateSelfCareItemCompletion({
          item,
          scheduleRule,
        })
          ? await this.loadProgressCompletionForDate(trx, {
              date: completionDate,
              itemId: item.id,
              plannerTimeZone: command.context.clientTimeZone,
              userId: command.context.actorUserId,
            })
          : null

        if (existingCompletion) {
          await this.deleteRitualStepDraftRow(trx, {
            date: completionDate,
            itemId: item.id,
            occurrenceId: null,
            userId: command.context.actorUserId,
            workspaceId: command.context.workspaceId,
          })
          const touchedItem = await trx
            .updateTable('app.self_care_items')
            .set({ updated_by: command.context.actorUserId })
            .where('id', '=', item.id)
            .where('workspace_id', '=', command.context.workspaceId)
            .where('user_id', '=', command.context.actorUserId)
            .where('deleted_at', 'is', null)
            .where('version', '=', item.version)
            .returning('version')
            .executeTakeFirst()

          if (!touchedItem) {
            assertSelfCareVersion('item', item.id, item.version, null)
          }
          return existingCompletion
        }

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
            completionId: command.completionId,
            itemId: item.id,
            scheduledFor: completionDate,
            userId: command.context.actorUserId,
          },
        )
        const exerciseProgressCompletion =
          item.type === 'exercise'
            ? await this.updateOpenExerciseProgressCompletion(trx, {
                completion,
                date: completionDate,
                itemId: item.id,
                plannerTimeZone: command.context.clientTimeZone,
                userId: command.context.actorUserId,
              })
            : null
        const storedCompletion =
          exerciseProgressCompletion ??
          (await this.insertCompletion(
            trx,
            completion,
            command.context.actorUserId,
          ))

        if (!exerciseProgressCompletion) {
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
        }
        await this.deleteRitualStepDraftRow(trx, {
          date: completionDate,
          itemId: item.id,
          occurrenceId: null,
          userId: command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        const deactivated = await this.deactivateFlexibleGoalIfCompleted(trx, {
          actorUserId: command.context.actorUserId,
          completion: storedCompletion,
          item,
          scheduleRule,
        })
        await this.incrementCourse(trx, item.id, completionDate)
        if (!deactivated) {
          await trx
            .updateTable('app.self_care_items')
            .set({ updated_by: command.context.actorUserId })
            .where('id', '=', item.id)
            .where('version', '=', item.version)
            .executeTakeFirstOrThrow()
        }
        return storedCompletion
      },
      command.context.actorUserId,
    )
  }

  completeFlexibleGoal(command: CompleteFlexibleGoalCommand) {
    return this.completeItemNow({
      completionId: command.completionId,
      context: command.context,
      expectedVersion: command.expectedVersion,
      input: { ...command.input, steps: [] },
      itemId: command.itemId,
    })
  }

  completeCourseSession(command: CompleteCourseSessionCommand) {
    return this.completeItemNow({
      completionId: command.completionId,
      context: command.context,
      expectedVersion: command.expectedVersion,
      input: { ...command.input, steps: [] },
      itemId: command.itemId,
    })
  }

  async updateCompletion(command: UpdateSelfCareCompletionCommand) {
    const row = await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const reference = await trx
          .selectFrom('app.self_care_completions as completion')
          .innerJoin(
            'app.self_care_items as item',
            'item.id',
            'completion.item_id',
          )
          .select('completion.item_id')
          .where('completion.id', '=', command.completionId)
          .where('completion.user_id', '=', command.context.actorUserId)
          .where('item.workspace_id', '=', command.context.workspaceId)
          .where('item.user_id', '=', command.context.actorUserId)
          .where('item.deleted_at', 'is', null)
          .executeTakeFirst()

        if (!reference) {
          return null
        }

        const itemRow = await this.loadOwnedItemRowForUpdate(
          trx,
          command.context,
          reference.item_id,
        )
        const current = await trx
          .selectFrom('app.self_care_completions')
          .selectAll()
          .where('id', '=', command.completionId)
          .where('item_id', '=', itemRow.id)
          .where('user_id', '=', command.context.actorUserId)
          .forUpdate()
          .executeTakeFirst()

        if (!current) {
          return null
        }

        assertSelfCareVersion(
          'completion',
          current.id,
          command.expectedVersion,
          Number(current.version),
        )

        const merged = {
          measurementValue:
            command.input.measurementValue === undefined
              ? current.measurement_value === null
                ? null
                : Number(current.measurement_value)
              : command.input.measurementValue,
          moodAfter:
            command.input.moodAfter === undefined
              ? current.mood_after
              : command.input.moodAfter,
          energyAfter:
            command.input.energyAfter === undefined
              ? current.energy_after
              : command.input.energyAfter,
        }

        if (
          itemRow.type === 'measurement' &&
          merged.measurementValue === null
        ) {
          throw new HttpError(
            400,
            'self_care_measurement_value_required',
            'Measurement value is required.',
          )
        }

        if (itemRow.type === 'exercise' && merged.measurementValue === null) {
          throw new HttpError(
            400,
            'self_care_exercise_value_required',
            'Exercise value is required.',
          )
        }

        if (
          itemRow.type === 'mood_check' &&
          merged.moodAfter === null &&
          merged.energyAfter === null
        ) {
          throw new HttpError(
            400,
            'self_care_state_value_required',
            'Mood or energy value is required.',
          )
        }

        return trx
          .updateTable('app.self_care_completions')
          .set({
            ...(command.input.alternativeTitle !== undefined
              ? { alternative_title: command.input.alternativeTitle }
              : {}),
            ...(command.input.completedVariant !== undefined
              ? { completed_variant: command.input.completedVariant }
              : {}),
            ...(command.input.currency !== undefined
              ? { currency: command.input.currency }
              : {}),
            ...(command.input.durationMinutes !== undefined
              ? { duration_minutes: command.input.durationMinutes }
              : {}),
            ...(command.input.energyAfter !== undefined
              ? { energy_after: command.input.energyAfter }
              : {}),
            ...(command.input.energyBefore !== undefined
              ? { energy_before: command.input.energyBefore }
              : {}),
            ...(command.input.exerciseSets !== undefined
              ? { exercise_sets: JSON.stringify(command.input.exerciseSets) }
              : {}),
            ...(command.input.measurementUnit !== undefined
              ? { measurement_unit: command.input.measurementUnit }
              : {}),
            ...(command.input.measurementValue !== undefined
              ? { measurement_value: command.input.measurementValue }
              : {}),
            ...(command.input.moodAfter !== undefined
              ? { mood_after: command.input.moodAfter }
              : {}),
            ...(command.input.moodBefore !== undefined
              ? { mood_before: command.input.moodBefore }
              : {}),
            ...(command.input.note !== undefined
              ? { note: command.input.note }
              : {}),
            ...(command.input.price !== undefined
              ? { price: command.input.price }
              : {}),
          })
          .where('id', '=', command.completionId)
          .where('user_id', '=', command.context.actorUserId)
          .$if(command.expectedVersion !== undefined, (query) =>
            query.where('version', '=', command.expectedVersion!),
          )
          .returningAll()
          .executeTakeFirst()
      },
      command.context.actorUserId,
    )

    if (!row) {
      throw new HttpError(
        404,
        'self_care_completion_not_found',
        'Self-care completion not found.',
      )
    }

    return mapCompletionRow(row)
  }

  skipOccurrence(command: SkipSelfCareOccurrenceCommand) {
    return this.recordOccurrenceStatus(command, 'skipped', command.input.reason)
  }

  moveOccurrence(command: MoveSelfCareOccurrenceCommand) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const { occurrenceRow } =
          await this.loadOccurrenceWithActiveItemRowsForUpdate(
            trx,
            command.context,
            command.occurrenceId,
            command.expectedItemId,
          )
        const occurrence = mapOccurrenceRow(occurrenceRow)
        assertSelfCareVersion(
          'occurrence',
          occurrence.id,
          command.expectedVersion,
          occurrence.version,
        )
        assertSelfCareOccurrenceOpen(occurrence)
        const completion = createCompletionRecord(
          {
            alternativeTitle: null,
            completedVariant: null,
            currency: null,
            durationMinutes: null,
            energyAfter: null,
            energyBefore: null,
            exerciseSets: [],
            measurementUnit: null,
            measurementValue: null,
            moodAfter: null,
            moodBefore: null,
            note: command.input.note,
            price: null,
            status: 'moved',
            ...(command.actedAt ? { completedAt: command.actedAt } : {}),
          },
          {
            completionId: command.completionId,
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
        const item = mapItemRow(
          await this.loadActiveItemRow(trx, command.context, command.itemId),
        )
        assertSelfCareVersion(
          'item',
          item.id,
          command.expectedVersion,
          item.version,
        )
        const ruleRow = await trx
          .selectFrom('app.self_care_schedule_rules')
          .selectAll()
          .where('item_id', '=', item.id)
          .executeTakeFirst()
        const scheduleRule = ruleRow ? mapRuleRow(ruleRow) : null
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
        const reminderTimeZone = resolveSelfCareReminderTimeZone(
          command.input.timezone ?? scheduleRule?.timezone ?? null,
          command.context.clientTimeZone,
        )
        const reminderOffsetsMinutes = command.input.reminderOffsetsMinutes
        const dueAt = await this.buildSelfCareDueAt(
          trx,
          command.input.scheduledFor,
          scheduledTime ?? scheduleRule?.preferredTime ?? null,
          reminderTimeZone,
        )

        if (
          (command.existingOccurrenceId === undefined) !==
          (command.expectedOccurrenceVersion === undefined)
        ) {
          throw new HttpError(
            400,
            'self_care_schedule_update_invalid',
            'Existing occurrence id and version must be provided together.',
          )
        }

        if (
          command.existingOccurrenceId !== undefined &&
          command.expectedOccurrenceVersion !== undefined
        ) {
          const existingExactRow = await trx
            .selectFrom('app.self_care_occurrences')
            .selectAll()
            .where('id', '=', command.existingOccurrenceId)
            .where('item_id', '=', item.id)
            .where('user_id', '=', command.context.actorUserId)
            .forUpdate()
            .executeTakeFirst()

          if (!existingExactRow) {
            throw new HttpError(
              404,
              'self_care_occurrence_not_found',
              'Self-care occurrence not found.',
            )
          }

          const existing = mapOccurrenceRow(existingExactRow)
          assertSelfCareVersion(
            'occurrence',
            existing.id,
            command.expectedOccurrenceVersion,
            existing.version,
          )
          assertSelfCareOccurrenceOpen(existing)
          if (existing.scheduledFor !== command.input.scheduledFor) {
            throw new HttpError(
              409,
              'self_care_schedule_date_conflict',
              'An in-place schedule update must keep the existing date.',
              {
                actualScheduledFor: existing.scheduledFor,
                entityId: existing.id,
                entityType: 'occurrence',
                requestedScheduledFor: command.input.scheduledFor,
              },
            )
          }

          const updatedRow = await trx
            .updateTable('app.self_care_occurrences')
            .set({
              completed_at: null,
              due_at: dueAt,
              moved_to: null,
              reminder_offsets_minutes: reminderOffsetsMinutes,
              reminder_time_zone: reminderTimeZone,
              status: 'scheduled',
              updated_by: command.context.actorUserId,
            })
            .where('id', '=', existing.id)
            .where('item_id', '=', item.id)
            .where('user_id', '=', command.context.actorUserId)
            .where('version', '=', command.expectedOccurrenceVersion)
            .returningAll()
            .executeTakeFirst()

          if (!updatedRow) {
            assertSelfCareVersion(
              'occurrence',
              existing.id,
              command.expectedOccurrenceVersion,
              null,
            )
          }

          const occurrence = mapOccurrenceRow(updatedRow ?? existingExactRow)
          await this.upsertScheduledDetails(
            trx,
            item,
            occurrence,
            command.input,
          )
          return occurrence
        }

        if (existingRow) {
          const existing = mapOccurrenceRow(existingRow)
          if (command.strictInsert) {
            throw new HttpError(
              409,
              'self_care_schedule_slot_conflict',
              'A self-care occurrence already exists for this schedule slot.',
              {
                actualVersion: existing.version,
                entityId: existing.id,
                entityType: 'occurrence',
              },
            )
          }
          const occurrence = {
            ...existing,
            completedAt: null,
            dueAt,
            movedTo: null,
            reminderOffsetsMinutes,
            reminderTimeZone,
            scheduleRuleId: scheduleRule?.id ?? null,
            status: 'scheduled' as const,
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
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
          occurrenceId: command.occurrenceId,
          scheduledFor: command.input.scheduledFor,
          scheduleRule,
        })
        occurrence.reminderOffsetsMinutes = reminderOffsetsMinutes
        occurrence.reminderTimeZone = reminderTimeZone
        const inserted = await this.insertOccurrence(
          trx,
          occurrence,
          command.context.actorUserId,
        )

        if (inserted) {
          await this.upsertScheduledDetails(trx, item, inserted, command.input)
          return inserted
        }

        if (command.strictInsert) {
          throw new HttpError(
            409,
            'self_care_occurrence_id_conflict',
            'The self-care occurrence identifier or schedule slot is already in use.',
          )
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

        const mappedFallback = mapOccurrenceRow(fallback)
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
    return this.recordOccurrenceStatus(command, 'cancelled', '')
  }

  async getDailyState(context: SelfCareReadContext, date: string) {
    const actorUserId =
      context.actorUserId ??
      (await this.readModels.findUserIdForWorkspace(
        context.workspaceId,
        context.auth,
      ))

    if (!actorUserId) {
      return null
    }

    const row = await withOptionalRls(
      this.db,
      context.auth,
      (executor) =>
        executor
          .selectFrom('app.self_care_daily_states')
          .selectAll()
          .where('user_id', '=', actorUserId)
          .where('date', '=', date)
          .executeTakeFirst(),
      actorUserId,
    )

    return row ? mapDailyStateRow(row) : null
  }

  async upsertDailyState(command: UpsertSelfCareDailyStateCommand) {
    const record = createDailyStateRecord(command.date, command.input, {
      userId: command.context.actorUserId,
    })
    const row = await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const values = {
          date: record.date,
          energy: record.energy,
          id: record.id,
          mood: record.mood,
          note: record.note,
          pain: record.pain,
          sleep_quality: record.sleepQuality,
          stress: record.stress,
          user_id: record.userId,
        }
        const updates = {
          energy: record.energy,
          mood: record.mood,
          note: record.note,
          pain: record.pain,
          sleep_quality: record.sleepQuality,
          stress: record.stress,
        }

        if (command.expectedVersion !== undefined) {
          await sql`
            select pg_advisory_xact_lock(
              hashtextextended(
                ${`${command.context.actorUserId}:${command.date}`},
                8_062_028
              )
            )
          `.execute(trx)
          const current = await trx
            .selectFrom('app.self_care_daily_states')
            .select(['id', 'version'])
            .where('user_id', '=', command.context.actorUserId)
            .where('date', '=', command.date)
            .forUpdate()
            .executeTakeFirst()
          assertSelfCareVersion(
            'daily_state',
            current?.id ?? `${command.context.actorUserId}:${command.date}`,
            command.expectedVersion,
            current ? Number(current.version) : null,
          )

          if (current) {
            return trx
              .updateTable('app.self_care_daily_states')
              .set(updates)
              .where('id', '=', current.id)
              .where('version', '=', current.version)
              .returningAll()
              .executeTakeFirstOrThrow()
          }

          return trx
            .insertInto('app.self_care_daily_states')
            .values(values)
            .returningAll()
            .executeTakeFirstOrThrow()
        }

        return trx
          .insertInto('app.self_care_daily_states')
          .values(values)
          .onConflict((conflict) =>
            conflict.columns(['user_id', 'date']).doUpdateSet(updates),
          )
          .returningAll()
          .executeTakeFirstOrThrow()
      },
      command.context.actorUserId,
    )
    return mapDailyStateRow(row)
  }

  async getSettings(context: SelfCareReadContext) {
    return this.readModels.loadSettingsState(context)
  }

  async updateSettings(command: UpdateSelfCareSettingsCommand) {
    await this.upsertSettings(
      command.context,
      command.input,
      {},
      command.expectedVersion,
    )
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
      (await this.readModels.findUserIdForWorkspace(
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
      drafts: rows.map((row) => toPublicRitualStepDraft(mapStepDraftRow(row))),
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
        await sql`
          select pg_advisory_xact_lock(
            hashtextextended(
              ${[
                command.context.workspaceId,
                command.context.actorUserId,
                command.input.date,
                itemRow.id,
                command.input.occurrenceId ?? '',
              ].join(':')},
              8_062_027
            )
          )
        `.execute(trx)
        const current = await trx
          .selectFrom('app.self_care_ritual_step_drafts')
          .select(['id', 'version'])
          .where('workspace_id', '=', command.context.workspaceId)
          .where('user_id', '=', command.context.actorUserId)
          .where('date', '=', command.input.date)
          .where('item_id', '=', itemRow.id)
          .$if(command.input.occurrenceId !== null, (query) =>
            query.where('occurrence_id', '=', command.input.occurrenceId!),
          )
          .$if(command.input.occurrenceId === null, (query) =>
            query.where('occurrence_id', 'is', null),
          )
          .forUpdate()
          .executeTakeFirst()

        assertSelfCareVersion(
          'ritual_step_draft',
          current?.id ?? `${itemRow.id}:${command.input.date}`,
          command.expectedVersion,
          current ? Number(current.version) : null,
        )

        if (current) {
          await trx
            .updateTable('app.self_care_ritual_step_drafts')
            .set({ step_ids: [...new Set(command.input.stepIds)] })
            .where('id', '=', current.id)
            .where('version', '=', current.version)
            .execute()
        } else {
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
        }
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
    await this.generateReadOccurrences(context, from, to)
    return buildHistoryResponse({
      from,
      state: await this.readModels.loadHistoryReadModel(context, from, to),
      to,
    })
  }

  async getAnalytics(context: SelfCareReadContext, from: string, to: string) {
    await this.generateReadOccurrences(context, from, to)
    return buildAnalyticsResponse({
      from,
      state: await this.readModels.loadAnalyticsReadModel(context, from, to),
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
    const templates = rows.map((row) => mapTemplateRow(row))
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
    const input = buildItemInputFromTemplate(
      template,
      command.input.overrides,
      {
        plannerTimeZone: command.context.clientTimeZone,
      },
    )
    const records = createSelfCareRecords(
      input.scheduleRule &&
        !input.scheduleRule.timezone &&
        command.context.clientTimeZone
        ? {
            ...input,
            scheduleRule: {
              ...input.scheduleRule,
              timezone: command.context.clientTimeZone,
            },
          }
        : input,
      {
        actorUserId: command.context.actorUserId,
        clientTimeZone: command.context.clientTimeZone,
        createdFromTemplateId: template.id,
        workspaceId: command.context.workspaceId,
      },
    )
    try {
      await withWriteTransaction(
        this.db,
        command.context.auth,
        (trx) =>
          this.insertCreatedRecords(trx, records, command.context.actorUserId),
        command.context.actorUserId,
      )
    } catch (error) {
      if (getDatabaseErrorCode(error) === '23505') {
        throw new HttpError(
          409,
          'self_care_item_id_conflict',
          'The self-care item identifier is already in use.',
        )
      }

      throw error
    }
    return records.item
  }

  private async setArchiveState(
    context: ArchiveSelfCareItemCommand['context'],
    itemId: string,
    isArchived: boolean,
    expectedVersion?: number,
  ) {
    const row = await withWriteTransaction(
      this.db,
      context.auth,
      async (trx) => {
        let updateQuery = trx
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

        if (expectedVersion !== undefined) {
          updateQuery = updateQuery.where('version', '=', expectedVersion)
        }

        const updated = await updateQuery.returningAll().executeTakeFirst()

        if (!updated && expectedVersion !== undefined) {
          const current = await trx
            .selectFrom('app.self_care_items')
            .select(['id', 'version'])
            .where('id', '=', itemId)
            .where('workspace_id', '=', context.workspaceId)
            .where('user_id', '=', context.actorUserId)
            .where('deleted_at', 'is', null)
            .executeTakeFirst()

          if (current) {
            assertSelfCareVersion(
              'item',
              current.id,
              expectedVersion,
              Number(current.version),
            )
          }
        }

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
    return mapItemRow(row)
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
    command: SkipSelfCareOccurrenceCommand | CancelSelfCareOccurrenceCommand,
    status: 'cancelled' | 'skipped',
    note: string,
  ) {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const { occurrenceRow } =
          await this.loadOccurrenceWithActiveItemRowsForUpdate(
            trx,
            command.context,
            command.occurrenceId,
          )
        const occurrence = mapOccurrenceRow(occurrenceRow)
        assertSelfCareVersion(
          'occurrence',
          occurrence.id,
          command.expectedVersion,
          occurrence.version,
        )
        assertSelfCareOccurrenceOpen(occurrence)
        const completion = createCompletionRecord(
          {
            alternativeTitle: null,
            completedVariant: null,
            currency: null,
            durationMinutes: null,
            energyAfter: null,
            energyBefore: null,
            exerciseSets: [],
            measurementUnit: null,
            measurementValue: null,
            moodAfter: null,
            moodBefore: null,
            note,
            price: null,
            status,
            ...(command.actedAt ? { completedAt: command.actedAt } : {}),
          },
          {
            completionId: command.completionId,
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
        const next = updateOccurrenceStatus(occurrence, status)
        await this.updateOccurrence(trx, next, command.context.actorUserId)
        return next
      },
      command.context.actorUserId,
    )
  }

  private async generateReadOccurrences(
    context: SelfCareReadContext,
    from: string,
    to: string,
  ) {
    const actorUserId =
      context.actorUserId ??
      (await this.readModels.findUserIdForWorkspace(
        context.workspaceId,
        context.auth,
      ))

    if (!actorUserId) {
      return
    }

    const resolvedContext: SelfCareWriteContext = { ...context, actorUserId }

    await this.readGenerationCoordinator.schedule(
      createSelfCareReadGenerationKey({
        actorUserId,
        clientTimeZone: context.clientTimeZone,
        workspaceId: context.workspaceId,
      }),
      resolvedContext,
      from,
      to,
      async (generationContext, generationFrom, generationTo) => {
        await this.generateOccurrences({
          context: generationContext,
          from: generationFrom,
          to: generationTo,
        })
      },
    )
  }

  private async loadProgressCompletionForDate(
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

  private async buildSelfCareDueAt(
    executor: DatabaseExecutor,
    dateKey: string,
    preferredTime: string | null,
    timeZone: string | null,
  ): Promise<string | null> {
    if (!preferredTime) {
      return null
    }

    const result = await sql<{ due_at: unknown }>`
      select make_timestamptz(
        extract(year from cast(${dateKey} as date))::int,
        extract(month from cast(${dateKey} as date))::int,
        extract(day from cast(${dateKey} as date))::int,
        extract(hour from cast(${preferredTime} as time))::int,
        extract(minute from cast(${preferredTime} as time))::int,
        0,
        ${resolveSelfCareReminderTimeZone(timeZone)}
      ) as due_at
    `.execute(executor)

    const row = result.rows[0]
    return row ? serializeTimestamp(row.due_at) : null
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
    if (records.exerciseDetails)
      await this.insertExerciseDetails(executor, records.exerciseDetails)
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

  private insertExerciseDetails(
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

  private insertCourseDetails(
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

  private async insertOccurrences(
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

  private async insertCompletion(
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

  private async updateOpenExerciseProgressCompletion(
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
        reminder_offsets_minutes: occurrence.reminderOffsetsMinutes,
        reminder_time_zone: occurrence.reminderTimeZone,
        status: occurrence.status,
        updated_by: actorUserId,
      })
      .where('id', '=', occurrence.id)
      .execute()
  }

  private async incrementCourse(
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

  private async deactivateFlexibleGoalIfCompleted(
    executor: DatabaseExecutor,
    input: {
      actorUserId: string
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

  private async upsertSettings(
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

  private async loadOccurrenceRow(
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

  private async loadOccurrenceWithActiveItemRowsForUpdate(
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

  private async loadActiveItemRow(
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

  private async loadOwnedItemRowForUpdate(
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
}

function resolveSelfCareReminderTimeZone(
  explicitTimeZone: string | null | undefined,
  fallbackTimeZone?: string | null,
): string {
  const timeZone = explicitTimeZone?.trim() || fallbackTimeZone?.trim() || 'UTC'

  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date())
    return timeZone
  } catch {
    return 'UTC'
  }
}

function assertSelfCareVersion(
  entityType: string,
  entityId: string,
  expectedVersion: number | null | undefined,
  actualVersion: number | null,
): void {
  if (expectedVersion === undefined || expectedVersion === actualVersion) {
    return
  }

  throw new HttpError(
    409,
    'self_care_version_conflict',
    'Self-care data was changed on the server.',
    { actualVersion, entityId, entityType, expectedVersion },
  )
}

function assertSelfCareOccurrenceOpen(occurrence: SelfCareOccurrence): void {
  if (occurrence.status === 'scheduled' || occurrence.status === 'missed') {
    return
  }

  throw new HttpError(
    409,
    'self_care_occurrence_closed',
    'The self-care occurrence was already completed or changed.',
    {
      actualVersion: occurrence.version,
      entityId: occurrence.id,
      entityType: 'occurrence',
    },
  )
}

function assertRitualCompletionSteps(
  itemId: string,
  availableSteps: readonly Pick<SelfCareRitualStep, 'id'>[],
  submittedSteps: readonly { stepId: string }[],
): void {
  const availableStepIds = new Set(availableSteps.map((step) => step.id))
  const submittedStepIds = submittedSteps.map((step) => step.stepId)

  if (new Set(submittedStepIds).size !== submittedStepIds.length) {
    throw new HttpError(
      400,
      'self_care_ritual_completion_invalid_step',
      'Self-care ritual completion contains a duplicate step.',
    )
  }

  if (submittedStepIds.every((stepId) => availableStepIds.has(stepId))) {
    return
  }

  throw new HttpError(
    409,
    'self_care_ritual_step_conflict',
    'Self-care ritual steps changed before this completion was saved.',
    { entityId: itemId, entityType: 'item' },
  )
}
