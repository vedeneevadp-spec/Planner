import type { SelfCareTodayItem } from '@planner/contracts'
import { Link } from 'react-router'

import { IconMark, type UploadedIconAsset } from '@/shared/ui/Icon'

import { formatSelfCareTaskMeta } from '../lib/today-self-care'
import styles from './SelfCareTodayTaskCard.module.css'

interface SelfCareTodayTaskCardProps {
  entry: SelfCareTodayItem
  plannerTimeZone: string
  uploadedIcons: UploadedIconAsset[]
  variant: 'card' | 'compact'
}

export function SelfCareTodayTaskCard({
  entry,
  plannerTimeZone,
  uploadedIcons,
  variant,
}: SelfCareTodayTaskCardProps) {
  const icon = entry.item.icon?.trim()

  return (
    <Link
      className={`${styles.selfCareTaskCard} ${
        variant === 'compact' ? styles.selfCareTaskCardCompact : ''
      }`}
      to="/self-care"
      aria-label={`Открыть заботу: ${entry.item.title}`}
    >
      <span className={styles.selfCareTaskIcon} aria-hidden="true">
        {icon ? (
          <IconMark
            className={styles.selfCareTaskIconMark}
            value={icon}
            uploadedIcons={uploadedIcons}
          />
        ) : (
          '✓'
        )}
      </span>
      <span className={styles.selfCareTaskBody}>
        <span className={styles.selfCareTaskTitle}>{entry.item.title}</span>
        <span className={styles.selfCareTaskMeta}>
          {formatSelfCareTaskMeta(entry, plannerTimeZone)}
        </span>
      </span>
    </Link>
  )
}
