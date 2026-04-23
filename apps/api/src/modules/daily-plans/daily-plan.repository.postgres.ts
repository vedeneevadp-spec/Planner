import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type {
  DatabaseSchema,
  JsonObject,
} from '../../infrastructure/db/schema.js'
import type {
  AutoBuildDailyPlanCommand,
  DailyPlanUnloadResult,
  GetDailyPlanCommand,
  StoredDailyPlanRecord,
  UnloadDailyPlanCommand,
  UpsertDailyPlanCommand,
} from './daily-plan.model.js'
import type { DailyPlanRepository } from './daily-plan.repository.js'
import {
  calculateOverloadScore,
  createVirtualDailyPlan,
  DAILY_FOCUS_LIMITS,
  DEFAULT_TASK_RESOURCE,
  isRoutineTitle,
} from './daily-plan.shared.js'

type DailyPlanRow = Selectable<DatabaseSchema['app.daily_plans']>
type TaskRow = Pick<
  Selectable<DatabaseSchema['app.tasks']>,
  | 'created_at'
  | 'due_on'
  | 'id'
  | 'metadata'
  | 'planned_on'
  | 'resource'
  | 'status'
  | 'title'
>

export class PostgresDailyPlanRepository implements DailyPlanRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async getByDate(command: GetDailyPlanCommand): Promise<StoredDailyPlanRecord> {
    if (!command.context.actorUserId) {
      return createVirtualDailyPlan({
        date: command.date,
        userId: '',
        workspaceId: command.context.workspaceId,
      })
    }

    const row = await withOptionalRls(
      this.db,
      command.context.auth,
      (executor) =>
        this.loadPlanRow(
          executor,
          command.context.workspaceId,
          command.context.actorUserId!,
          command.date,
        ),
      command.context.actorUserId,
    )

