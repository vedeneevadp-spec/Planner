import {
  getDateKeyInTimeZone,
  selfCareOfflineCommandResultSchema,
  updateSelfCarePausePeriods,
} from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import { getDatabaseErrorCode } from '../../infrastructure/db/errors.js'
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
  mapCompletionRow,
  mapCompletionStatusToOccurrenceStatus,
  mapDailyStateRow,
  mapItemRow,
  mapOccurrenceRow,
  mapRuleRow,
  mapStepDraftRow,
  mapStepRow,
  mapTemplateRow,
  toPublicRitualStepDraft,
} from './self-care.repository.postgres.helpers.js'
import { PostgresSelfCarePersistence } from './self-care.repository.postgres.persistence.js'
import { PostgresSelfCareReadModelLoader } from './self-care.repository.postgres.read-model.js'
import {
  withOptionalRls,
  withWriteTransaction,
} from './self-care.repository.postgres.transactions.js'
import { resolveSelfCareReminderTimeZone } from './self-care.repository.postgres.validation.js'
import {
  assertRitualCompletionSteps,
  assertSelfCareOccurrenceOpen,
  assertSelfCareVersion,
} from './self-care.repository.postgres.validation.js'
import {
  buildAnalyticsResponse,
  buildDashboardResponse,
  buildHistoryResponse,
  buildItemInputFromTemplate,
  buildPlanResponse,
  buildSelfCareDueAtInstant,
  buildSelfCareListResponse,
  buildSystemSelfCareTemplates,
  createAppointmentDetailsRecord,
  createCompletionRecord,
  createCourseDetailsRecord,
  createDailyStateRecord,
  createExerciseDetailsRecord,
  createMeasurementDetailsRecord,
  createMedicalDetailsRecord,
  createMinimumItemRecord,
  createOccurrenceRecord,
  createProcedureDetailsRecord,
  createRitualStepCompletions,
  createScheduleRuleRecord,
  createSelfCareRecords,
  generateSelfCareOccurrencesForRange,
  getSelfCareCompletionDateKey,
  inferRitualCompletionStatus,
  shouldDeduplicateSelfCareItemCompletion,
  updateOccurrenceStatus,
} from './self-care.shared.js'
import {
  createSelfCareReadGenerationKey,
  SelfCareReadGenerationCoordinator,
} from './self-care-read-generation-coordinator.js'

export class PostgresSelfCareRepository implements SelfCareRepository {
  private readonly persistence: PostgresSelfCarePersistence
  private readonly readModels: PostgresSelfCareReadModelLoader
  private readonly readGenerationCoordinator =
    new SelfCareReadGenerationCoordinator<SelfCareWriteContext>()

