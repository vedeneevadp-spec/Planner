import type { CleaningTodayResponse } from '@planner/contracts'

import { useCleaningToday } from '@/features/cleaning'
import {
  type ShoppingListItem,
  useShoppingListSummary,
  useUpdateShoppingListItem,
} from '@/features/shopping-list'

export interface CleaningRoutineSummary {
  areaLabel: string
  taskCount: number
}

export interface TodayRoutineSummaryModel {
  cleaningSummary: CleaningRoutineSummary | null
  isShoppingItemPending: boolean
  itemCount: number
  shoppingItems: ShoppingListItem[]
  onCompleteShoppingItem: (itemId: string) => void
}

function buildCleaningRoutineSummary(
  today: CleaningTodayResponse | undefined,
): CleaningRoutineSummary | null {
  const taskCount = today?.summary.dueCount ?? 0

  if (!today || taskCount === 0) {
    return null
  }

  const areaNames = new Set<string>()

  today.items.forEach((item) => {
    const zoneTitle = item.zone?.title.trim()

    if (zoneTitle) {
      areaNames.add(zoneTitle)
    } else {
      areaNames.add('Прочее')
    }
  })

  if (today.generalItems.length > 0) {
    areaNames.add('Прочее')
  }

  return {
    areaLabel: Array.from(areaNames).join(', ') || 'Прочее',
    taskCount,
  }
}

export function useTodayRoutineSummary(
  todayKey: string,
): TodayRoutineSummaryModel {
  const shoppingSummary = useShoppingListSummary()
  const updateShoppingItemMutation = useUpdateShoppingListItem()
  const cleaningTodayQuery = useCleaningToday(todayKey)
  const cleaningSummary = buildCleaningRoutineSummary(cleaningTodayQuery.data)

  return {
    cleaningSummary,
    isShoppingItemPending: updateShoppingItemMutation.isPending,
    itemCount:
      (shoppingSummary.activeItemCount > 0 ? 1 : 0) + (cleaningSummary ? 1 : 0),
    shoppingItems: shoppingSummary.activeItems,
    onCompleteShoppingItem: (itemId) => {
      updateShoppingItemMutation.mutate({
        itemId,
        patch: {
          priority: null,
          status: 'archived',
        },
      })
    },
  }
}
