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

const ICON_ASSET_PATH_PREFIX = '/api/v1/icon-assets/'
const PROFILE_ASSET_PATH_PREFIX = '/api/v1/profile-assets/'

const CONTENT_TYPES_BY_EXTENSION = new Map<string, string>([
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

    const tables = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const exportedTables: Record<string, UserBackupRow[]> = {}
        const input = { actorUserId, workspaceId: context.workspaceId }

        for (const table of TABLE_EXPORT_QUERIES) {
          exportedTables[table.name] = await table.load(executor, input)
        }

        return exportedTables
      },
      actorUserId,
    )
    const assets = await this.collectAssets(tables)
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
    const emojiAssets = tables.emoji_assets ?? []

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

    for (const emojiAsset of emojiAssets) {
      const value = readStringField(emojiAsset, 'value')
      const asset = await this.readAsset(
        'emoji_asset',
        value,
        ICON_ASSET_PATH_PREFIX,
        this.assetDirectory,
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
      selectWorkspaceRows(executor, 'app.projects', input),
  },
  {
    name: 'tasks',
    load: (executor, input) =>
      selectWorkspaceRows(executor, 'app.tasks', input),
  },
  {
    name: 'task_chains',
    load: (executor, input) =>
      selectWorkspaceRows(executor, 'app.task_chains', input),
  },
  {
    name: 'task_time_blocks',
    load: (executor, input) =>
      selectWorkspaceRows(executor, 'app.task_time_blocks', input),
  },
  {
    name: 'task_occurrences',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.id), '[]'::jsonb) as rows
          from (
            select occurrence.*
            from app.task_occurrences as occurrence
            inner join app.tasks as task
              on task.id = occurrence.task_id
            where task.workspace_id = ${input.workspaceId}
          ) as row
        `,
      ),
  },
  {
    name: 'task_attachments',
    load: (executor, input) =>
      selectWorkspaceRows(executor, 'app.task_attachments', input),
  },
  {
    name: 'task_templates',
    load: (executor, input) =>
      selectWorkspaceRows(executor, 'app.task_templates', input),
  },
  {
    name: 'daily_plans',
    load: (executor, input) =>
      selectWorkspaceUserRows(executor, 'app.daily_plans', input),
  },
  {
    name: 'chaos_inbox_items',
    load: (executor, input) =>
      selectWorkspaceUserRows(executor, 'app.chaos_inbox_items', input),
  },
  {
    name: 'cleaning_zones',
    load: (executor, input) =>
      selectWorkspaceUserRows(executor, 'app.cleaning_zones', input),
  },
  {
    name: 'cleaning_tasks',
    load: (executor, input) =>
      selectWorkspaceUserRows(executor, 'app.cleaning_tasks', input),
  },
  {
    name: 'cleaning_task_states',
    load: (executor, input) =>
      selectRows(
        executor,
        sql`
          select coalesce(jsonb_agg(to_jsonb(row) order by row.task_id), '[]'::jsonb) as rows
          from (
            select *
            from app.cleaning_task_states
            where workspace_id = ${input.workspaceId}
              and user_id = ${input.actorUserId}
          ) as row
        `,
      ),
  },
  {
    name: 'cleaning_task_history',
    load: (executor, input) =>
      selectWorkspaceUserRows(executor, 'app.cleaning_task_history', input),
  },
  {
    name: 'habits',
    load: (executor, input) =>
      selectWorkspaceUserRows(executor, 'app.habits', input),
  },
  {
    name: 'habit_entries',
    load: (executor, input) =>
      selectWorkspaceUserRows(executor, 'app.habit_entries', input),
  },
  {
    name: 'self_care_items',
    load: (executor, input) =>
      selectWorkspaceUserRows(executor, 'app.self_care_items', input),
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
      selectWorkspaceUserRows(
        executor,
        'app.self_care_ritual_step_drafts',
        input,
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
  {
    name: 'emoji_sets',
    load: (executor, input) =>
      selectWorkspaceRows(executor, 'app.emoji_sets', input),
  },
  {
    name: 'emoji_assets',
    load: (executor, input) =>
      selectWorkspaceRows(executor, 'app.emoji_assets', input),
  },
]

async function selectWorkspaceRows(
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
      ) as row
    `,
  )
}

async function selectWorkspaceUserRows(
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
      ) as row
    `,
  )
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

function inferContentType(fileName: string): string | null {
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
