import { NavLink } from 'react-router-dom'

import type { NavigationRouteDefinition } from '@/shared/config/routes'
import { cx } from '@/shared/lib/classnames'

import styles from './Sidebar.module.css'
import { SidebarNavIcon } from './SidebarIcons'

interface SidebarNavigationCounts {
  appRoleLabel: string
  cleaningDueCount: number
  cleaningUrgentCount: number
  pendingHabitTodayCount: number
  plannedTaskCount: number
  shoppingActiveItemCount: number
  sphereCount: number
  summary: {
    focusCount: number
    overdueCount: number
    timelineCount: number
  }
}

interface SidebarNavigationProps {
  counts: SidebarNavigationCounts
  isCollapsed: boolean
  items: NavigationRouteDefinition[]
}

export function SidebarNavigation({
  counts,
  isCollapsed,
  items,
}: SidebarNavigationProps) {
  return (
    <nav aria-label="Main navigation" className={styles.navList}>
      {items.map((item) => {
        const count = getSidebarNavigationCount(item.to, counts)

        return (
          <NavLink
            key={item.to}
            to={item.to}
            title={isCollapsed ? item.label : undefined}
            className={({ isActive }) =>
              cx(styles.navItem, isActive && styles.navItemActive)
            }
          >
            <span className={styles.navIcon} aria-hidden="true">
              <SidebarNavIcon route={item.to} />
            </span>
            <span className={styles.navLabel}>{item.label}</span>
            <strong className={styles.navCount}>{count}</strong>
          </NavLink>
        )
      })}
    </nav>
  )
}

function getSidebarNavigationCount(
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

  if (route === '/habits') {
    return counts.pendingHabitTodayCount
  }

  if (route === '/shopping') {
    return counts.shoppingActiveItemCount
  }

  if (route === '/timeline') {
    return counts.summary.timelineCount
  }

  if (route === '/spheres') {
    return counts.sphereCount
  }

  return counts.appRoleLabel
}