    return row
      ? this.mapPlanRecord(row)
      : createVirtualDailyPlan({
          date: command.date,
          userId: command.context.actorUserId,
          workspaceId: command.context.workspaceId,
        })
  }

  async upsert(command: UpsertDailyPlanCommand): Promise<StoredDailyPlanRecord> {
    const overloadScore = await this.calculatePlanOverloadScore(
      command.context.workspaceId,
      [
        ...command.input.focusTaskIds,
        ...command.input.supportTaskIds,
        ...command.input.routineTaskIds,
      ],
      command.input.energyMode,
      command.context.auth,
      command.context.actorUserId,
    )

    const row = await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const id = generateUuidV7()
        const inserted = await trx
          .insertInto('app.daily_plans')
          .values({
            created_by: command.context.actorUserId,
            date: command.date,
            deleted_at: null,
            energy_mode: command.input.energyMode,
            focus_task_ids: command.input.focusTaskIds,
            id,
            overload_score: overloadScore,
            routine_task_ids: command.input.routineTaskIds,
            support_task_ids: command.input.supportTaskIds,
            updated_by: command.context.actorUserId,
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) =>
            conflict
              .columns(['workspace_id', 'user_id', 'date'])
              .doUpdateSet({
                deleted_at: null,
                energy_mode: command.input.energyMode,
                focus_task_ids: command.input.focusTaskIds,
                overload_score: overloadScore,
                routine_task_ids: command.input.routineTaskIds,
                support_task_ids: command.input.supportTaskIds,
                updated_by: command.context.actorUserId,
              }),
          )
          .returningAll()
          .executeTakeFirstOrThrow()

        return inserted
      },
      command.context.actorUserId,
    )

    return this.mapPlanRecord(row)
  }

  async autoBuild(
    command: AutoBuildDailyPlanCommand,
  ): Promise<StoredDailyPlanRecord> {
    const tasks = await withOptionalRls(
      this.db,
      command.context.auth,
      (executor) =>
        executor
          .selectFrom('app.tasks')
          .select([
            'created_at',
            'due_on',
            'id',
            'metadata',
            'planned_on',
            'resource',
            'status',
            'title',
          ])
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .where('status', '=', 'todo')
          .orderBy('due_on', 'asc')
          .orderBy('planned_on', 'asc')
          .orderBy('created_at', 'asc')
          .execute(),
      command.context.actorUserId,
    )
    const mode = command.input.energyMode
    const focusLimit = DAILY_FOCUS_LIMITS[mode]
    const focusTaskIds: string[] = []
    const supportTaskIds: string[] = []
    const routineTaskIds: string[] = []

    for (const task of sortAutoBuildTasks(tasks)) {
      const plannedDate = serializeNullableDate(task.planned_on)
      const dueDate = serializeNullableDate(task.due_on)
      const isCandidate =
        plannedDate === command.input.date ||
        dueDate === command.input.date ||
        plannedDate === null

      if (!isCandidate) {
        continue
      }

      if (isRoutineTitle(task.title)) {
        routineTaskIds.push(task.id)
        continue
      }

      if (isImportantTask(task) && focusTaskIds.length < focusLimit) {
        focusTaskIds.push(task.id)
        continue
      }

      supportTaskIds.push(task.id)
    }

    return this.upsert({
      context: command.context,
      date: command.input.date,
      input: {
        energyMode: mode,
        focusTaskIds,
        routineTaskIds,
        supportTaskIds: supportTaskIds.slice(0, 8),
      },
    })
  }

  async unload(command: UnloadDailyPlanCommand): Promise<DailyPlanUnloadResult> {
    const plan = await this.getByDate({
      context: command.context,
      date: command.date,
    })
    const taskIds = [
      ...plan.focusTaskIds,
      ...plan.supportTaskIds,
      ...plan.routineTaskIds,
    ]

    if (taskIds.length === 0) {
      return { suggestions: [] }
    }

    const tasks = await withOptionalRls(
      this.db,
      command.context.auth,
      (executor) =>
        executor
          .selectFrom('app.tasks')
          .select(['id', 'metadata', 'resource', 'title'])
          .where('workspace_id', '=', command.context.workspaceId)
          .where('id', 'in', taskIds)
          .where('deleted_at', 'is', null)
          .execute(),
      command.context.actorUserId,
    )

    return {
      suggestions: tasks
        .filter((task) => !isImportantTask(task))
        .sort((left, right) =>
          (right.resource ?? DEFAULT_TASK_RESOURCE) -
          (left.resource ?? DEFAULT_TASK_RESOURCE),
        )
        .slice(0, 3)
        .map((task) => ({
          action: 'move_tomorrow',
          resource: task.resource ?? DEFAULT_TASK_RESOURCE,
          taskId: task.id,
          title: task.title,
        })),
    }
  }

  private loadPlanRow(
    executor: DatabaseExecutor,
    workspaceId: string,
    userId: string,
    date: string,
  ): Promise<DailyPlanRow | undefined> {
    return executor
      .selectFrom('app.daily_plans')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('user_id', '=', userId)
      .where('date', '=', date)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }

  private async calculatePlanOverloadScore(
    workspaceId: string,
    taskIds: string[],
    energyMode: StoredDailyPlanRecord['energyMode'],
    authContext: UpsertDailyPlanCommand['context']['auth'],
    actorUserId: string,
  ): Promise<number> {
    const uniqueTaskIds = [...new Set(taskIds)]

    if (uniqueTaskIds.length === 0) {
      return 0
    }

    const rows = await withOptionalRls(
      this.db,
      authContext,
      (executor) =>
        executor
          .selectFrom('app.tasks')
          .select(['id', 'resource'])
          .where('workspace_id', '=', workspaceId)
          .where('id', 'in', uniqueTaskIds)
          .where('deleted_at', 'is', null)
          .execute(),
      actorUserId,
    )
    const totalResource = rows.reduce(
      (sum, row) => sum + (row.resource ?? DEFAULT_TASK_RESOURCE),
      0,
    )

    return calculateOverloadScore(totalResource, energyMode)
  }

  private mapPlanRecord(row: DailyPlanRow): StoredDailyPlanRecord {
    return {
      createdAt: serializeTimestamp(row.created_at),
      date: serializeDate(row.date),
      deletedAt: serializeNullableTimestamp(row.deleted_at),
      energyMode: row.energy_mode,
      focusTaskIds: normalizeStringArray(row.focus_task_ids),
      id: row.id,
      overloadScore: row.overload_score,
      routineTaskIds: normalizeStringArray(row.routine_task_ids),
      supportTaskIds: normalizeStringArray(row.support_task_ids),
      updatedAt: serializeTimestamp(row.updated_at),
      userId: row.user_id,
      version: Number(row.version),
      workspaceId: row.workspace_id,
    }
  }
}

function sortAutoBuildTasks(tasks: TaskRow[]): TaskRow[] {
  return [...tasks].sort((left, right) => {
    if (isImportantTask(left) !== isImportantTask(right)) {
      return isImportantTask(left) ? -1 : 1
    }

    const leftDue = serializeNullableDate(left.due_on) ?? '9999-12-31'
    const rightDue = serializeNullableDate(right.due_on) ?? '9999-12-31'

    if (leftDue !== rightDue) {
      return leftDue < rightDue ? -1 : 1
    }

    return serializeTimestamp(left.created_at) < serializeTimestamp(right.created_at)
      ? -1
      : 1
  })
}

function isImportantTask(task: Pick<TaskRow, 'metadata'>): boolean {
  const metadata = normalizeJsonObject(task.metadata)

  return metadata.taskImportance === 'important'
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String)
  }

  if (typeof value === 'string') {
    return value
      .replace(/[{}]/g, '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }

  return []
}

function serializeDate(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  return String(value)
}

function serializeNullableDate(value: unknown): string | null {
  return value === null ? null : serializeDate(value)
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}

function normalizeJsonObject(value: unknown): JsonObject {
  if (typeof value === 'string') {
    const parsedValue = JSON.parse(value) as unknown

    return normalizeJsonObject(parsedValue)
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject
  }

  return {}
}
