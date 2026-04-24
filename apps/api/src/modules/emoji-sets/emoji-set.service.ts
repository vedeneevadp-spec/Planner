import {
  type AddEmojiSetItemsInput,
  generateUuidV7,
  type NewEmojiSetInput,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  AddEmojiSetItemsCommand,
  CreateEmojiSetCommand,
  EmojiSetReadContext,
  EmojiSetWriteContext,
  StoredEmojiAssetRecord,
} from './emoji-set.model.js'
import type { EmojiSetRepository } from './emoji-set.repository.js'
import {
  normalizeEmojiAssetInput,
  normalizeEmojiSetInput,
} from './emoji-set.shared.js'
import {
  type IconAssetStorage,
  MAX_ICON_ASSET_BYTES,
  parseUploadedIconDataUrl,
} from './icon-asset.storage.js'

export class EmojiSetService {
  constructor(
    private readonly repository: EmojiSetRepository,
    private readonly iconAssetStorage?: IconAssetStorage,
  ) {}

  listEmojiSets(context: EmojiSetReadContext) {
    return withRepositoryErrorMapping(() =>
      this.repository.listByWorkspace(context),
    )
  }

  getEmojiSet(context: EmojiSetReadContext, emojiSetId: string) {
    return withRepositoryErrorMapping(() =>
      this.repository.getById(context, emojiSetId),
    )
  }

  async createEmojiSet(
    context: EmojiSetWriteContext,
    input: CreateEmojiSetCommand['input'],
  ) {
    assertCanManageEmojiSets(context)
    assertValidEmojiSetInput(input)

    const preparedInput = await this.prepareIconAssetValues(context, input)

    return withRepositoryErrorMapping(() =>
      this.repository.create({
        context,
        input: preparedInput,
      }),
    )
  }

  async addEmojiSetItems(
    context: EmojiSetWriteContext,
    emojiSetId: string,
    input: AddEmojiSetItemsCommand['input'],
  ) {
    assertCanManageEmojiSets(context)
    assertValidEmojiSetItemsInput(input)

    const preparedInput = await this.prepareAddedIconAssetValues(
      context,
      emojiSetId,
      input,
    )

    return withRepositoryErrorMapping(() =>
      this.repository.addItems({
        context,
        emojiSetId,
        input: preparedInput,
      }),
    )
  }

  async deleteEmojiSet(
    context: EmojiSetWriteContext,
    emojiSetId: string,
  ): Promise<void> {
    assertCanManageEmojiSets(context)

    const deletedEmojiSet = await withRepositoryErrorMapping(() =>
      this.repository.deleteSet({
        context,
        emojiSetId,
      }),
    )

    await this.deleteStoredIconAssets(deletedEmojiSet.items)
  }

  async deleteEmojiSetItem(
    context: EmojiSetWriteContext,
    emojiSetId: string,
    iconAssetId: string,
  ): Promise<void> {
    assertCanManageEmojiSets(context)

    const deletedIconAsset = await withRepositoryErrorMapping(() =>
      this.repository.deleteItem({
        context,
        emojiSetId,
        iconAssetId,
      }),
    )

    await this.deleteStoredIconAssets([deletedIconAsset])
  }

  private async prepareIconAssetValues(
    context: EmojiSetWriteContext,
    input: CreateEmojiSetCommand['input'],
  ): Promise<NewEmojiSetInput> {
    const iconAssetStorage = this.iconAssetStorage

    if (!iconAssetStorage) {
      return input
    }

    const normalizedInput = normalizeEmojiSetInput(input)
    const emojiSetId = normalizedInput.id ?? generateUuidV7()
    const items = await Promise.all(
      normalizedInput.items.map(async (item, index) => {
        const iconAssetId = item.id ?? generateUuidV7()
        const value = await iconAssetStorage.storeIconAsset({
          dataUrl: item.value,
          iconAssetId,
          iconSetId: emojiSetId,
          sortOrder: index,
          workspaceId: context.workspaceId,
        })

        return {
          ...item,
          id: iconAssetId,
          value,
        }
      }),
    )

    return {
      ...normalizedInput,
      id: emojiSetId,
      items,
    }
  }

