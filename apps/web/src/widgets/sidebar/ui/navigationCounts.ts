export interface SidebarNavigationCounts {
  appRoleLabel: string
  cleaningDueCount: number
  cleaningUrgentCount: number
  pendingSelfCareTodayCount: number
  plannedTaskCount: number
  shoppingActiveItemCount: number
  sphereCount: number
  summary: {
    focusCount: number
    overdueCount: number
    timelineCount: number
  }
}

export function getNavigationCount(
  route: string,
  counts: SidebarNavigationCounts,
): number | string {
  if (route === '/today') {
    return counts.summary.focusCount + counts.summary.overdueCount
  }

  if (route === '/calendar') {
    return counts.plannedTaskCount
  }

  if (route === '/cleaning') {
    return counts.cleaningUrgentCount || counts.cleaningDueCount
  }

  if (route === '/self-care') {
    return counts.pendingSelfCareTodayCount
  }

  if (route === '/shopping') {
    return counts.shoppingActiveItemCount
  }

  if (route === '/spheres') {
    return counts.sphereCount
  }

  return counts.appRoleLabel
}
