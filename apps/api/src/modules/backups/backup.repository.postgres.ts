import { readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  type UserBackupArchive,
  userBackupArchiveSchema,
  type UserBackupAsset,
  type UserBackupRow,
  userBackupRowSchema,
  type UserBackupTableName,
} from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import {
  type DatabaseExecutor,
  withOptionalRls,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  UserBackupExportInput,
  UserBackupExportResult,
} from './backup.model.js'
import type { UserBackupRepository } from './backup.repository.js'

const PROFILE_ASSET_PATH_PREFIX = '/api/v1/profile-assets/'

const CONTENT_TYPES_BY_EXTENSION = new Map<
  string,
  UserBackupAsset['contentType']
>([
  ['gif', 'image/gif'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
])

interface TableExportQuery {
  load: (
    executor: DatabaseExecutor,
    input: TableQueryInput,
  ) => Promise<UserBackupRow[]>
  name: UserBackupTableName
}

interface TableQueryInput {
  actorUserId: string
  workspaceId: string
}

export class PostgresUserBackupRepository implements UserBackupRepository {
  private readonly assetDirectory: string

  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    assetDirectory: string,
  ) {
    this.assetDirectory = path.resolve(assetDirectory)
  }

  async exportPersonalWorkspace({
    appVersion,
    context,
  }: UserBackupExportInput): Promise<UserBackupExportResult> {
    const actorUserId = context.actorUserId

    if (!actorUserId) {
      throw new Error('User backup export requires an actor user id.')
    }

    const { assets, tables } = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const exportedTables: Record<string, UserBackupRow[]> = {}
        const input = { actorUserId, workspaceId: context.workspaceId }

        for (const table of TABLE_EXPORT_QUERIES) {
          exportedTables[table.name] = await table.load(executor, input)
        }

        const normalizedTables =
          normalizeUserBackupTableReferences(exportedTables)

        return {
          assets: await this.collectAssets(normalizedTables),
          tables: normalizedTables,
        }
      },
      actorUserId,
      { readOnlySnapshot: true },
    )
    const archive: UserBackupArchive = {
      assets,
      exportedAt: new Date().toISOString(),
      format: 'planner.user-backup',
      scope: {
        userId: actorUserId,
        workspaceId: context.workspaceId,
        workspaceKind: 'personal',
        workspaceName: context.workspaceName ?? 'Personal workspace',
      },
      source: {
        appVersion,
      },
      tables,
      version: 1,
    }

    return userBackupArchiveSchema.parse(archive)
  }

  private async collectAssets(
    tables: Record<string, UserBackupRow[]>,
  ): Promise<UserBackupAsset[]> {
    const assetsByPath = new Map<string, UserBackupAsset>()
    const users = tables.users ?? []

    for (const user of users) {
      const avatarUrl = readStringField(user, 'avatar_url')
      const asset = await this.readAsset(
        'profile_avatar',
        avatarUrl,
        PROFILE_ASSET_PATH_PREFIX,
        path.join(this.assetDirectory, 'profiles'),
      )

      if (asset) {
        assetsByPath.set(asset.path, asset)
      }
    }

    return [...assetsByPath.values()].sort((left, right) =>
      left.path.localeCompare(right.path),
    )
  }

  private async readAsset(
    kind: UserBackupAsset['kind'],
    value: string | null,
    publicPathPrefix: string,
    directory: string,
  ): Promise<UserBackupAsset | null> {
    const fileName = extractPublicAssetFileName(value, publicPathPrefix)

    if (!fileName) {
      return null
    }

    try {
      const buffer = await readFile(path.join(directory, fileName))
      const contentType = inferContentType(fileName)

      if (!contentType) {
        return null
      }

      return {
        base64: buffer.toString('base64'),
        byteLength: buffer.byteLength,
        contentType,
        kind,
        path: `${publicPathPrefix}${fileName}`,
      }
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return null
      }

      throw error
    }
  }
}

