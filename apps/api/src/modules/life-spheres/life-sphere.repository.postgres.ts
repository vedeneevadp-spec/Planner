import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import { buildProjectSlug } from '../projects/project.shared.js'
import type {
  CreateLifeSphereCommand,
  DeleteLifeSphereCommand,
  LifeSphereReadContext,
  StoredLifeSphereRecord,
  StoredSphereStatsWeekly,
  UpdateLifeSphereCommand,
  WeeklySphereStatsCommand,
  WeeklySphereStatsResult,
} from './life-sphere.model.js'
import type { LifeSphereRepository } from './life-sphere.repository.js'
import { resolveSphereHealth, UNSPHERED_ID } from './life-sphere.shared.js'

type ProjectRow = Selectable<DatabaseSchema['app.projects']>
type TaskRow = Pick<
  Selectable<DatabaseSchema['app.tasks']>,
  | 'completed_at'
  | 'created_at'
  | 'due_on'
  | 'planned_on'
  | 'project_id'
  | 'resource'
  | 'sphere_id'
  | 'status'
>

const DEFAULT_SPHERE_COLOR = '#2f6f62'
const DEFAULT_SPHERE_ICON = 'folder'

export class PostgresLifeSphereRepository implements LifeSphereRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listByWorkspace(
    context: LifeSphereReadContext,
  ): Promise<StoredLifeSphereRecord[]> {
    const rows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) => this.loadActiveSphereRows(executor, context.workspaceId),
      context.actorUserId,
    )

    return rows.map((row) => this.mapSphereRecord(row, context))
  }

  async create(
    command: CreateLifeSphereCommand,
  ): Promise<StoredLifeSphereRecord> {
    const name = command.input.name.trim()
    const description = command.input.description.trim()
    const color = command.input.color.trim()
    const icon = command.input.icon.trim()
    const sphereId = command.input.id ?? generateUuidV7()
    const slug = buildProjectSlug(name, sphereId)

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const nextPosition = await this.loadNextPosition(
          trx,
          command.context.workspaceId,
        )
        const inserted = await trx
          .insertInto('app.projects')
          .values({
            color,
            created_by: command.context.actorUserId,
            deleted_at: null,
            description,
            icon,
            id: sphereId,
            metadata: {},
            position: nextPosition,
            slug,
            status: 'active',
            title: name,
            updated_by: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .returningAll()
          .executeTakeFirst()

        const sphere = inserted
          ? inserted
          : await this.loadActiveSphereRow(
              trx,
              command.context.workspaceId,
              sphereId,
            )

        if (!sphere) {
          throw new Error('Failed to create life sphere record.')
        }

        return this.mapSphereRecord(sphere, command.context)
      },
      command.context.actorUserId,
    )
  }

  async update(
    command: UpdateLifeSphereCommand,
  ): Promise<StoredLifeSphereRecord> {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        let updateQuery = trx
          .updateTable('app.projects')
          .set({
            ...(command.input.name !== undefined
              ? { title: command.input.name.trim() }
              : {}),
            ...(command.input.description !== undefined
              ? { description: command.input.description.trim() }
              : {}),
            ...(command.input.color !== undefined
              ? { color: command.input.color.trim() }
              : {}),
            ...(command.input.icon !== undefined
              ? { icon: command.input.icon.trim() }
              : {}),
            ...(command.input.isActive !== undefined
              ? {
                  status: command.input.isActive
                    ? ('active' as const)
                    : ('archived' as const),
                }
              : {}),
            ...(command.input.sortOrder !== undefined
              ? { position: command.input.sortOrder }
              : {}),
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.sphereId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)

        if (command.input.expectedVersion !== undefined) {
          updateQuery = updateQuery.where(
            'version',
            '=',
            command.input.expectedVersion,
          )
        }

        const updated = await updateQuery.returningAll().executeTakeFirst()

        if (!updated) {
          const currentVersion = await this.loadCurrentSphereVersion(
            trx,
            command.context.workspaceId,
            command.sphereId,
          )

          if (!currentVersion) {
            throw new HttpError(
              404,
              'life_sphere_not_found',
              'Life sphere not found.',
            )
          }

          if (
            command.input.expectedVersion !== undefined &&
            Number(currentVersion.version) !== command.input.expectedVersion
          ) {
            throw new HttpError(
              409,
              'life_sphere_version_conflict',
              'Life sphere was changed on the server.',
              {
                actualVersion: Number(currentVersion.version),
                expectedVersion: command.input.expectedVersion,
              },
            )
          }

          throw new Error(`Life sphere "${command.sphereId}" was not updated.`)
        }

        return this.mapSphereRecord(updated, command.context)
      },
      command.context.actorUserId,
    )
  }

  async remove(command: DeleteLifeSphereCommand): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const updated = await trx
          .updateTable('app.projects')
          .set({
            deleted_at: deletedAt,
            status: 'archived',
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.sphereId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .returning(['id'])
          .executeTakeFirst()

        if (!updated) {
          throw new HttpError(
            404,
            'life_sphere_not_found',
            'Life sphere not found.',
          )
        }

        await trx
          .updateTable('app.tasks')
          .set({
            project_id: null,
            sphere_id: null,
            updated_by: command.context.actorUserId,
          })
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .where((expressionBuilder) =>
            expressionBuilder.or([
              expressionBuilder('project_id', '=', command.sphereId),
              expressionBuilder('sphere_id', '=', command.sphereId),
            ]),
          )
          .execute()

        await trx
          .updateTable('app.task_templates')
          .set({
            project_id: null,
            updated_by: command.context.actorUserId,
          })
          .where('workspace_id', '=', command.context.workspaceId)
          .where('project_id', '=', command.sphereId)
          .where('deleted_at', 'is', null)
          .execute()

        await trx
          .updateTable('app.chaos_inbox_items')
          .set({
            sphere_id: null,
            updated_by: command.context.actorUserId,
          })
          .where('workspace_id', '=', command.context.workspaceId)
          .where('sphere_id', '=', command.sphereId)
          .where('deleted_at', 'is', null)
          .execute()
      },
      command.context.actorUserId,
    )
  }

  async getWeeklyStats(
    command: WeeklySphereStatsCommand,
  ): Promise<WeeklySphereStatsResult> {
    const [sphereRows, taskRows] = await withOptionalRls(
      this.db,
      command.context.auth,
      async (executor) => {
        const spheres = await this.loadActiveSphereRows(
          executor,
          command.context.workspaceId,
        )
        const tasks = await executor
          .selectFrom('app.tasks')
          .select([
            'completed_at',
            'created_at',
            'due_on',
            'planned_on',
            'project_id',
            'resource',
            'sphere_id',
            'status',
          ])
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .execute()

        return [spheres, tasks] as const
      },
      command.context.actorUserId,
    )
    const spheres = sphereRows.map((row) =>
      this.mapSphereRecord(row, command.context),
    )
    const sphereIds = new Set(spheres.map((sphere) => sphere.id))
    const statsBySphereId = new Map<string, StoredSphereStatsWeekly>()

    for (const sphere of spheres) {
      statsBySphereId.set(sphere.id, createEmptyStats(sphere.id))
    }

    let hasUnassigned = false

    for (const task of taskRows) {
      const sphereId =
        task.project_id && sphereIds.has(task.project_id)
          ? task.project_id
          : task.sphere_id && sphereIds.has(task.sphere_id)
            ? task.sphere_id
            : UNSPHERED_ID

      if (sphereId === UNSPHERED_ID) {
        hasUnassigned = true
      }

      if (!statsBySphereId.has(sphereId)) {
        statsBySphereId.set(sphereId, createEmptyStats(sphereId))
      }

      updateStats(statsBySphereId.get(sphereId)!, task, {
        from: command.from,
        today: getDateKey(new Date()),
        to: command.to,
      })
    }

    const totalWeeklyResource = [...statsBySphereId.values()].reduce(
      (sum, stats) => sum + stats.totalResource,
      0,
    )
    const stats = [...statsBySphereId.values()].map((statsItem) => {
      const idleDays = statsItem.lastActivityAt
        ? Math.max(
            0,
            diffInDays(statsItem.lastActivityAt, getDateKey(new Date())),
          )
        : null

      return {
        ...statsItem,
        health: resolveSphereHealth({
          completedCount: statsItem.completedCount,
          idleDays,
          overdueCount: statsItem.overdueCount,
          plannedCount: statsItem.plannedCount,
        }),
        weeklyShare:
          totalWeeklyResource > 0
            ? Math.round((statsItem.totalResource / totalWeeklyResource) * 100)
            : 0,
      }
    })

    return {
      from: command.from,
      spheres: hasUnassigned
        ? [...spheres, createUnassignedSphere(command.context)]
        : spheres,
      stats,
      to: command.to,
    }
  }

  private loadActiveSphereRows(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<ProjectRow[]> {
    return executor
      .selectFrom('app.projects')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .where('status', '=', 'active')
      .orderBy('position', 'asc')
      .orderBy('created_at', 'asc')
      .execute()
  }

  private loadActiveSphereRow(
    executor: DatabaseExecutor,
    workspaceId: string,
    sphereId: string,
  ): Promise<ProjectRow | undefined> {
    return executor
      .selectFrom('app.projects')
      .selectAll()
      .where('id', '=', sphereId)
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .where('status', '=', 'active')
      .executeTakeFirst()
  }

  private loadCurrentSphereVersion(
    executor: DatabaseExecutor,
    workspaceId: string,
    sphereId: string,
  ): Promise<Pick<ProjectRow, 'id' | 'version'> | undefined> {
    return executor
      .selectFrom('app.projects')
      .select(['id', 'version'])
      .where('id', '=', sphereId)
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst()
  }

  private async loadNextPosition(
    executor: DatabaseExecutor,
    workspaceId: string,
  ): Promise<number> {
    const result = await executor
      .selectFrom('app.projects')
      .select(({ fn }) => fn.max<number>('position').as('max_position'))
      .where('workspace_id', '=', workspaceId)
      .executeTakeFirst()

    return Number(result?.max_position ?? -1) + 1
  }

  private mapSphereRecord(
    row: ProjectRow,
    context: Pick<LifeSphereReadContext, 'actorUserId' | 'workspaceId'>,
  ): StoredLifeSphereRecord {
    return {
      color: row.color ?? DEFAULT_SPHERE_COLOR,
      createdAt: serializeTimestamp(row.created_at),
      deletedAt: serializeNullableTimestamp(row.deleted_at),
      description: row.description,
      icon: row.icon || DEFAULT_SPHERE_ICON,
      id: row.id,
      isActive: row.status === 'active',
      isDefault: false,
      name: row.title,
      sortOrder: row.position,
      updatedAt: serializeTimestamp(row.updated_at),
      userId: context.actorUserId ?? row.created_by ?? '',
      version: Number(row.version),
      workspaceId: row.workspace_id,
    }
  }
}

