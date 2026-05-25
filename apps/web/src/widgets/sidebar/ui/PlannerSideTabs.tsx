import { Link, useLocation } from 'react-router-dom'

import type {
  NavigationRouteDefinition,
  PlannerTabColor,
} from '@/shared/config/routes'
import { cx } from '@/shared/lib/classnames'
import { GearIcon } from '@/shared/ui/Icon'

import styles from './PlannerTabs.module.css'
import { MoreIcon, SidebarNavIcon } from './SidebarIcons'

interface PlannerSideTabsProps {
  isMoreActive: boolean
  items: NavigationRouteDefinition[]
}

export function PlannerSideTabs({ isMoreActive, items }: PlannerSideTabsProps) {
  const location = useLocation()
  const sideItems = items
    .filter((item) => item.plannerTabPlacement === 'side')
    .sort(
      (left, right) =>
        (left.plannerTabOrder ?? 0) - (right.plannerTabOrder ?? 0),
    )
  const isMorePageActive = matchesRoute(location.pathname, '/more')
  const isProfileActive = matchesRoute(location.pathname, '/profile')
  const isMoreTabActive = isMoreActive || isMorePageActive || isProfileActive
  const shouldShowCleaningSettingsTab = location.pathname === '/cleaning'

  return (
    <nav aria-label="Разделы планера" className={styles.sideTabs}>
      {sideItems.map((item) => {
        const isActive = matchesRoute(location.pathname, item.to)

        return (
          <Link
            key={item.to}
            aria-current={isActive ? 'page' : undefined}
            aria-label={item.label}
            className={cx(styles.sideTab, isActive && styles.sideTabActive)}
            data-color={item.plannerTabColor ?? 'gray'}
            title={item.label}
            to={item.to}
          >
            <span className={styles.sideTabIcon} aria-hidden="true">
              <SidebarNavIcon route={item.to} />
            </span>
            <span className={styles.visuallyHidden}>
              {item.plannerTabShortLabel ?? item.label}
            </span>
          </Link>
        )
      })}

      <Link
        aria-current={isMoreTabActive ? 'page' : undefined}
        aria-label="Ещё"
        className={cx(
          styles.sideTab,
          styles.sideMoreDesktopTab,
          isMoreTabActive && styles.sideTabActive,
        )}
        data-color={'gray' satisfies PlannerTabColor}
        title="Ещё"
        to="/more"
      >
        <span className={styles.sideTabIcon} aria-hidden="true">
          <MoreIcon />
        </span>
        <span className={styles.visuallyHidden}>Ещё</span>
      </Link>

      <Link
        aria-current={isMoreTabActive ? 'page' : undefined}
        aria-label="Ещё"
        className={cx(
          styles.sideTab,
          styles.sideMoreMobileTab,
          isMoreTabActive && styles.sideTabActive,
        )}
        data-color={'gray' satisfies PlannerTabColor}
        title="Ещё"
        to="/more"
      >
        <span className={styles.sideTabIcon} aria-hidden="true">
          <MoreIcon />
        </span>
        <span className={styles.visuallyHidden}>Ещё</span>
      </Link>

      {shouldShowCleaningSettingsTab ? (
        <Link
          aria-label="Настройки зон"
          className={cx(styles.sideTab, styles.sideCleaningSettingsTab)}
          data-color={'gray' satisfies PlannerTabColor}
          title="Настройки зон"
          to="/cleaning/settings"
        >
          <span className={styles.sideTabIcon} aria-hidden="true">
            <GearIcon size={20} strokeWidth={1.9} />
          </span>
          <span className={styles.visuallyHidden}>Настройки зон</span>
        </Link>
      ) : null}
    </nav>
  )
}

function matchesRoute(pathname: string, route: string): boolean {
  return pathname === route || pathname.startsWith(`${route}/`)
}