  constructor(private readonly db: Kysely<DatabaseSchema>) {
    this.persistence = new PostgresSelfCarePersistence(db)
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
          await this.persistence.insertCreatedRecords(
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
          const currentItem =
            command.input.isActive !== undefined
              ? mapItemRow(
                  await this.persistence.loadActiveItemRow(
                    trx,
                    command.context,
                    command.itemId,
                  ),
                )
              : null
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
                ? {
                    is_active: command.input.isActive,
                    pause_periods: JSON.stringify(
                      updateSelfCarePausePeriods(
                        currentItem!,
                        command.input.isActive,
                        getDateKeyInTimeZone(
                          command.actedAt ?? new Date(),
                          command.context.clientTimeZone ?? 'UTC',
                        ),
                      ),
                    ),
                  }
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
            await this.persistence.upsertScheduleRule(
              trx,
              createScheduleRuleRecord(
                command.itemId,
                command.input.scheduleRule,
              ),
              command.context.actorUserId,
            )
          }

          if (command.input.steps) {
            await this.persistence.replaceRitualSteps(
              trx,
              command.itemId,
              command.input.steps,
            )
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
            await this.persistence.insertProcedureDetails(
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
            await this.persistence.insertAppointmentDetails(
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
            await this.persistence.insertMedicalDetails(
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
            await this.persistence.insertMeasurementDetails(
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
            await this.persistence.insertExerciseDetails(
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
            await this.persistence.insertCourseDetails(
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
            await this.persistence.updateMigratedHabitState(
              trx,
              command.context,
              {
                habitId: updated.migrated_from_habit_id,
                isActive: updated.is_active && !updated.is_archived,
              },
            )
          }

          const item = mapItemRow(updated)
          if (
            command.input.scheduleRule ||
            command.input.courseDetails ||
            command.input.isActive !== undefined
          ) {
            await this.persistence.reconcileStoredSchedule(trx, command, item)
          }
          return item
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
          await this.persistence.updateMigratedHabitState(
            trx,
            command.context,
            {
              deletedAt,
              habitId: row.migrated_from_habit_id,
              isActive: false,
            },
          )
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
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        // Rule edits take the same item locks: a read must not insert a stale rule
        // snapshot after the future schedule has already been reconciled.
        await trx
          .selectFrom('app.self_care_items')
          .select('id')
          .where('workspace_id', '=', command.context.workspaceId)
          .where('user_id', '=', command.context.actorUserId)
          .where('deleted_at', 'is', null)
          .orderBy('id')
          .forUpdate()
          .execute()
        const state = await new PostgresSelfCareReadModelLoader(
          trx,
        ).loadOccurrenceGenerationReadModel(command.context, {
          from: command.from,
          to: command.to,
        })
        const generated: StoredSelfCareOccurrenceRecord[] = []

        for (const item of state.items) {
          const rule =
            state.scheduleRules.find(
              (candidate) => candidate.itemId === item.id,
            ) ?? null
          const course =
            state.courseDetails.find(
              (candidate) => candidate.itemId === item.id,
            ) ?? null
          generated.push(
            ...generateSelfCareOccurrencesForRange({
              plannerTimeZone: command.context.clientTimeZone,
              completions: state.completions,
              courseDetails: course,
              existingOccurrences: state.occurrences,
              from: command.from,
              item,
              scheduleRule: rule
                ? {
                    ...rule,
                    timezone: resolveSelfCareReminderTimeZone(
                      rule.timezone,
                      command.context.clientTimeZone,
                    ),
                  }
                : null,
              to: command.to,
            }),
          )
        }

        if (generated.length === 0) {
          return []
        }

        return this.persistence.insertOccurrences(
          trx,
          generated,
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
      plannerTimeZone: command.context.clientTimeZone,
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
      plannerTimeZone: command.context.clientTimeZone,
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
          await this.persistence.loadOccurrenceWithActiveItemRowsForUpdate(
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
          .where('deleted_at', 'is', null)
          .execute()
        const steps = stepRows.map((row) => mapStepRow(row))
        assertRitualCompletionSteps(item.id, steps, command.input.steps)
        const pendingStepCompletions = createRitualStepCompletions(
          'pending',
          command.input,
          steps,
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
            ? await this.persistence.updateOpenExerciseProgressCompletion(trx, {
                completion,
                date: completionDate,
                itemId: item.id,
                plannerTimeZone: command.context.clientTimeZone,
                userId: command.context.actorUserId,
              })
            : null
        const storedCompletion =
          exerciseProgressCompletion ??
          (await this.persistence.insertCompletion(
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
                step_title: step.stepTitle ?? null,
                step_order: step.stepOrder ?? null,
              })
              .execute()
          }
        }
        await this.persistence.updateOccurrence(
          trx,
          updateOccurrenceStatus(
            occurrence,
            mapCompletionStatusToOccurrenceStatus(status),
            { completedAt: storedCompletion.completedAt },
          ),
          command.context.actorUserId,
        )
        await this.persistence.deleteRitualStepDraftRow(trx, {
          date: completionDate,
          itemId: item.id,
          occurrenceId: occurrence.id,
          userId: command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        if (occurrence.scheduledFor !== completionDate) {
          await this.persistence.deleteRitualStepDraftRow(trx, {
            date: occurrence.scheduledFor,
            itemId: item.id,
            occurrenceId: occurrence.id,
            userId: command.context.actorUserId,
            workspaceId: command.context.workspaceId,
          })
        }
        await this.persistence.incrementCourse(trx, item.id, completionDate)
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
          await this.persistence.loadActiveItemRow(
            trx,
            command.context,
            command.itemId,
          ),
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
          .where('deleted_at', 'is', null)
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
          ? await this.persistence.loadProgressCompletionForDate(trx, {
              date: completionDate,
              itemId: item.id,
              plannerTimeZone: command.context.clientTimeZone,
              userId: command.context.actorUserId,
            })
          : null

        if (existingCompletion) {
          await this.persistence.deleteRitualStepDraftRow(trx, {
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
          steps,
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
            ? await this.persistence.updateOpenExerciseProgressCompletion(trx, {
                completion,
                date: completionDate,
                itemId: item.id,
                plannerTimeZone: command.context.clientTimeZone,
                userId: command.context.actorUserId,
              })
            : null
        const storedCompletion =
          exerciseProgressCompletion ??
          (await this.persistence.insertCompletion(
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
                step_title: step.stepTitle ?? null,
                step_order: step.stepOrder ?? null,
              })
              .execute()
          }
        }
        await this.persistence.deleteRitualStepDraftRow(trx, {
          date: completionDate,
          itemId: item.id,
          occurrenceId: null,
          userId: command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
        const deactivated =
          await this.persistence.deactivateFlexibleGoalIfCompleted(trx, {
            actorUserId: command.context.actorUserId,
            plannerTimeZone: command.context.clientTimeZone,
            completion: storedCompletion,
            item,
            scheduleRule,
          })
        await this.persistence.incrementCourse(trx, item.id, completionDate)
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

        const itemRow = await this.persistence.loadOwnedItemRowForUpdate(
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
          await this.persistence.loadOccurrenceWithActiveItemRowsForUpdate(
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
        await this.persistence.insertCompletion(
          trx,
          completion,
          command.context.actorUserId,
        )
        const next = updateOccurrenceStatus(occurrence, 'moved', {
          movedTo: command.input.newDate,
        })
        await this.persistence.updateOccurrence(
          trx,
          next,
          command.context.actorUserId,
        )
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
          await this.persistence.loadActiveItemRow(
            trx,
            command.context,
            command.itemId,
          ),
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
        const dueAt = buildSelfCareDueAtInstant(
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
              generated_at: null,
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
          await this.persistence.cancelPendingOccurrenceReminders(trx, [
            occurrence.id,
          ])
          await this.persistence.upsertScheduledDetails(
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
            generatedAt: null,
            dueAt,
            movedTo: null,
            reminderOffsetsMinutes,
            reminderTimeZone,
            scheduleRuleId: scheduleRule?.id ?? null,
            status: 'scheduled' as const,
            updatedAt: new Date().toISOString(),
            version: existing.version + 1,
          }
          await this.persistence.updateOccurrence(
            trx,
            occurrence,
            command.context.actorUserId,
          )

          await this.persistence.cancelPendingOccurrenceReminders(trx, [
            occurrence.id,
          ])

          await this.persistence.upsertScheduledDetails(
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
        occurrence.generatedAt = null
        occurrence.reminderOffsetsMinutes = reminderOffsetsMinutes
        occurrence.reminderTimeZone = reminderTimeZone
        const inserted = await this.persistence.insertOccurrence(
          trx,
          occurrence,
          command.context.actorUserId,
        )

        if (inserted) {
          await this.persistence.upsertScheduledDetails(
            trx,
            item,
            inserted,
            command.input,
          )
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
        await this.persistence.upsertScheduledDetails(
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
    await this.persistence.upsertSettings(
      command.context,
      command.input,
      {},
      command.expectedVersion,
    )
    return this.getSettings(command.context)
  }

  async enableGentleMode(command: ToggleSelfCareGentleModeCommand) {
    await this.persistence.upsertSettings(
      command.context,
      {},
      { gentleModeDate: command.date, gentleModeEnabledToday: true },
    )
    return this.getSettings(command.context)
  }

  async disableGentleMode(command: ToggleSelfCareGentleModeCommand) {
    await this.persistence.upsertSettings(
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
        await this.persistence.loadActiveItemRow(
          trx,
          command.context,
          command.itemId,
        )
        await this.persistence.replaceRitualSteps(
          trx,
          command.itemId,
          command.steps,
        )
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
        const itemRow = await this.persistence.loadActiveItemRow(
          trx,
          command.context,
          command.input.itemId,
        )

        if (command.input.occurrenceId) {
          const occurrenceRow = await this.persistence.loadOccurrenceRow(
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

        await this.persistence.assertRitualStepDraftSteps(trx, {
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
        await this.persistence.loadActiveItemRow(
          trx,
          command.context,
          command.itemId,
        )
        await this.persistence.deleteRitualStepDraftRow(trx, {
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
      plannerTimeZone: context.clientTimeZone,
      state: await this.readModels.loadHistoryReadModel(context, from, to),
      to,
    })
  }

  async getAnalytics(context: SelfCareReadContext, from: string, to: string) {
    await this.generateReadOccurrences(context, from, to)
    return buildAnalyticsResponse({
      from,
      plannerTimeZone: context.clientTimeZone,
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
          this.persistence.insertCreatedRecords(
            trx,
            records,
            command.context.actorUserId,
          ),
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
        const current = !isArchived
          ? mapItemRow(
              await this.persistence.loadOwnedItemRowForUpdate(
                trx,
                context,
                itemId,
              ),
            )
          : null
        let updateQuery = trx
          .updateTable('app.self_care_items')
          .set({
            is_active: isArchived ? false : true,
            is_archived: isArchived,
            ...(!isArchived
              ? {
                  pause_periods: JSON.stringify(
                    updateSelfCarePausePeriods(
                      current!,
                      true,
                      getDateKeyInTimeZone(
                        new Date(),
                        context.clientTimeZone ?? 'UTC',
                      ),
                    ),
                  ),
                }
              : {}),
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
          await this.persistence.updateMigratedHabitState(trx, context, {
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
          await this.persistence.loadOccurrenceWithActiveItemRowsForUpdate(
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
        await this.persistence.insertCompletion(
          trx,
          completion,
          command.context.actorUserId,
        )
        const next = updateOccurrenceStatus(occurrence, status)
        await this.persistence.updateOccurrence(
          trx,
          next,
          command.context.actorUserId,
        )
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
}
