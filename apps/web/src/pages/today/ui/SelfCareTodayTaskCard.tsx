import type { SelfCareTodayItem } from '@planner/contracts'

import { IconMark, type UploadedIconAsset } from '@/shared/ui/Icon'

import { formatSelfCareTaskMeta } from '../lib/today-self-care'
import { TodayRoutineLinkCard } from './TodayRoutineCard'

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
    <TodayRoutineLinkCard
      ariaLabel={`Открыть заботу: ${entry.item.title}`}
      icon={
        icon ? <IconMark value={icon} uploadedIcons={uploadedIcons} /> : '✓'
      }
      meta={formatSelfCareTaskMeta(entry, plannerTimeZone)}
      title={entry.item.title}
      to="/self-care"
      variant={variant}
    />
  )
}
