import { useEffect, useRef } from 'react'

import { cx } from '@/shared/lib/classnames'

import { SELF_CARE_TABS, type SelfCareTab } from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'

interface SelfCarePageTabsProps {
  activeTab: SelfCareTab
  onSelectTab: (tab: SelfCareTab) => void
}

export function SelfCarePageTabs({
  activeTab,
  onSelectTab,
}: SelfCarePageTabsProps) {
  const tabsRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const activeTabButton = tabsRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    )

    activeTabButton?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTab])

  return (
    <nav
      ref={tabsRef}
      className={styles.tabs}
      aria-label="Разделы заботы о себе"
    >
      {SELF_CARE_TABS.map((tab) => (
        <button
          key={tab.id}
          className={cx(
            styles.tabButton,
            activeTab === tab.id && styles.tabButtonActive,
          )}
          type="button"
          aria-current={activeTab === tab.id ? 'page' : undefined}
          onClick={() => onSelectTab(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  )
}
