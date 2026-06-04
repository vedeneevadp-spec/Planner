import type {
  ChaosInboxItemRecord,
  PlannerIntent,
  VoiceActionContext,
  VoiceActionPreview,
  VoiceActionResult,
  VoiceActionUndo,
} from '@planner/contracts'

import { sanitizeVoicePreviewForLockScreen } from './locked-screen-scrubber'
import type { PlannerActionExecutorDependencies } from './planner-action-executor'
import { getShoppingItemText } from './planner-intent-execution'
import {
  findShoppingListItemByText,
  formatShoppingListText,
  isActiveShoppingListTextItem,
} from './shopping-list-text'
import {
  createPreview,
  createResult,
  getRecordId,
} from './voice-action-factory'
import {
  buildShoppingListSummary,
  buildShoppingMutationStatus,
  compareShoppingRecords,
  isActiveShoppingRecord,
  isShoppingRecord,
  replaceShoppingRecord,
  toVoiceActionShoppingItem,
} from './voice-action-shopping'

export function formatShoppingItems(intent: PlannerIntent): string {
  return (intent.items ?? []).map(getShoppingItemText).join(', ')
}

export async function prepareShoppingListAction(
  intent: PlannerIntent,
  context: VoiceActionContext,
  dependencies: PlannerActionExecutorDependencies,
): Promise<VoiceActionPreview> {
  if (context.isDeviceLocked || intent.requiresUnlock) {
    return sanitizeVoicePreviewForLockScreen(
      createPreview(intent, {
        canExecute: false,
        context,
        needsConfirmation: false,
        reason: 'requires_unlock',
        requiresUnlock: true,
        status: 'requires_unlock',
        summary: 'Разблокируй устройство, чтобы посмотреть список покупок.',
        title: 'Нужна разблокировка',
      }),
    )
  }

  const shoppingListResult = await loadShoppingListItems(dependencies)

  if (!shoppingListResult.ok) {
    return createPreview(intent, {
      canExecute: false,
      context,
      isOffline: true,
      needsConfirmation: false,
      reason: shoppingListResult.reason,
      status: 'blocked',
      summary: shoppingListResult.reason,
      title: 'Список покупок недоступен',
    })
  }

  const shoppingItems = shoppingListResult.items
    .filter(isActiveShoppingRecord)
    .sort(compareShoppingRecords)
    .map(toVoiceActionShoppingItem)

  return createPreview(intent, {
    canExecute: false,
    context,
    needsConfirmation: false,
    shoppingItems,
    summary: buildShoppingListSummary(shoppingItems),
    title: 'Список покупок',
  })
}

export async function executeShoppingAction(
  preview: VoiceActionPreview,
  dependencies: PlannerActionExecutorDependencies,
): Promise<VoiceActionResult> {
  const createdShoppingItemIds: string[] = []
  const createdItemTitles: string[] = []
  const duplicateItemTitles: string[] = []
  const reactivatedItemTitles: string[] = []

  try {
    const shoppingItems = await loadShoppingItemsForMutation(dependencies)

    for (const item of preview.intent.items ?? []) {
      const itemText = formatShoppingListText(getShoppingItemText(item))
      const existingItem = findShoppingListItemByText(shoppingItems, itemText)

      if (existingItem && isActiveShoppingListTextItem(existingItem)) {
        duplicateItemTitles.push(formatShoppingListText(existingItem.text))
        continue
      }

      if (existingItem) {
        if (!dependencies.updateShoppingItem) {
          return createResult({
            errorCode: 'shopping_update_unavailable',
            status: 'failed',
            visualStatus: 'Не удалось вернуть покупку в список.',
          })
        }

        const updatedItem = await dependencies.updateShoppingItem(
          existingItem.id,
          { status: 'new' },
        )
        const updatedRecord = isShoppingRecord(updatedItem)
          ? updatedItem
          : { ...existingItem, status: 'new' as const }

        replaceShoppingRecord(shoppingItems, updatedRecord)
        reactivatedItemTitles.push(formatShoppingListText(existingItem.text))
        continue
      }

      const createdItem = await dependencies.createShoppingItem({
        isFavorite: false,
        priority: null,
        shoppingCategory: 'other',
        text: itemText,
      })
      const itemId = getRecordId(createdItem)

      if (itemId) {
        createdShoppingItemIds.push(itemId)
      }

      createdItemTitles.push(itemText)

      if (isShoppingRecord(createdItem)) {
        shoppingItems.unshift(createdItem)
      }
    }

    const hasChangedData =
      createdItemTitles.length > 0 || reactivatedItemTitles.length > 0
    const canUndo =
      reactivatedItemTitles.length === 0 &&
      duplicateItemTitles.length === 0 &&
      createdShoppingItemIds.length > 0

    return createResult({
      changedData: hasChangedData || undefined,
      createdShoppingItemIds:
        createdShoppingItemIds.length > 0 ? createdShoppingItemIds : undefined,
      status: 'success',
      undo: canUndo
        ? {
            createdShoppingItemIds,
            type: 'add_shopping_item',
          }
        : undefined,
      visualStatus: buildShoppingMutationStatus({
        createdItemTitles,
        duplicateItemTitles,
        reactivatedItemTitles,
      }),
    })
  } catch {
    return createResult({
      errorCode: 'shopping_create_failed',
      status: 'failed',
      visualStatus: 'Не удалось добавить в покупки.',
    })
  }
}

export async function undoShoppingAction(
  undo: Extract<VoiceActionUndo, { type: 'add_shopping_item' }>,
  dependencies: PlannerActionExecutorDependencies,
): Promise<VoiceActionResult> {
  if (!dependencies.removeShoppingItem) {
    return createResult({
      errorCode: 'voice_action_undo_unavailable',
      status: 'failed',
      visualStatus: 'Отмена покупок сейчас недоступна.',
    })
  }

  try {
    for (const itemId of undo.createdShoppingItemIds) {
      const result = await dependencies.removeShoppingItem(itemId)

      if (result === false) {
        return createResult({
          errorCode: 'shopping_undo_failed',
          status: 'failed',
          visualStatus: 'Не удалось отменить добавление в покупки.',
        })
      }
    }

    return createResult({
      changedData: true,
      status: 'success',
      visualStatus: 'Добавление в покупки отменено.',
    })
  } catch {
    return createResult({
      errorCode: 'shopping_undo_failed',
      status: 'failed',
      visualStatus: 'Не удалось отменить добавление в покупки.',
    })
  }
}

async function loadShoppingListItems(
  dependencies: PlannerActionExecutorDependencies,
): Promise<
  { items: ChaosInboxItemRecord[]; ok: true } | { ok: false; reason: string }
> {
  if (!dependencies.listShoppingItems) {
    return {
      ok: false,
      reason: 'Список покупок сейчас недоступен.',
    }
  }

  try {
    const items = await dependencies.listShoppingItems()

    return { items, ok: true }
  } catch {
    return {
      ok: false,
      reason: 'Не удалось загрузить список покупок.',
    }
  }
}

async function loadShoppingItemsForMutation(
  dependencies: PlannerActionExecutorDependencies,
): Promise<ChaosInboxItemRecord[]> {
  if (!dependencies.listShoppingItems) {
    return []
  }

  return [...(await dependencies.listShoppingItems())]
}