const TABLE_EXPORT_QUERIES: TableExportQuery[] = [
  {
    name: 'users',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
          from (
            select
              id,
              email,
              display_name,
              avatar_url,
              timezone,
              locale,
              default_time_zone,
              last_seen_time_zone,
              time_zone_mode,
              calendar_view_mode,
              energy_mode,
              voice_assistant_enabled,
              created_at,
              updated_at,
              deleted_at,
              version
            from app.users
            where id = ${input.actorUserId}
          ) as row
        `,
      ),
  },
  {
    name: 'workspaces',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
          from (
            select *
            from app.workspaces
            where id = ${input.workspaceId}
              and kind = 'personal'
          ) as row
        `,
      ),
  },
  {
    name: 'workspace_members',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
          from (
            select *
            from app.workspace_members
            where workspace_id = ${input.workspaceId}
              and user_id = ${input.actorUserId}
          ) as row
        `,
      ),
  },
  {
    name: 'projects',
    load: (executor, input) =>
      selectActiveWorkspaceRows(executor, 'app.projects', input),
  },
  {
    name: 'tasks',
    load: (executor, input) => selectTaskRows(executor, input),
  },
  {
    name: 'task_chains',
    load: (executor, input) => selectTaskChainRows(executor, input),
  },
  {
    name: 'task_time_blocks',
    load: (executor, input) =>
      selectTaskChildRows(executor, 'app.task_time_blocks', input, {
        hasDeletedAt: true,
      }),
  },
  {
    name: 'task_occurrences',
    load: (executor, input) =>
      selectTaskChildRows(executor, 'app.task_occurrences', input),
  },
  {
    name: 'task_attachments',
    load: (executor, input) =>
      selectTaskChildRows(executor, 'app.task_attachments', input, {
        hasDeletedAt: true,
      }),
  },
  {
    name: 'task_templates',
    load: (executor, input) =>
      selectActiveWorkspaceRows(executor, 'app.task_templates', input),
  },
  {
    name: 'daily_plans',
    load: (executor, input) =>
      selectActiveWorkspaceUserRows(executor, 'app.daily_plans', input),
  },
  {
    name: 'chaos_inbox_items',
    load: (executor, input) =>
      selectActiveWorkspaceUserRows(executor, 'app.chaos_inbox_items', input),
  },
  {
    name: 'cleaning_zones',
    load: (executor, input) =>
      selectActiveWorkspaceUserRows(executor, 'app.cleaning_zones', input),
  },
  {
    name: 'cleaning_tasks',
    load: (executor, input) =>
      selectActiveWorkspaceUserRows(executor, 'app.cleaning_tasks', input),
  },
  {
    name: 'cleaning_task_states',
    load: (executor, input) => selectCleaningTaskStateRows(executor, input),
  },
  {
    name: 'cleaning_task_history',
    load: (executor, input) => selectCleaningTaskHistoryRows(executor, input),
  },
  {
    name: 'habits',
    load: (executor, input) =>
      selectActiveWorkspaceUserRows(executor, 'app.habits', input),
  },
  {
    name: 'habit_entries',
    load: (executor, input) => selectHabitEntryRows(executor, input),
  },
  {
    name: 'self_care_items',
    load: (executor, input) =>
      selectActiveWorkspaceUserRows(executor, 'app.self_care_items', input),
  },
  {
    name: 'self_care_item_alternatives',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_item_alternatives',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_schedule_rules',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_schedule_rules',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_occurrences',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
          from (
            select occurrence.*
            from app.self_care_occurrences as occurrence
            inner join app.self_care_items as item
              on item.id = occurrence.item_id
            where occurrence.user_id = ${input.actorUserId}
              and item.workspace_id = ${input.workspaceId}
              and item.user_id = ${input.actorUserId}
          ) as row
        `,
      ),
  },
  {
    name: 'self_care_completions',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
          from (
            select completion.*
            from app.self_care_completions as completion
            inner join app.self_care_items as item
              on item.id = completion.item_id
            where completion.user_id = ${input.actorUserId}
              and item.workspace_id = ${input.workspaceId}
              and item.user_id = ${input.actorUserId}
          ) as row
        `,
      ),
  },
  {
    name: 'self_care_ritual_steps',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_ritual_steps',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_ritual_step_completions',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
          from (
            select step_completion.*
            from app.self_care_ritual_step_completions as step_completion
            inner join app.self_care_completions as completion
              on completion.id = step_completion.completion_id
            inner join app.self_care_items as item
              on item.id = completion.item_id
            where completion.user_id = ${input.actorUserId}
              and item.workspace_id = ${input.workspaceId}
              and item.user_id = ${input.actorUserId}
          ) as row
        `,
      ),
  },
  {
    name: 'self_care_ritual_step_drafts',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
          from (
            select draft.*
            from app.self_care_ritual_step_drafts as draft
            inner join app.self_care_items as item
              on item.id = draft.item_id
            where draft.workspace_id = ${input.workspaceId}
              and draft.user_id = ${input.actorUserId}
              and item.workspace_id = ${input.workspaceId}
              and item.user_id = ${input.actorUserId}
              and item.deleted_at is null
          ) as row
        `,
      ),
  },
  {
    name: 'self_care_procedure_details',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_procedure_details',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_appointment_details',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_appointment_details',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_medical_details',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_medical_details',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_course_details',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_course_details',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_measurement_details',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_measurement_details',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_exercise_details',
    load: (executor, input) =>
      selectSelfCareChildRows(
        executor,
        'app.self_care_exercise_details',
        'item_id',
        input,
      ),
  },
  {
    name: 'self_care_daily_states',
    load: (executor, input) =>
      selectUserRows(executor, 'app.self_care_daily_states', input),
  },
  {
    name: 'self_care_settings',
    load: (executor, input) =>
      selectUserRows(executor, 'app.self_care_settings', input),
  },
  {
    name: 'self_care_minimum_items',
    load: (executor, input) =>
      selectUserRows(executor, 'app.self_care_minimum_items', input),
  },
]

export const USER_BACKUP_EXPORTED_TABLE_NAMES = TABLE_EXPORT_QUERIES.map(
  (table) => table.name,
)

export function normalizeUserBackupTableReferences(
  tables: Record<string, UserBackupRow[]>,
): Record<string, UserBackupRow[]> {
  const taskIds = new Set(
    (tables.tasks ?? [])
      .map((row) => readStringField(row, 'id'))
      .filter((value): value is string => Boolean(value)),
  )

  return {
    ...tables,
    daily_plans: (tables.daily_plans ?? []).map((plan) => {
      const normalizedPlan = { ...plan }

      for (const column of [
        'focus_task_ids',
        'routine_task_ids',
        'support_task_ids',
      ]) {
        const values = plan[column]

        if (Array.isArray(values)) {
          normalizedPlan[column] = values.filter(
            (value) => typeof value === 'string' && taskIds.has(value),
          )
        }
      }

      return normalizedPlan
    }),
  }
}

async function selectTaskRows(
  executor: DatabaseExecutor,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select task.*
        from app.tasks as task
        where ${exportableTaskPredicate(input, 'task')}
          and (
            task.project_id is null
            or exists (
              select 1
              from app.projects as project
              where project.id = task.project_id
                and project.workspace_id = task.workspace_id
                and project.deleted_at is null
            )
          )
          and (
            task.previous_task_id is null
            or exists (
              select 1
              from app.tasks as previous_task
              where previous_task.id = task.previous_task_id
                and ${exportableTaskPredicate(input, 'previous_task')}
            )
          )
          and (
            task.parent_task_id is null
            or exists (
              select 1
              from app.tasks as parent_task
              where parent_task.id = task.parent_task_id
                and ${exportableTaskPredicate(input, 'parent_task')}
            )
          )
          and (
            task.chain_id is null
            or exists (
              select 1
              from app.task_chains as chain
              where chain.id = task.chain_id
                and chain.workspace_id = task.workspace_id
                and chain.deleted_at is null
                and (
                  chain.root_task_id is null
                  or exists (
                    select 1
                    from app.tasks as root_task
                    where root_task.id = chain.root_task_id
                      and ${exportableTaskPredicate(input, 'root_task')}
                  )
                )
            )
          )
      ) as row
    `,
  )
}

