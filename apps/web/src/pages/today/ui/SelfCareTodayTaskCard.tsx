import type { SelfCareTodayItem } from '@planner/contracts'

import {
  canRenderIconValue,
  IconMark,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import { formatSelfCareTaskMeta } from '../lib/today-self-care'
import { TodayRoutineLinkCard } from './TodayRoutineCard'

interface SelfCareTodayTaskCardProps {
  ariaLabel?: string
  entry: SelfCareTodayItem
  meta?: string
  plannerTimeZone: string
  uploadedIcons: UploadedIconAsset[]
  variant: 'card' | 'compact'
}

export function SelfCareTodayTaskCard({
  ariaLabel,
  entry,
  meta,
  plannerTimeZone,
  uploadedIcons,
  variant,
}: SelfCareTodayTaskCardProps) {
  const icon = entry.item.icon

  return (
    <TodayRoutineLinkCard
      ariaLabel={ariaLabel ?? `Открыть заботу: ${entry.item.title}`}
      icon={
        canRenderIconValue(icon, uploadedIcons) ? (
          <IconMark value={icon} uploadedIcons={uploadedIcons} />
        ) : (
          '✓'
        )
      }
      meta={meta ?? formatSelfCareTaskMeta(entry, plannerTimeZone)}
      title={entry.item.title}
      to="/self-care"
      variant={variant}
    />
  )
}
