import { useCleaningSummary } from '@/features/cleaning'
import { useSelfCareDashboard } from '@/features/self-care'
import { useShoppingListSummary } from '@/features/shopping-list'
import type { NavigationRouteDefinition } from '@/shared/config/routes'

import type { SidebarNavigationCounts } from './navigationCounts'
import { SidebarNavigation } from './SidebarNavigation'

export interface SidebarServiceNavigationProps {
  baseCounts: SidebarNavigationCounts
  isCollapsed: boolean
  isSharedWorkspace: boolean
  items: NavigationRouteDefinition[]
  todayKey: string
}

export function SidebarServiceNavigation({
  baseCounts,
  isCollapsed,
  isSharedWorkspace,
  items,
  todayKey,
}: SidebarServiceNavigationProps) {
  const cleaningSummary = useCleaningSummary()
  const shoppingListSummary = useShoppingListSummary()
  const selfCareDashboardQuery = useSelfCareDashboard(todayKey, {
    enabled: !isSharedWorkspace,
  })

  return (
    <SidebarNavigation
      counts={{
        ...baseCounts,
        cleaningDueCount: cleaningSummary.dueCount,
        cleaningUrgentCount: cleaningSummary.urgentCount,
        pendingSelfCareTodayCount: countPendingSelfCare(
          selfCareDashboardQuery.data,
        ),
        shoppingActiveItemCount: shoppingListSummary.activeItemCount,
      }}
      isCollapsed={isCollapsed}
      items={items}
    />
  )
}

function countPendingSelfCare(
  dashboard: ReturnType<typeof useSelfCareDashboard>['data'] | undefined,
): number {
  const todayItems = dashboard?.todayItems ?? []
  const flexibleGoals = dashboard?.flexibleGoals ?? []
  const pendingTodayItems = todayItems.filter((entry) => {
    const status = entry.occurrence?.status

    return (
      status !== 'done' &&
      status !== 'partial' &&
      status !== 'skipped' &&
      status !== 'cancelled' &&
      !entry.completion
    )
  }).length
  const pendingFlexibleGoals = flexibleGoals.filter(
    (entry) => (entry.flexibleProgress?.remainingCount ?? 0) > 0,
  ).length

  return pendingTodayItems + pendingFlexibleGoals
}
