import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable, sql } from 'kysely'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import {
  type DatabaseExecutor,
  isSupabasePoolerRuntimeEnvironment,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import {
  EmojiAssetNotFoundError,
  EmojiSetNotFoundError,
} from './emoji-set.errors.js'
import type {
  AddEmojiSetItemsCommand,
  CreateEmojiSetCommand,
  DeleteEmojiSetCommand,
  DeleteEmojiSetItemCommand,
  EmojiSetReadContext,
  StoredEmojiAssetRecord,
  StoredEmojiSetRecord,
} from './emoji-set.model.js'
import type { EmojiSetRepository } from './emoji-set.repository.js'
import {
  buildEmojiSetSlug,
  normalizeEmojiAssetInput,
  normalizeEmojiSetInput,
  sortStoredEmojiSets,
} from './emoji-set.shared.js'

type EmojiSetRow = Selectable<DatabaseSchema['app.emoji_sets']>
type EmojiAssetRow = Selectable<DatabaseSchema['app.emoji_assets']>
type EmojiSetAggregateRow = {
  assets: EmojiAssetRow[]
  emoji_set: EmojiSetRow
}

export class PostgresEmojiSetRepository implements EmojiSetRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async listByWorkspace(
    context: EmojiSetReadContext,
  ): Promise<StoredEmojiSetRecord[]> {
    return withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const emojiSetRows = await executor
          .selectFrom('app.emoji_sets')
          .selectAll()
          .where('workspace_id', '=', context.workspaceId)
          .where('deleted_at', 'is', null)
          .where('status', '=', 'active')
          .orderBy('title', 'asc')
          .orderBy('created_at', 'asc')
          .execute()

        const assetRows = await this.loadEmojiAssetRows(
          executor,
          context.workspaceId,
          emojiSetRows.map((emojiSet) => emojiSet.id),
        )

        return this.mapEmojiSetRows(emojiSetRows, assetRows)
      },
      context.actorUserId,
    )
  }

  async getById(
    context: EmojiSetReadContext,
    emojiSetId: string,
  ): Promise<StoredEmojiSetRecord> {
    const emojiSet = await withOptionalRls(
      this.db,
      context.auth,
      async (executor) => {
        const emojiSetRow = await this.loadActiveEmojiSet(
          executor,
          context.workspaceId,
          emojiSetId,
        )

        if (!emojiSetRow) {
          return null
        }

        const assetRows = await this.loadEmojiAssetRows(
          executor,
          context.workspaceId,
          [emojiSetRow.id],
        )

        return this.mapEmojiSetRecord(emojiSetRow, assetRows)
      },
      context.actorUserId,
    )

    if (!emojiSet) {
      throw new EmojiSetNotFoundError(emojiSetId)
    }

    return emojiSet
  }

  async create(command: CreateEmojiSetCommand): Promise<StoredEmojiSetRecord> {
    const normalizedInput = normalizeEmojiSetInput(command.input)
    const emojiSetId = normalizedInput.id ?? generateUuidV7()
    const slug = buildEmojiSetSlug(normalizedInput.title, emojiSetId)

    if (this.shouldUsePoolerWriteFallback()) {
      return this.createWithPoolerWriteFallback(command, {
        emojiSetId,
        normalizedInput,
        slug,
      })
    }

    return withWriteTransaction(
      this.db,
      command.context.auth,
      async (trx) => {
        const insertedEmojiSet = await trx
          .insertInto('app.emoji_sets')
          .values({
            created_by: command.context.actorUserId,
            deleted_at: null,
            description: normalizedInput.description,
            id: emojiSetId,
            metadata: {},
            slug,
            source: normalizedInput.source,
            status: 'active',
            title: normalizedInput.title,
            updated_by: command.context.actorUserId,
            workspace_id: command.context.workspaceId,
          })
          .onConflict((conflict) => conflict.column('id').doNothing())
          .returningAll()
          .executeTakeFirst()

        if (insertedEmojiSet) {
          await trx
            .insertInto('app.emoji_assets')
            .values(
              normalizedInput.items.map((item, index) => ({
                created_by: command.context.actorUserId,
                deleted_at: null,
                emoji_set_id: emojiSetId,
                id: item.id ?? generateUuidV7(),
                keywords: item.keywords,
                kind: item.kind,
                label: item.label,
                metadata: {},
                shortcode: item.shortcode,
                sort_order: index,
                updated_by: command.context.actorUserId,
                value: item.value,
                workspace_id: command.context.workspaceId,
              })),
            )
            .execute()
        }

        const emojiSet = insertedEmojiSet
          ? insertedEmojiSet
          : await this.loadActiveEmojiSet(
              trx,
              command.context.workspaceId,
              emojiSetId,
            )

        if (!emojiSet) {
          throw new Error('Failed to create icon set record.')
        }

        const assetRows = await this.loadEmojiAssetRows(
          trx,
          command.context.workspaceId,
          [emojiSet.id],
        )

        return this.mapEmojiSetRecord(emojiSet, assetRows)
      },
      command.context.actorUserId,
    )
  }

  async addItems(
    command: AddEmojiSetItemsCommand,
  ): Promise<StoredEmojiSetRecord> {
    if (this.shouldUsePoolerWriteFallback()) {
      return this.addItemsWithPoolerWriteFallback(command)
    }

    return withOptionalRls(
      this.db,
      command.context.auth,
      async (executor) => {
        const emojiSet = await this.loadActiveEmojiSet(
          executor,
          command.context.workspaceId,
          command.emojiSetId,
        )

        if (!emojiSet) {
          throw new EmojiSetNotFoundError(command.emojiSetId)
        }

        const assetStats = await this.loadEmojiAssetStats(
          executor,
          command.context.workspaceId,
          command.emojiSetId,
        )
        const normalizedItems = command.input.items.map((item, index) =>
          normalizeEmojiAssetInput(
            {
              ...item,
              shortcode: undefined,
            },
            assetStats.count + index,
          ),
        )

        await executor
          .insertInto('app.emoji_assets')
          .values(
            normalizedItems.map((item, index) => ({
              created_by: command.context.actorUserId,
              deleted_at: null,
              emoji_set_id: command.emojiSetId,
              id: item.id ?? generateUuidV7(),
              keywords: item.keywords,
              kind: item.kind,
              label: item.label,
              metadata: {},
              shortcode: item.shortcode,
              sort_order: assetStats.maxSortOrder + 1 + index,
              updated_by: command.context.actorUserId,
              value: item.value,
              workspace_id: command.context.workspaceId,
            })),
          )
          .execute()

        const assetRows = await this.loadEmojiAssetRows(
          executor,
          command.context.workspaceId,
          [emojiSet.id],
        )

        return this.mapEmojiSetRecord(emojiSet, assetRows)
      },
      command.context.actorUserId,
    )
  }

  private shouldUsePoolerWriteFallback(): boolean {
    return isSupabasePoolerRuntimeEnvironment(process.env)
  }

  private executePoolerWriteStatement<T>(
    authContext: AuthenticatedRequestContext | null,
    actorUserId: string,
    callback: (executor: DatabaseExecutor) => Promise<T>,
  ): Promise<T> {
    return withOptionalRls(this.db, authContext, callback, actorUserId)
  }

  private async createWithPoolerWriteFallback(
    command: CreateEmojiSetCommand,
    params: {
      emojiSetId: string
      normalizedInput: ReturnType<typeof normalizeEmojiSetInput>
      slug: string
    },
  ): Promise<StoredEmojiSetRecord> {
    const assetValues = sql.join(
      params.normalizedInput.items.map((item, index) => {
        const iconAssetId = item.id ?? generateUuidV7()

        return sql`(
          cast(${iconAssetId} as uuid),
          cast(${item.keywords} as text[]),
          cast(${item.kind} as app.emoji_asset_kind),
          ${item.label},
          ${item.shortcode},
          cast(${index} as integer),
          ${item.value}
        )`
      }),
    )
    const aggregate = await this.executePoolerWriteStatement(
      command.context.auth,
      command.context.actorUserId,
      async (executor) => {
        const result = await sql<EmojiSetAggregateRow>`
          with inserted_emoji_set as (
            insert into app.emoji_sets (
              created_by,
              deleted_at,
              description,
              id,
              metadata,
              slug,
              source,
              status,
              title,
              updated_by,
              workspace_id
            )
            values (
              ${command.context.actorUserId},
              null,
              ${params.normalizedInput.description},
              ${params.emojiSetId},
              '{}'::jsonb,
              ${params.slug},
              ${params.normalizedInput.source},
              'active',
              ${params.normalizedInput.title},
              ${command.context.actorUserId},
              ${command.context.workspaceId}
            )
            on conflict (id) do nothing
            returning *
          ),
          selected_emoji_set as (
            select *
            from inserted_emoji_set

            union all

            select emoji_set.*
            from app.emoji_sets as emoji_set
            where emoji_set.id = ${params.emojiSetId}
              and emoji_set.workspace_id = ${command.context.workspaceId}
              and emoji_set.deleted_at is null
              and emoji_set.status = 'active'
              and not exists (select 1 from inserted_emoji_set)
          ),
          input_assets(
            id,
            keywords,
            kind,
            label,
            shortcode,
            sort_order,
            value
          ) as (
            values ${assetValues}
          ),
          inserted_assets as (
            insert into app.emoji_assets (
              created_by,
              deleted_at,
              emoji_set_id,
              id,
              keywords,
              kind,
              label,
              metadata,
              shortcode,
              sort_order,
              updated_by,
              value,
              workspace_id
            )
            select
              ${command.context.actorUserId},
              null,
              selected_emoji_set.id,
              input_assets.id,
              input_assets.keywords,
              input_assets.kind,
              input_assets.label,
              '{}'::jsonb,
              input_assets.shortcode,
              input_assets.sort_order,
              ${command.context.actorUserId},
              input_assets.value,
              selected_emoji_set.workspace_id
            from selected_emoji_set
            cross join input_assets
            where exists (select 1 from inserted_emoji_set)
            returning *
          ),
          asset_rows as (
            select *
            from inserted_assets

            union all

            select asset.*
            from app.emoji_assets as asset
            where asset.workspace_id = ${command.context.workspaceId}
              and asset.emoji_set_id = ${params.emojiSetId}
              and asset.deleted_at is null
              and not exists (select 1 from inserted_emoji_set)
          )
          select
            to_jsonb(selected_emoji_set.*) as emoji_set,
            (
              select coalesce(
                jsonb_agg(
                  to_jsonb(asset_rows.*)
                  order by asset_rows.sort_order asc, asset_rows.label asc
                ),
                '[]'::jsonb
              )
              from asset_rows
            ) as assets
          from selected_emoji_set
        `.execute(executor)

        return result.rows[0]
      },
    )

    if (!aggregate) {
      throw new Error('Failed to create icon set record.')
    }

    return this.mapEmojiSetRecord(aggregate.emoji_set, aggregate.assets)
  }

  private async addItemsWithPoolerWriteFallback(
    command: AddEmojiSetItemsCommand,
  ): Promise<StoredEmojiSetRecord> {
    const inputValues = sql.join(
      command.input.items.map((item, index) => {
        const normalizedItem = normalizeEmojiAssetInput(
          {
            ...item,
            shortcode: undefined,
          },
          index,
        )
        const iconAssetId = item.id ?? generateUuidV7()

        return sql`(
          cast(${iconAssetId} as uuid),
          cast(${normalizedItem.keywords} as text[]),
          cast(${normalizedItem.kind} as app.emoji_asset_kind),
          ${normalizedItem.label},
          cast(${index} as integer),
          ${normalizedItem.value}
        )`
      }),
    )
    const aggregate = await this.executePoolerWriteStatement(
      command.context.auth,
      command.context.actorUserId,
      async (executor) => {
        const result = await sql<EmojiSetAggregateRow>`
          with selected_emoji_set as (
            select *
            from app.emoji_sets
            where id = ${command.emojiSetId}
              and workspace_id = ${command.context.workspaceId}
              and deleted_at is null
              and status = 'active'
          ),
          asset_stats as (
            select
              count(*)::integer as asset_count,
              coalesce(max(sort_order), -1)::integer as max_sort_order
            from app.emoji_assets
            where workspace_id = ${command.context.workspaceId}
              and emoji_set_id = ${command.emojiSetId}
          ),
          input_assets(
            id,
            keywords,
            kind,
            label,
            sort_offset,
            value
          ) as (
            values ${inputValues}
          ),
          inserted_assets as (
            insert into app.emoji_assets (
              created_by,
              deleted_at,
              emoji_set_id,
              id,
              keywords,
              kind,
              label,
              metadata,
              shortcode,
              sort_order,
              updated_by,
              value,
              workspace_id
            )
            select
              ${command.context.actorUserId},
              null,
              selected_emoji_set.id,
              input_assets.id,
              input_assets.keywords,
              input_assets.kind,
              input_assets.label,
              '{}'::jsonb,
              'icon-' || (asset_stats.asset_count + input_assets.sort_offset + 1),
              asset_stats.max_sort_order + 1 + input_assets.sort_offset,
              ${command.context.actorUserId},
              input_assets.value,
              selected_emoji_set.workspace_id
            from selected_emoji_set
            cross join asset_stats
            cross join input_assets
            returning *
          ),
          asset_rows as (
            select asset.*
            from app.emoji_assets as asset
            where asset.workspace_id = ${command.context.workspaceId}
              and asset.emoji_set_id = ${command.emojiSetId}
              and asset.deleted_at is null

            union all

            select *
            from inserted_assets
          )
          select
            to_jsonb(selected_emoji_set.*) as emoji_set,
            (
              select coalesce(
                jsonb_agg(
                  to_jsonb(asset_rows.*)
                  order by asset_rows.sort_order asc, asset_rows.label asc
                ),
                '[]'::jsonb
              )
              from asset_rows
            ) as assets
          from selected_emoji_set
        `.execute(executor)

        return result.rows[0]
      },
    )

    if (!aggregate) {
      throw new EmojiSetNotFoundError(command.emojiSetId)
    }

    return this.mapEmojiSetRecord(aggregate.emoji_set, aggregate.assets)
  }

  async deleteSet(
    command: DeleteEmojiSetCommand,
  ): Promise<StoredEmojiSetRecord> {
    return withOptionalRls(
      this.db,
      command.context.auth,
      async (executor) => {
        const emojiSet = await this.loadActiveEmojiSet(
          executor,
          command.context.workspaceId,
          command.emojiSetId,
        )

        if (!emojiSet) {
          throw new EmojiSetNotFoundError(command.emojiSetId)
        }

        const assetRows = await this.loadEmojiAssetRows(
          executor,
          command.context.workspaceId,
          [emojiSet.id],
        )
        const deletedAt = new Date()

        await executor
          .updateTable('app.emoji_assets')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('workspace_id', '=', command.context.workspaceId)
          .where('emoji_set_id', '=', command.emojiSetId)
          .where('deleted_at', 'is', null)
          .execute()

        const deletedEmojiSet = await executor
          .updateTable('app.emoji_sets')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.emojiSetId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('deleted_at', 'is', null)
          .where('status', '=', 'active')
          .returningAll()
          .executeTakeFirst()

        if (!deletedEmojiSet) {
          throw new EmojiSetNotFoundError(command.emojiSetId)
        }

        return this.mapEmojiSetRecord(deletedEmojiSet, assetRows)
      },
      command.context.actorUserId,
    )
  }

  async deleteItem(
    command: DeleteEmojiSetItemCommand,
  ): Promise<StoredEmojiAssetRecord> {
    return withOptionalRls(
      this.db,
      command.context.auth,
      async (executor) => {
        const emojiSet = await this.loadActiveEmojiSet(
          executor,
          command.context.workspaceId,
          command.emojiSetId,
        )

        if (!emojiSet) {
          throw new EmojiSetNotFoundError(command.emojiSetId)
        }

        const deletedAt = new Date()
        const deletedIconAsset = await executor
          .updateTable('app.emoji_assets')
          .set({
            deleted_at: deletedAt,
            updated_by: command.context.actorUserId,
          })
          .where('id', '=', command.iconAssetId)
          .where('workspace_id', '=', command.context.workspaceId)
          .where('emoji_set_id', '=', command.emojiSetId)
          .where('deleted_at', 'is', null)
          .returningAll()
          .executeTakeFirst()

        if (!deletedIconAsset) {
          throw new EmojiAssetNotFoundError(command.iconAssetId)
        }

        return this.mapEmojiAssetRecord(deletedIconAsset)
      },
      command.context.actorUserId,
    )
  }

  private loadActiveEmojiSet(
    executor: DatabaseExecutor,
    workspaceId: string,
    emojiSetId: string,
  ): Promise<EmojiSetRow | undefined> {
    return executor
      .selectFrom('app.emoji_sets')
      .selectAll()
      .where('id', '=', emojiSetId)
      .where('workspace_id', '=', workspaceId)
      .where('deleted_at', 'is', null)
      .where('status', '=', 'active')
      .executeTakeFirst()
  }

  private async loadEmojiAssetStats(
    executor: DatabaseExecutor,
    workspaceId: string,
    emojiSetId: string,
  ): Promise<{ count: number; maxSortOrder: number }> {
    const row = await executor
      .selectFrom('app.emoji_assets')
      .select([
        (eb) => eb.fn.countAll<string>().as('asset_count'),
        (eb) => eb.fn.max<number>('sort_order').as('max_sort_order'),
      ])
      .where('workspace_id', '=', workspaceId)
      .where('emoji_set_id', '=', emojiSetId)
      .executeTakeFirstOrThrow()

    return {
      count: Number(row.asset_count),
      maxSortOrder:
        row.max_sort_order === null ? -1 : Number(row.max_sort_order),
    }
  }

  private loadEmojiAssetRows(
    executor: DatabaseExecutor,
    workspaceId: string,
    emojiSetIds: string[],
  ): Promise<EmojiAssetRow[]> {
    if (emojiSetIds.length === 0) {
      return Promise.resolve([])
    }

    return executor
      .selectFrom('app.emoji_assets')
      .selectAll()
      .where('workspace_id', '=', workspaceId)
      .where('emoji_set_id', 'in', emojiSetIds)
      .where('deleted_at', 'is', null)
      .orderBy('sort_order', 'asc')
      .orderBy('label', 'asc')
      .execute()
  }

  private mapEmojiSetRows(
    emojiSetRows: EmojiSetRow[],
    assetRows: EmojiAssetRow[],
  ): StoredEmojiSetRecord[] {
    const assetsBySetId = new Map<string, StoredEmojiAssetRecord[]>()

    for (const assetRow of assetRows) {
      const asset = this.mapEmojiAssetRecord(assetRow)
      const assets = assetsBySetId.get(asset.emojiSetId) ?? []

      assets.push(asset)
      assetsBySetId.set(asset.emojiSetId, assets)
    }

    return sortStoredEmojiSets(
      emojiSetRows.map((emojiSetRow) =>
        this.mapEmojiSetRecord(
          emojiSetRow,
          assetsBySetId.get(emojiSetRow.id) ?? [],
        ),
      ),
    )
  }

  private mapEmojiSetRecord(
    emojiSet: EmojiSetRow,
    assetRows: EmojiAssetRow[] | StoredEmojiAssetRecord[],
  ): StoredEmojiSetRecord {
    const items = assetRows.map((asset) =>
      'emoji_set_id' in asset ? this.mapEmojiAssetRecord(asset) : asset,
    )

    return {
      createdAt: serializeTimestamp(emojiSet.created_at),
      deletedAt: serializeNullableTimestamp(emojiSet.deleted_at),
      description: emojiSet.description,
      id: emojiSet.id,
      items,
      source: emojiSet.source,
      status: emojiSet.status,
      title: emojiSet.title,
      updatedAt: serializeTimestamp(emojiSet.updated_at),
      version: Number(emojiSet.version),
      workspaceId: emojiSet.workspace_id,
    }
  }

  private mapEmojiAssetRecord(asset: EmojiAssetRow): StoredEmojiAssetRecord {
    return {
      createdAt: serializeTimestamp(asset.created_at),
      deletedAt: serializeNullableTimestamp(asset.deleted_at),
      emojiSetId: asset.emoji_set_id,
      id: asset.id,
      keywords: asset.keywords,
      kind: asset.kind,
      label: asset.label,
      shortcode: asset.shortcode,
      sortOrder: asset.sort_order,
      updatedAt: serializeTimestamp(asset.updated_at),
      value: asset.value,
      version: Number(asset.version),
      workspaceId: asset.workspace_id,
    }
  }
}

function serializeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : serializeTimestamp(value)
}

function serializeTimestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value)
}