async function selectTaskChainRows(
  executor: DatabaseExecutor,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select chain.*
        from app.task_chains as chain
        where chain.workspace_id = ${input.workspaceId}
          and chain.deleted_at is null
          and exists (
            select 1
            from app.tasks as task
            where task.chain_id = chain.id
              and ${exportableTaskPredicate(input, 'task')}
          )
          and (
            chain.root_task_id is null
            or exists (
              select 1
              from app.tasks as root_task
              where root_task.id = chain.root_task_id
                and ${exportableTaskPredicate(input, 'root_task')}
            )
          )
      ) as row
    `,
  )
}

async function selectTaskChildRows(
  executor: DatabaseExecutor,
  tableName: string,
  input: TableQueryInput,
  options: {
    hasDeletedAt?: boolean
  } = {},
): Promise<UserBackupRow[]> {
  const deletedAtPredicate = options.hasDeletedAt
    ? sql`and child.deleted_at is null`
    : sql``

  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select child.*
        from ${sql.table(tableName)} as child
        inner join app.tasks as task
          on task.id = child.task_id
        where ${exportableTaskPredicate(input, 'task')}
          ${deletedAtPredicate}
      ) as row
    `,
  )
}

async function selectActiveWorkspaceRows(
  executor: DatabaseExecutor,
  tableName: string,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select *
        from ${sql.table(tableName)}
        where workspace_id = ${input.workspaceId}
          and deleted_at is null
      ) as row
    `,
  )
}

async function selectActiveWorkspaceUserRows(
  executor: DatabaseExecutor,
  tableName: string,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select *
        from ${sql.table(tableName)}
        where workspace_id = ${input.workspaceId}
          and user_id = ${input.actorUserId}
          and deleted_at is null
      ) as row
    `,
  )
}

