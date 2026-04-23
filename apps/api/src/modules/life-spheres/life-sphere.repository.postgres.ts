import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
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
import {
  DEFAULT_LIFE_SPHERES,
  resolveSphereHealth,
  UNSPHERED_ID,
} from './life-sphere.shared.js'

type LifeSphereRow = Selectable<DatabaseSchema['app.life_spheres']>
type TaskRow = Pick<
  Selectable<DatabaseSchema['app.tasks']>,
  | 'completed_at'
  | 'created_at'
  | 'due_on'
  | 'planned_on'
  | 'resource'
  | 'sphere_id'
  | 'status'
>

const DEFAULT_RESOURCE = 2

export class PostgresLifeSphereRepository implements LifeSphereRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listByWorkspace(
    context: LifeSphereReadContext,
  ): Promise<StoredLifeSphereRecord[]> {
    await this.ensureDefaultSpheres(context)

    const rows = await withOptionalRls(
      this.db,
      context.auth,
      (executor) => this.loadActiveSphereRows(executor, context),
      context.actorUserId,
    )

    return rows.map((row) => this.mapSphereRecord(row))
  }

  async create(
    command: CreateLifeSphereCommand,
  ): Promise<StoredLifeSphereRecord> {
    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const nextSortOrder = await this.loadNextSortOrder(
          trx,
          command.context.workspaceId,
          command.context.actorUserId,
        )
        const sphereId = command.input.id ?? generateUuidV7()
        const inserted = await trx
          .insertInto('app.life_spheres')
          .values({
            color: command.input.color,
            created_by: command.context.actorUserId,
            deleted_at: null,
            icon: command.input.icon,
            id: sphereId,
            is_active: true,
            is_default: false,
            name: command.input.name.trim(),
            sort_order: nextSortOrder,
            updated_by: command.context.actorUserId,
            user_id: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .returningAll()
          .executeTakeFirstOrThrow()

        return this.mapSphereRecord(inserted)
      },
      command.context.actorUserId,
    )
  }

  async update(
    command: UpdateLifeSphereCommand,
  ): Promise<StoredLifeSphereRecord> {
    const row = await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const updated = await trx
          .updateTable('app.life_spheres')
          .set({
            ...(command.input.name !== undefined
              ? { name: command.input.name.trim() }
              : {}),
            ...(command.input.color !== undefined
              ? { color: command.input.color }
              : {}),
            ...(command.input.icon !== undefined
              ? { icon: command.input.icon }
              : {}),
            ...(command.input.isActive !== undefined
              ? { is_active: command.input.isActive }
              : {}),
            ...(command.input.sortOrder !== undefined
              ? { sort_order: command.input.sortOrder }
              : {}),
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.sphereId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst()

        if (!updated) {
          throw new HttpError(
            404,
            'life_sphere_not_found',
            'Life sphere not found.',
          )
        }

        return updated
      },
      command.context.actorUserId,
    )

    return this.mapSphereRecord(row)
  }

  async remove(command: DeleteLifeSphereCommand): Promise<void> {
    const deletedAt = new Date().toISOString()

    await withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const updated = await trx
          .updateTable('app.life_spheres')
          .set({
            deleted_at: deletedAt,
            is_active: false,
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
    await this.ensureDefaultSpheres(command.context)

    const [sphereRows, taskRows] = await withOptionalRls(
      this.db,
      command.context.auth,
      async (executor) => {
        const spheres = await this.loadActiveSphereRows(
          executor,
          command.context,
        )
        const tasks = await executor
          .selectFrom('app.tasks')
          .select([
            'completed_at',
            'created_at',
            'due_on',
            'planned_on',
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
    const spheres = sphereRows.map((row) => this.mapSphereRecord(row))
    const sphereIds = new Set(spheres.map((sphere) => sphere.id))
    const statsBySphereId = new Map<string, StoredSphereStatsWeekly>()

    for (const sphere of spheres) {
      statsBySphereId.set(sphere.id, createEmptyStats(sphere.id))
    }

    let hasUnassigned = false

    for (const task of taskRows) {
      const sphereId = task.sphere_id && sphereIds.has(task.sphere_id)
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
        ? Math.max(0, diffInDays(statsItem.lastActivityAt, getDateKey(new Date())))
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

  private async ensureDefaultSpheres(
    context: LifeSphereReadContext,
  ): Promise<void> {
    if (!context.actorUserId || context.role === 'viewer') {
      return
    }

    await withWriteTransaction(
      this.db,
      context.auth,
      async (trx) => {
        const existing = await trx
          .selectFrom('app.life_spheres')
          .select(({ fn }) => fn.countAll<number>().as('count'))
          .where('workspace_id', '=', context.workspaceId)
          .where('user_id', '=', context.actorUserId!)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()

        if (Number(existing?.count ?? 0) > 0) {
          return
        }

        await trx
          .insertInto('app.life_spheres')
          .values(
            DEFAULT_LIFE_SPHERES.map((sphere, index) => ({
              color: sphere.color,
              created_by: context.actorUserId!,
              deleted_at: null,
              icon: sphere.icon,
              id: generateUuidV7(),
              is_active: true,
              is_default: true,
              name: sphere.name,
              sort_order: index,
              updated_by: context.actorUserId!,
              user_id: context.actorUserId!,
              workspace_id: context.workspaceId,
            })),
          )
          .onConflict((conflict) =>
            conflict.columns(['workspace_id', 'user_id', 'name']).doNothing(),
          )
          .execute()
      },
      context.actorUserId,
    )
  }

  private loadActiveSphereRows(
    executor: DatabaseExecutor,
    context: LifeSphereReadContext,
  ): Promise<LifeSphereRow[]> {
    let query = executor
      .selectFrom('app.life_spheres')
      .selectAll()
      .where('workspace_id', '=', context.workspaceId)
      .where('deleted_at', 'is', null)
      .where('is_active', '=', true)
      .orderBy('sort_order', 'asc')
      .orderBy('created_at', 'asc')

    if (context.actorUserId) {
      query = query.where('user_id', '=', context.actorUserId)
    }

    return query.execute()
  }

  private async loadNextSortOrder(
    executor: DatabaseExecutor,
    workspaceId: string,
    userId: string,
  ): Promise<number> {
    const result = await executor
      .selectFrom('app.life_spheres')
      .select(({ fn }) => fn.max<number>('sort_order').as('max_sort_order'))
      .where('workspace_id', '=', workspaceId)
      .where('user_id', '=', userId)
      .executeTakeFirst()

    return Number(result?.max_sort_order ?? -1) + 1
  }

  private mapSphereRecord(row: LifeSphereRow): StoredLifeSphereRecord {
    return {
      color: row.color,
      createdAt: serializeTimestamp(row.created_at),
      deletedAt: serializeNullableTimestamp(row.deleted_at),
      icon: row.icon,
      id: row.id,
      isActive: row.is_active,
      isDefault: row.is_default,
      name: row.name,
      sortOrder: row.sort_order,
      updatedAt: serializeTimestamp(row.updated_at),
      userId: row.user_id,
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
  const completedDate = serializeNullableTimestamp(task.completed_at)?.slice(0, 10) ?? null
  const createdDate = serializeTimestamp(task.created_at).slice(0, 10)
  const plannedDate = serializeNullableDate(task.planned_on)
  const dueDate = serializeNullableDate(task.due_on)
  const weekAnchor = plannedDate ?? dueDate ?? completedDate ?? createdDate
  const latestActivity = [plannedDate, dueDate, completedDate, createdDate]
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1)!

  if (task.status === 'todo' && isInRange(plannedDate ?? dueDate, dates)) {
    stats.plannedCount += 1
  }

  if (task.status === 'done' && isInRange(completedDate, dates)) {
    stats.completedCount += 1
  }

  if (task.status === 'todo' && plannedDate !== null && plannedDate < dates.today) {
    stats.overdueCount += 1
  }

  if (isInRange(weekAnchor, dates)) {
    stats.totalResource += task.resource ?? DEFAULT_RESOURCE
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
    icon: 'folder',
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