  private async prepareAddedIconAssetValues(
    context: EmojiSetWriteContext,
    emojiSetId: string,
    input: AddEmojiSetItemsInput,
  ): Promise<AddEmojiSetItemsInput> {
    const iconAssetStorage = this.iconAssetStorage

    if (!iconAssetStorage) {
      return input
    }

    const items = await Promise.all(
      input.items.map(async (item, index) => {
        const iconAssetId = item.id ?? generateUuidV7()
        const value = await iconAssetStorage.storeIconAsset({
          dataUrl: item.value,
          iconAssetId,
          iconSetId: emojiSetId,
          sortOrder: index,
          workspaceId: context.workspaceId,
        })

        return {
          ...item,
          id: iconAssetId,
          shortcode: undefined,
          value,
        }
      }),
    )

    return {
      items,
    }
  }

  private async deleteStoredIconAssets(
    items: Array<Pick<StoredEmojiAssetRecord, 'value'>>,
  ): Promise<void> {
    const iconAssetStorage = this.iconAssetStorage

    if (!iconAssetStorage) {
      return
    }

    await Promise.all(
      items.map(async (item) => {
        try {
          await iconAssetStorage.deleteIconAsset(item.value)
        } catch {
          // The database deletion already succeeded; a stale local file should
          // not make the admin action fail or resurrect a broken record.
        }
      }),
    )
  }
}

async function withRepositoryErrorMapping<T>(
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof HttpError) {
      throw error
    }

    if (isTransientDatabaseError(error)) {
      throw new HttpError(
        503,
        'database_unavailable',
        'Database request timed out. Please retry the action.',
      )
    }

    if (isUniqueConstraintError(error)) {
      throw new HttpError(
        409,
        'icon_set_conflict',
        'Icon set or icon item already exists.',
      )
    }

    throw error
  }
}

function isTransientDatabaseError(error: unknown): boolean {
  const code = getErrorCode(error)
  const message = error instanceof Error ? error.message : ''

  return (
    code === 'ETIMEDOUT' ||
    code === 'ECONNRESET' ||
    code === '57014' ||
    message.includes('Query read timeout') ||
    message.includes('read ETIMEDOUT')
  )
}

function isUniqueConstraintError(error: unknown): boolean {
  return getErrorCode(error) === '23505'
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const code = error.code

  return typeof code === 'string' ? code : undefined
}

function assertCanManageEmojiSets(context: EmojiSetWriteContext): void {
  if (context.appRole && !['admin', 'owner'].includes(context.appRole)) {
    throw new HttpError(
      403,
      'app_admin_required',
      'The current application role cannot manage icon sets.',
    )
  }
}

function assertValidEmojiSetInput(input: CreateEmojiSetCommand['input']): void {
  const normalizedInput = normalizeEmojiSetInput(input)

  if (!normalizedInput.title) {
    throw new HttpError(
      400,
      'invalid_body',
      'Icon set title must not be empty.',
    )
  }

  assertValidNormalizedIconItems(normalizedInput.items)
}

function assertValidEmojiSetItemsInput(input: AddEmojiSetItemsInput): void {
  assertValidNormalizedIconItems(
    input.items.map((item, index) =>
      normalizeEmojiAssetInput(
        {
          ...item,
          shortcode: undefined,
        },
        index,
      ),
    ),
  )
}

function assertValidNormalizedIconItems(
  items: ReturnType<typeof normalizeEmojiSetInput>['items'],
): void {
  const seenShortcodes = new Set<string>()
  const duplicateShortcodes = new Set<string>()

  for (const item of items) {
    if (!item.label || !item.value || !item.shortcode) {
      throw new HttpError(
        400,
        'invalid_body',
        'Icon items require label and uploaded image.',
      )
    }

    if (!parseUploadedIconDataUrl(item.value)) {
      throw new HttpError(
        400,
        'invalid_icon_upload',
        `Icon value must be an uploaded image data URL up to ${formatBytes(
          MAX_ICON_ASSET_BYTES,
        )}.`,
      )
    }

    if (seenShortcodes.has(item.shortcode)) {
      duplicateShortcodes.add(item.shortcode)
    }

    seenShortcodes.add(item.shortcode)
  }

  if (duplicateShortcodes.size > 0) {
    throw new HttpError(
      400,
      'duplicate_icon_codes',
      'Icon item codes must be unique inside a set.',
      {
        shortcodes: [...duplicateShortcodes],
      },
    )
  }
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024) {
    return `${Math.round(value / (1024 * 1024))} MB`
  }

  return `${Math.round(value / 1024)} KB`
}