async function selectCleaningTaskStateRows(
  executor: DatabaseExecutor,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.task_id), '[]'::jsonb) as rows
      from (
        select state.*
        from app.cleaning_task_states as state
        inner join app.cleaning_tasks as task
          on task.id = state.task_id
        where state.workspace_id = ${input.workspaceId}
          and state.user_id = ${input.actorUserId}
          and task.workspace_id = ${input.workspaceId}
          and task.user_id = ${input.actorUserId}
          and task.deleted_at is null
      ) as row
    `,
  )
}

async function selectCleaningTaskHistoryRows(
  executor: DatabaseExecutor,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select history.*
        from app.cleaning_task_history as history
        inner join app.cleaning_tasks as task
          on task.id = history.task_id
        where history.workspace_id = ${input.workspaceId}
          and history.user_id = ${input.actorUserId}
          and task.workspace_id = ${input.workspaceId}
          and task.user_id = ${input.actorUserId}
          and task.deleted_at is null
      ) as row
    `,
  )
}

async function selectHabitEntryRows(
  executor: DatabaseExecutor,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select entry.*
        from app.habit_entries as entry
        inner join app.habits as habit
          on habit.id = entry.habit_id
        where entry.workspace_id = ${input.workspaceId}
          and entry.user_id = ${input.actorUserId}
          and entry.deleted_at is null
          and habit.workspace_id = ${input.workspaceId}
          and habit.user_id = ${input.actorUserId}
          and habit.deleted_at is null
      ) as row
    `,
  )
}

async function selectUserRows(
  executor: DatabaseExecutor,
  tableName: string,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select *
        from ${sql.table(tableName)}
        where user_id = ${input.actorUserId}
      ) as row
    `,
  )
}

async function selectSelfCareChildRows(
  executor: DatabaseExecutor,
  tableName: string,
  itemIdColumn: string,
  input: TableQueryInput,
): Promise<UserBackupRow[]> {
  return selectRows(
    executor,
    sql`
      select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
      from (
        select child.*
        from ${sql.table(tableName)} as child
        inner join app.self_care_items as item
          on item.id = ${sql.ref(`child.${itemIdColumn}`)}
        where item.workspace_id = ${input.workspaceId}
          and item.user_id = ${input.actorUserId}
          and item.deleted_at is null
      ) as row
    `,
  )
}

function exportableTaskPredicate(input: TableQueryInput, alias: string) {
  return sql`
    ${sql.ref(`${alias}.workspace_id`)} = ${input.workspaceId}
    and ${sql.ref(`${alias}.deleted_at`)} is null
    and (
      ${sql.ref(`${alias}.status`)} <> 'done'
      or ${sql.ref(`${alias}.completed_at`)} >= now() - interval '14 days'
    )
  `
}

async function selectRows(
  executor: DatabaseExecutor,
  query: ReturnType<typeof sql<{ rows: unknown }>>,
): Promise<UserBackupRow[]> {
  const result = await query.execute(executor)
  const rows = result.rows[0]?.rows ?? []

  return userBackupRowSchema.array().parse(rows)
}

function readStringField(row: UserBackupRow, fieldName: string): string | null {
  const value = row[fieldName]

  return typeof value === 'string' ? value : null
}

function extractPublicAssetFileName(
  value: string | null,
  publicPathPrefix: string,
): string | null {
  if (!value) {
    return null
  }

  const normalizedValue = value.trim()
  const prefixIndex = normalizedValue.indexOf(publicPathPrefix)

  if (prefixIndex === -1) {
    return null
  }

  const fileName = normalizedValue.slice(prefixIndex + publicPathPrefix.length)

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(fileName)) {
    return null
  }

  return fileName
}

function inferContentType(
  fileName: string,
): UserBackupAsset['contentType'] | null {
  const extension = fileName.split('.').pop()?.toLowerCase()

  return extension ? (CONTENT_TYPES_BY_EXTENSION.get(extension) ?? null) : null
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}
