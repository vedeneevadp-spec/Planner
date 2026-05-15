import type { ChaosInboxItemRecord } from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import { sortCompletedShoppingListItems } from './useShoppingList'

const BASE_ITEM = {
  convertedNoteId: null,
  convertedTaskId: null,
  deletedAt: null,
  dueDate: null,
  isFavorite: false,
  kind: 'shopping',
  linkedTaskDeleted: false,
  priority: null,
  shoppingCategory: 'other',
  source: 'manual',
  sphereId: null,
  status: 'archived',
  userId: 'user-1',
  version: 1,
  workspaceId: 'workspace-1',
} satisfies Omit<
  ChaosInboxItemRecord,
  'createdAt' | 'id' | 'text' | 'updatedAt'
>

describe('shopping list sorting', () => {
  it('keeps completed items stable when a mark update changes updatedAt', () => {
    const firstItem = createCompletedItem({
      createdAt: '2026-05-01T10:00:00.000Z',
      id: 'item-1',
      text: 'Молоко',
      updatedAt: '2026-05-15T12:00:00.000Z',
    })
    const secondItem = createCompletedItem({
      createdAt: '2026-05-02T10:00:00.000Z',
      id: 'item-2',
      isFavorite: true,
      text: 'Гречка',
      updatedAt: '2026-05-16T12:00:00.000Z',
    })

    expect(sortCompletedShoppingListItems([secondItem, firstItem])).toEqual([
      firstItem,
      secondItem,
    ])
  })
})

function createCompletedItem(
  item: Pick<ChaosInboxItemRecord, 'createdAt' | 'id' | 'text' | 'updatedAt'> &
    Partial<ChaosInboxItemRecord>,
): ChaosInboxItemRecord {
  return {
    ...BASE_ITEM,
    ...item,
  }
}
