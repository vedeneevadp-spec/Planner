import type { SelfCareTodayItem } from '@planner/contracts'

import {
  canRenderIconValue,
  HeartIcon,
  IconMark,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

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
  const icon = entry.item.icon

  return (
    <TodayRoutineLinkCard
      ariaLabel={`Открыть заботу: ${entry.item.title}`}
      icon={
        canRenderIconValue(icon, uploadedIcons) ? (
          <IconMark value={icon} uploadedIcons={uploadedIcons} />
        ) : (
          // A check mark here read as "already done"; the heart just marks care.
          <HeartIcon size={18} />
        )
      }
      meta={formatSelfCareTaskMeta(entry, plannerTimeZone)}
      title={entry.item.title}
      to="/self-care"
      variant={variant}
    />
  )
}
