import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, type Selectable } from 'kysely'

import {
  type DatabaseExecutor,
  withOptionalRls,
  withWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import { EmojiSetNotFoundError } from './emoji-set.errors.js'
import type {
  CreateEmojiSetCommand,
  EmojiSetReadContext,
  StoredEmojiAssetRecord,
  StoredEmojiSetRecord,
} from './emoji-set.model.js'
import type { EmojiSetRepository } from './emoji-set.repository.js'
import {
  buildEmojiSetSlug,
  normalizeEmojiSetInput,
  sortStoredEmojiSets,
} from './emoji-set.shared.js'

type EmojiSetRow = Selectable<DatabaseSchema['app.emoji_sets']>
type EmojiAssetRow = Selectable<DatabaseSchema['app.emoji_assets']>

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
          throw new Error('Failed to create emoji set record.')
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
