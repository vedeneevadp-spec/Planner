import type { ChaosInboxItemRecord } from '@planner/contracts'

export type ShoppingListItem = ChaosInboxItemRecord

export function isShoppingListItemCompleted(item: ShoppingListItem): boolean {
  return item.status === 'archived'
}

export function sortActiveShoppingListItems(
  items: ShoppingListItem[],
): ShoppingListItem[] {
  return [...items]
    .filter((item) => !isShoppingListItemCompleted(item))
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.text.localeCompare(right.text)
        : left.createdAt.localeCompare(right.createdAt),
    )
}

export function sortCompletedShoppingListItems(
  items: ShoppingListItem[],
): ShoppingListItem[] {
  return [...items]
    .filter((item) => isShoppingListItemCompleted(item))
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.text.localeCompare(right.text)
        : left.createdAt.localeCompare(right.createdAt),
    )
}
