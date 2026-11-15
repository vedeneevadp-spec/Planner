import type { SelfCareTodayItem } from '@planner/contracts'
import { useMemo } from 'react'

import type { useSelfCareHistory, useSelfCarePlan } from '@/features/self-care'
import { type UploadedIconAsset } from '@/shared/ui/Icon'
import { PageStateView } from '@/shared/ui/PageState'

import { PlanningHintCard, SelfCareItemCard } from './SelfCarePage.components'
import styles from './SelfCarePage.module.css'
import {
  getLatestProgressCompletionByItemId,
  getNextPlannedDateByItemId,
  getPlanOccurrenceEntries,
  mergeLatestProgressCompletion,
} from './SelfCarePage.schedule'
import { SelfCareSection } from './SelfCarePage.sections'

export function SelfCarePlanTab({
  canAddCare,
  hiddenScheduledItemIds,
  history,
  isBusy,
  isAddingCare,
  onCardAction,
  onArchiveItem,
  onAddCare,
  onCancelOccurrence,
  onEditItem,
  onTogglePauseItem,
  onRestartCourse,
  onScheduleItem,
  plan,
  todayKey,
  uploadedIcons,
}: {
  canAddCare: boolean
  hiddenScheduledItemIds: ReadonlySet<string>
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  isBusy: boolean
  isAddingCare: boolean
  onCardAction: (entry: SelfCareTodayItem) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onAddCare: () => void
  onCancelOccurrence: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
  onTogglePauseItem: (entry: SelfCareTodayItem) => void
  onRestartCourse: (entry: SelfCareTodayItem) => void
  onScheduleItem: (entry: SelfCareTodayItem) => void
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const latestCompletionByItemId = useMemo(
    () => getLatestProgressCompletionByItemId(history),
    [history],
  )
  const nextPlannedDateByItemId = useMemo(
    () => getNextPlannedDateByItemId(plan, todayKey),
    [plan, todayKey],
  )
  const occurrences = getPlanOccurrenceEntries(plan, todayKey)
  const courseEntries = (plan?.courses ?? []).map((entry) =>
    mergeLatestProgressCompletion(
      entry,
      latestCompletionByItemId.get(entry.item.id) ?? null,
    ),
  )
  const planningHints = (plan?.planningHints ?? []).filter(
    (entry) => !hiddenScheduledItemIds.has(entry.item.id),
  )
  const medicalEntries = plan?.medical ?? []
  const hasPlanContent =
    occurrences.length > 0 ||
    planningHints.length > 0 ||
    medicalEntries.length > 0 ||
    courseEntries.length > 0

  return (
    <div className={styles.tabPanel}>
      {occurrences.length ? (
        <SelfCareSection title="Записи и задачи">
          {occurrences.slice(0, 18).map((entry) => (
            <SelfCareItemCard
              actions="plan"
              key={entry.occurrence?.id ?? entry.item.id}
              entry={entry}
              isBusy={isBusy}
              todayKey={todayKey}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onCancelOccurrence={onCancelOccurrence}
              onEdit={onEditItem}
              onTogglePause={onTogglePauseItem}
            />
          ))}
        </SelfCareSection>
      ) : !hasPlanContent ? (
        <PageStateView
          action={
            canAddCare
              ? {
                  disabled: isBusy,
                  label: isAddingCare ? 'Добавляем…' : 'Добавить заботу',
                  onClick: onAddCare,
                }
              : undefined
          }
          description="Можно оставить ближайшие дни свободными или добавить одну подходящую заботу."
          kind="empty"
          title="На ближайшие даты ничего не запланировано"
        />
      ) : null}

      {planningHints.length ? (
        <SelfCareSection title="Можно запланировать">
          {planningHints.map((entry) => (
            <PlanningHintCard
              key={`plan-hint-${entry.item.id}`}
              entry={entry}
              isBusy={isBusy}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onTogglePause={onTogglePauseItem}
              onSchedule={onScheduleItem}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {medicalEntries.length ? (
        <SelfCareSection title="Записи и здоровье">
          {medicalEntries.map((entry) => (
            <PlanningHintCard
              key={`medical-${entry.item.id}-${entry.occurrence?.id ?? 'item'}`}
              entry={entry}
              isBusy={isBusy}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onTogglePause={onTogglePauseItem}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {courseEntries.length ? (
        <SelfCareSection title="Курсы">
          {courseEntries.map((entry) => (
            <SelfCareItemCard
              key={`course-${entry.item.id}`}
              entry={entry}
              isBusy={isBusy}
              todayKey={todayKey}
              nextOccurrenceDate={nextPlannedDateByItemId.get(entry.item.id)}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onTogglePause={onTogglePauseItem}
              onRestartCourse={onRestartCourse}
            />
          ))}
        </SelfCareSection>
      ) : null}
    </div>
  )
}
