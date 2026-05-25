import { NavLink } from 'react-router-dom'

import type { NavigationRouteDefinition } from '@/shared/config/routes'
import { cx } from '@/shared/lib/classnames'

import {
  getNavigationCount,
  type SidebarNavigationCounts,
} from './navigationCounts'
import styles from './Sidebar.module.css'
import { SidebarNavIcon } from './SidebarIcons'

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
        const count = getNavigationCount(item.to, counts)

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
