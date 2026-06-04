import type {
  ChaosInboxItemRecord,
  VoiceActionShoppingItem,
} from '@planner/contracts'

import {
  formatShoppingListText,
  isActiveShoppingListTextItem,
} from './shopping-list-text'
import { plural } from './voice-action-formatting'

export function isActiveShoppingRecord(item: ChaosInboxItemRecord): boolean {
  return (
    item.kind === 'shopping' &&
    item.deletedAt === null &&
    isActiveShoppingListTextItem(item)
  )
}

export function compareShoppingRecords(
  left: ChaosInboxItemRecord,
  right: ChaosInboxItemRecord,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt.localeCompare(right.createdAt)
  }

  return left.text.localeCompare(right.text, 'ru')
}

export function toVoiceActionShoppingItem(
  item: ChaosInboxItemRecord,
): VoiceActionShoppingItem {
  return {
    shoppingItemId: item.id,
    title: formatShoppingListText(item.text),
  }
}

export function buildShoppingListSummary(
  shoppingItems: VoiceActionShoppingItem[],
): string {
  if (shoppingItems.length === 0) {
    return 'В списке покупок сейчас пусто.'
  }

  const visibleTitles = shoppingItems
    .slice(0, 5)
    .map((item) => item.title)
    .join(', ')
  const hiddenCount = shoppingItems.length - 5
  const hiddenSuffix =
    hiddenCount > 0
      ? ` и еще ${hiddenCount} ${plural(hiddenCount, 'позиция', 'позиции', 'позиций')}`
      : ''

  return `Нужно купить: ${visibleTitles}${hiddenSuffix}.`
}

export function isShoppingRecord(
  value: unknown,
): value is ChaosInboxItemRecord {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { id?: unknown }).id === 'string' &&
    typeof (value as { text?: unknown }).text === 'string' &&
    typeof (value as { status?: unknown }).status === 'string'
  )
}

export function replaceShoppingRecord(
  items: ChaosInboxItemRecord[],
  nextItem: ChaosInboxItemRecord,
): void {
  const existingIndex = items.findIndex((item) => item.id === nextItem.id)

  if (existingIndex === -1) {
    items.unshift(nextItem)
    return
  }

  items[existingIndex] = nextItem
}

export function buildShoppingMutationStatus(input: {
  createdItemTitles: string[]
  duplicateItemTitles: string[]
  reactivatedItemTitles: string[]
}): string {
  const parts: string[] = []

  if (input.createdItemTitles.length > 0) {
    parts.push(`Добавлено: ${formatInlineList(input.createdItemTitles)}.`)
  }

  if (input.reactivatedItemTitles.length > 0) {
    parts.push(
      `Вернула в список: ${formatInlineList(input.reactivatedItemTitles)}.`,
    )
  }

  if (input.duplicateItemTitles.length > 0) {
    parts.push(`Уже есть: ${formatInlineList(input.duplicateItemTitles)}.`)
  }

  return parts.length > 0 ? parts.join(' ') : 'Такая покупка уже есть.'
}

function formatInlineList(items: string[]): string {
  return items.join(', ')
}