function createEmptyStats(sphereId: string): StoredSphereStatsWeekly {
  return {
    completedCount: 0,
    health: 'abandoned',
    lastActivityAt: null,
    overdueCount: 0,
    plannedCount: 0,
    sphereId,
    totalResource: 0,
    weeklyShare: 0,
  }
}

function updateStats(
  stats: StoredSphereStatsWeekly,
  task: TaskRow,
  dates: { from: string; today: string; to: string },
): void {
  const completedDate =
    serializeNullableTimestamp(task.completed_at)?.slice(0, 10) ?? null
  const createdDate = serializeTimestamp(task.created_at).slice(0, 10)
  const plannedDate = serializeNullableDate(task.planned_on)
  const dueDate = serializeNullableDate(task.due_on)
  const weekAnchor = plannedDate ?? dueDate ?? completedDate ?? createdDate
  const latestActivity = [plannedDate, dueDate, completedDate, createdDate]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)!

  if (task.status !== 'done' && isInRange(plannedDate ?? dueDate, dates)) {
    stats.plannedCount += 1
  }

  if (task.status === 'done' && isInRange(completedDate, dates)) {
    stats.completedCount += 1
  }

  if (
    task.status !== 'done' &&
    plannedDate !== null &&
    plannedDate < dates.today
  ) {
    stats.overdueCount += 1
  }

  if (isInRange(weekAnchor, dates)) {
    stats.totalResource += Math.max(0, -(task.resource ?? 0))
  }

  if (!stats.lastActivityAt || latestActivity > stats.lastActivityAt) {
    stats.lastActivityAt = latestActivity
  }
}

function isInRange(
  value: string | null,
  dates: { from: string; to: string },
): boolean {
  return value !== null && value >= dates.from && value <= dates.to
}

function createUnassignedSphere(
  context: LifeSphereReadContext,
): StoredLifeSphereRecord {
  const now = new Date().toISOString()

  return {
    color: '#6f766d',
    createdAt: now,
    deletedAt: null,
    description: '',
    icon: DEFAULT_SPHERE_ICON,
    id: UNSPHERED_ID,
    isActive: true,
    isDefault: false,
    name: 'Без сферы',
    sortOrder: 999,
    updatedAt: now,
    userId: context.actorUserId ?? '',
    version: 1,
    workspaceId: context.workspaceId,
  }
}

function diffInDays(left: string, right: string): number {
  return Math.floor(
    (new Date(`${right}T12:00:00`).getTime() -
      new Date(`${left}T12:00:00`).getTime()) /
      86_400_000,
  )
}

function getDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function serializeNullableDate(value: unknown): string | null {
  if (value === null) {
    return null
  }

  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  throw new TypeError(`Unexpected date value: ${typeof value}`)
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
