import { type Kysely } from 'kysely'

import {
  type DatabaseExecutor,
  withOptionalRls,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type { SelfCareReadContext } from './self-care.model.js'
import {
  mapAlternativeRow,
  mapAppointmentRow,
  mapCompletionRow,
  mapCourseRow,
  mapDailyStateRow,
  mapExerciseRow,
  mapItemRow,
  mapMeasurementRow,
  mapMedicalRow,
  mapMinimumRow,
  mapOccurrenceRow,
  mapProcedureRow,
  mapRuleRow,
  mapSettingsRow,
  mapStepCompletionRow,
  mapStepRow,
  selectChildren,
  selectCompletions,
  selectDailyStates,
  selectOccurrences,
  selectStepCompletions,
  type SelfCareDateRange,
} from './self-care.repository.postgres.helpers.js'
import {
  addDays,
  createDefaultMinimumItems,
  createDefaultSelfCareSettings,
  type SelfCareAnalyticsReadModel,
  type SelfCareDashboardReadModel,
  type SelfCareHistoryReadModel,
  type SelfCareListReadModel,
  type SelfCareOccurrenceGenerationReadModel,
  type SelfCareOccurrencesReadModel,
  type SelfCarePlanReadModel,
} from './self-care.shared.js'

const EMPTY_SELF_CARE_USER_ID = '00000000-0000-0000-0000-000000000000'

export class PostgresSelfCareReadModelLoader {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findUserIdForWorkspace(
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

  async loadSettingsState(context: SelfCareReadContext) {
    const actorUserId =
      context.actorUserId ??
      (await this.findUserIdForWorkspace(context.workspaceId, context.auth))
    const userId = actorUserId ?? EMPTY_SELF_CARE_USER_ID

    if (!actorUserId) {
      return {
        minimumItems: createDefaultMinimumItems(userId),
        settings: createDefaultSelfCareSettings({ userId }),
      }
    }

    const [settingsRows, minimumRows] = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) =>
        [
          await executor
            .selectFrom('app.self_care_settings')
            .selectAll()
            .where('user_id', '=', actorUserId)
            .execute(),
          await executor
            .selectFrom('app.self_care_minimum_items')
            .selectAll()
            .where('user_id', '=', actorUserId)
            .execute(),
        ] as const,
      actorUserId,
    )

    return {
      minimumItems:
        minimumRows.length > 0
          ? minimumRows.map((row) => mapMinimumRow(row))
          : createDefaultMinimumItems(userId),
      settings: settingsRows[0]
        ? mapSettingsRow(settingsRows[0])
        : createDefaultSelfCareSettings({ userId }),
    }
  }

  async loadListItemsReadModel(
    context: SelfCareReadContext,
  ): Promise<SelfCareListReadModel> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const root = await this.selectReadModelRootRows(executor, context)
        const [
          alternativeRows,
          ruleRows,
          stepRows,
          procedureRows,
          appointmentRows,
          medicalRows,
          measurementRows,
          exerciseRows,
          courseRows,
        ] = await Promise.all([
          selectChildren(
            executor,
            'app.self_care_item_alternatives',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_schedule_rules',
            root.itemIds,
          ),
          selectChildren(executor, 'app.self_care_ritual_steps', root.itemIds),
          selectChildren(
            executor,
            'app.self_care_procedure_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_appointment_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_medical_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_measurement_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_exercise_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_course_details',
            root.itemIds,
          ),
        ])

        return {
          ...root,
          alternativeRows,
          appointmentRows,
          courseRows,
          exerciseRows,
          measurementRows,
          medicalRows,
          procedureRows,
          ruleRows,
          stepRows,
        }
      },
      context.actorUserId,
    )

    return {
      alternatives: rows.alternativeRows.map((row) => mapAlternativeRow(row)),
      appointmentDetails: rows.appointmentRows.map((row) =>
        mapAppointmentRow(row),
      ),
      courseDetails: rows.courseRows.map((row) => mapCourseRow(row)),
      exerciseDetails: rows.exerciseRows.map((row) => mapExerciseRow(row)),
      items: rows.itemRows.map((row) => mapItemRow(row)),
      medicalDetails: rows.medicalRows.map((row) => mapMedicalRow(row)),
      measurementDetails: rows.measurementRows.map((row) =>
        mapMeasurementRow(row),
      ),
      procedureDetails: rows.procedureRows.map((row) => mapProcedureRow(row)),
      scheduleRules: rows.ruleRows.map((row) => mapRuleRow(row)),
      steps: rows.stepRows.map((row) => mapStepRow(row)),
    }
  }

  async loadOccurrenceGenerationReadModel(
    context: SelfCareReadContext,
    occurrenceRange: SelfCareDateRange,
  ): Promise<SelfCareOccurrenceGenerationReadModel> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const root = await this.selectReadModelRootRows(executor, context)
        const [ruleRows, occurrenceRows, completionRows, courseRows] =
          await Promise.all([
            selectChildren(
              executor,
              'app.self_care_schedule_rules',
              root.itemIds,
            ),
            selectOccurrences(executor, {
              actorUserId: context.actorUserId ?? null,
              itemIds: root.itemIds,
              occurrenceRange,
            }),
            selectCompletions(executor, {
              actorUserId: context.actorUserId ?? null,
              itemIds: root.itemIds,
            }),
            selectChildren(
              executor,
              'app.self_care_course_details',
              root.itemIds,
            ),
          ])

        return { ...root, completionRows, courseRows, occurrenceRows, ruleRows }
      },
      context.actorUserId,
    )

    return {
      completions: rows.completionRows.map((row) => mapCompletionRow(row)),
      courseDetails: rows.courseRows.map((row) => mapCourseRow(row)),
      items: rows.itemRows.map((row) => mapItemRow(row)),
      occurrences: rows.occurrenceRows.map((row) => mapOccurrenceRow(row)),
      scheduleRules: rows.ruleRows.map((row) => mapRuleRow(row)),
    }
  }

  async loadDashboardReadModel(
    context: SelfCareReadContext,
    date: string,
  ): Promise<SelfCareDashboardReadModel> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const root = await this.selectReadModelRootRows(executor, context)
        const [
          ruleRows,
          occurrenceRows,
          completionRows,
          stepRows,
          procedureRows,
          appointmentRows,
          measurementRows,
          exerciseRows,
          courseRows,
          dailyStateRows,
          settingsRows,
          minimumRows,
        ] = await Promise.all([
          selectChildren(
            executor,
            'app.self_care_schedule_rules',
            root.itemIds,
          ),
          selectOccurrences(executor, {
            actorUserId: context.actorUserId ?? null,
            itemIds: root.itemIds,
            occurrenceRange: { from: date, to: addDays(date, 45) },
            scheduledOccurrencesBefore: date,
          }),
          selectCompletions(executor, {
            actorUserId: context.actorUserId ?? null,
            itemIds: root.itemIds,
          }),
          selectChildren(executor, 'app.self_care_ritual_steps', root.itemIds),
          selectChildren(
            executor,
            'app.self_care_procedure_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_appointment_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_measurement_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_exercise_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_course_details',
            root.itemIds,
          ),
          selectDailyStates(executor, {
            dailyStateRange: { from: date, to: date },
            userId: root.userId,
          }),
          executor
            .selectFrom('app.self_care_settings')
            .selectAll()
            .where('user_id', '=', root.userId)
            .execute(),
          executor
            .selectFrom('app.self_care_minimum_items')
            .selectAll()
            .where('user_id', '=', root.userId)
            .execute(),
        ])

        return {
          ...root,
          appointmentRows,
          completionRows,
          courseRows,
          dailyStateRows,
          exerciseRows,
          measurementRows,
          minimumRows,
          occurrenceRows,
          procedureRows,
          ruleRows,
          settingsRows,
          stepRows,
        }
      },
      context.actorUserId,
    )

    return {
      appointmentDetails: rows.appointmentRows.map((row) =>
        mapAppointmentRow(row),
      ),
      completions: rows.completionRows.map((row) => mapCompletionRow(row)),
      courseDetails: rows.courseRows.map((row) => mapCourseRow(row)),
      dailyStates: rows.dailyStateRows.map((row) => mapDailyStateRow(row)),
      exerciseDetails: rows.exerciseRows.map((row) => mapExerciseRow(row)),
      items: rows.itemRows.map((row) => mapItemRow(row)),
      measurementDetails: rows.measurementRows.map((row) =>
        mapMeasurementRow(row),
      ),
      minimumItems: rows.minimumRows.length
        ? rows.minimumRows.map((row) => mapMinimumRow(row))
        : createDefaultMinimumItems(rows.userId),
      occurrences: rows.occurrenceRows.map((row) => mapOccurrenceRow(row)),
      procedureDetails: rows.procedureRows.map((row) => mapProcedureRow(row)),
      scheduleRules: rows.ruleRows.map((row) => mapRuleRow(row)),
      settings: rows.settingsRows[0]
        ? mapSettingsRow(rows.settingsRows[0])
        : createDefaultSelfCareSettings({ userId: rows.userId }),
      steps: rows.stepRows.map((row) => mapStepRow(row)),
    }
  }

  async loadPlanReadModel(
    context: SelfCareReadContext,
    from: string,
    to: string,
  ): Promise<SelfCarePlanReadModel> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const root = await this.selectReadModelRootRows(executor, context)
        const [
          ruleRows,
          occurrenceRows,
          completionRows,
          stepRows,
          procedureRows,
          appointmentRows,
          measurementRows,
          exerciseRows,
          courseRows,
        ] = await Promise.all([
          selectChildren(
            executor,
            'app.self_care_schedule_rules',
            root.itemIds,
          ),
          selectOccurrences(executor, {
            actorUserId: context.actorUserId ?? null,
            itemIds: root.itemIds,
            occurrenceRange: { from, to },
          }),
          selectCompletions(executor, {
            actorUserId: context.actorUserId ?? null,
            itemIds: root.itemIds,
          }),
          selectChildren(executor, 'app.self_care_ritual_steps', root.itemIds),
          selectChildren(
            executor,
            'app.self_care_procedure_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_appointment_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_measurement_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_exercise_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_course_details',
            root.itemIds,
          ),
        ])

        return {
          ...root,
          appointmentRows,
          completionRows,
          courseRows,
          exerciseRows,
          measurementRows,
          occurrenceRows,
          procedureRows,
          ruleRows,
          stepRows,
        }
      },
      context.actorUserId,
    )

    return {
      appointmentDetails: rows.appointmentRows.map((row) =>
        mapAppointmentRow(row),
      ),
      completions: rows.completionRows.map((row) => mapCompletionRow(row)),
      courseDetails: rows.courseRows.map((row) => mapCourseRow(row)),
      exerciseDetails: rows.exerciseRows.map((row) => mapExerciseRow(row)),
      items: rows.itemRows.map((row) => mapItemRow(row)),
      measurementDetails: rows.measurementRows.map((row) =>
        mapMeasurementRow(row),
      ),
      occurrences: rows.occurrenceRows.map((row) => mapOccurrenceRow(row)),
      procedureDetails: rows.procedureRows.map((row) => mapProcedureRow(row)),
      scheduleRules: rows.ruleRows.map((row) => mapRuleRow(row)),
      steps: rows.stepRows.map((row) => mapStepRow(row)),
    }
  }

  async loadOccurrencesReadModel(
    context: SelfCareReadContext,
    from: string,
    to: string,
  ): Promise<SelfCareOccurrencesReadModel> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const root = await this.selectReadModelRootRows(executor, context)
        const occurrenceRows = await selectOccurrences(executor, {
          actorUserId: context.actorUserId ?? null,
          itemIds: root.itemIds,
          occurrenceRange: { from, to },
        })

        return { occurrenceRows }
      },
      context.actorUserId,
    )

    return {
      occurrences: rows.occurrenceRows.map((row) => mapOccurrenceRow(row)),
    }
  }

  async loadHistoryReadModel(
    context: SelfCareReadContext,
    from: string,
    to: string,
  ): Promise<SelfCareHistoryReadModel> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const root = await this.selectReadModelRootRows(executor, context)
        const [completionRows, procedureRows, appointmentRows] =
          await Promise.all([
            selectCompletions(executor, {
              actorUserId: context.actorUserId ?? null,
              completionRange: { from, to },
              itemIds: root.itemIds,
            }),
            selectChildren(
              executor,
              'app.self_care_procedure_details',
              root.itemIds,
            ),
            selectChildren(
              executor,
              'app.self_care_appointment_details',
              root.itemIds,
            ),
          ])
        const stepCompletionRows = await selectStepCompletions(
          executor,
          completionRows.map((row) => row.id),
        )

        return {
          ...root,
          appointmentRows,
          completionRows,
          procedureRows,
          stepCompletionRows,
        }
      },
      context.actorUserId,
    )

    return {
      appointmentDetails: rows.appointmentRows.map((row) =>
        mapAppointmentRow(row),
      ),
      completions: rows.completionRows.map((row) => mapCompletionRow(row)),
      items: rows.itemRows.map((row) => mapItemRow(row)),
      procedureDetails: rows.procedureRows.map((row) => mapProcedureRow(row)),
      stepCompletions: rows.stepCompletionRows.map((row) =>
        mapStepCompletionRow(row),
      ),
    }
  }

  async loadAnalyticsReadModel(
    context: SelfCareReadContext,
    from: string,
    to: string,
  ): Promise<SelfCareAnalyticsReadModel> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const root = await this.selectReadModelRootRows(executor, context)
        const [
          ruleRows,
          occurrenceRows,
          completionRows,
          stepRows,
          procedureRows,
          appointmentRows,
          measurementRows,
          exerciseRows,
          courseRows,
          dailyStateRows,
        ] = await Promise.all([
          selectChildren(
            executor,
            'app.self_care_schedule_rules',
            root.itemIds,
          ),
          selectOccurrences(executor, {
            actorUserId: context.actorUserId ?? null,
            itemIds: root.itemIds,
            occurrenceRange: { from, to: addDays(to, 45) },
          }),
          selectCompletions(executor, {
            actorUserId: context.actorUserId ?? null,
            completionRange: { from, to },
            itemIds: root.itemIds,
          }),
          selectChildren(executor, 'app.self_care_ritual_steps', root.itemIds),
          selectChildren(
            executor,
            'app.self_care_procedure_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_appointment_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_measurement_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_exercise_details',
            root.itemIds,
          ),
          selectChildren(
            executor,
            'app.self_care_course_details',
            root.itemIds,
          ),
          selectDailyStates(executor, {
            dailyStateRange: { from, to },
            userId: root.userId,
          }),
        ])

        return {
          ...root,
          appointmentRows,
          completionRows,
          courseRows,
          dailyStateRows,
          exerciseRows,
          measurementRows,
          occurrenceRows,
          procedureRows,
          ruleRows,
          stepRows,
        }
      },
      context.actorUserId,
    )

    return {
      appointmentDetails: rows.appointmentRows.map((row) =>
        mapAppointmentRow(row),
      ),
      completions: rows.completionRows.map((row) => mapCompletionRow(row)),
      courseDetails: rows.courseRows.map((row) => mapCourseRow(row)),
      dailyStates: rows.dailyStateRows.map((row) => mapDailyStateRow(row)),
      exerciseDetails: rows.exerciseRows.map((row) => mapExerciseRow(row)),
      items: rows.itemRows.map((row) => mapItemRow(row)),
      measurementDetails: rows.measurementRows.map((row) =>
        mapMeasurementRow(row),
      ),
      occurrences: rows.occurrenceRows.map((row) => mapOccurrenceRow(row)),
      procedureDetails: rows.procedureRows.map((row) => mapProcedureRow(row)),
      scheduleRules: rows.ruleRows.map((row) => mapRuleRow(row)),
      steps: rows.stepRows.map((row) => mapStepRow(row)),
    }
  }

  private async selectReadModelRootRows(
    executor: DatabaseExecutor,
    context: SelfCareReadContext,
  ) {
    const itemQuery = executor
      .selectFrom('app.self_care_items')
      .selectAll()
      .where('workspace_id', '=', context.workspaceId)
      .where('deleted_at', 'is', null)
    const itemRows = context.actorUserId
      ? await itemQuery.where('user_id', '=', context.actorUserId).execute()
      : await itemQuery.execute()

    return {
      itemIds: itemRows.map((item) => item.id),
      itemRows,
      userId:
        context.actorUserId ?? itemRows[0]?.user_id ?? EMPTY_SELF_CARE_USER_ID,
    }
  }
}
