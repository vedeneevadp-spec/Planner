import type {
  SelfCareListResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import { useMemo } from 'react'

import type {
  useSelfCareDashboard,
  useSelfCareHistory,
  useSelfCarePlan,
} from '@/features/self-care'
import { usePlannerTimeZone } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import {
  CheckIcon,
  GearIcon,
  IconMark,
  ImageStackIcon,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'

import {
  canRestartCourse,
  CATEGORY_LABELS,
  formatCompletionMeasurementHistoryValue,
  formatCompletionState,
  formatCourseCompletionState,
  formatDate,
  formatEntryDetails,
  formatExercisePlan,
  formatExerciseSummary,
  formatMeasurementSummary,
  formatMeasurementTarget,
  formatPlanningText,
  formatSchedule,
  formatStateCompletionSummary,
  formatStateSummary,
  formatTime,
  formatTomorrowPlanSummary,
  getCourseProgress,
  getEffectiveRitualStepIds,
  getPrimaryActionLabel,
  getRitualStepDraft,
  getSelfCareEntryTimeZone,
  getSelfCareTodayCardActionOrder,
  getTodayScheduleLabel,
  getTypeLabel,
  groupItemsByCategory,
  groupTodayItems,
  type RitualStepDrafts,
  shouldShowSelfCareSkipAction,
  STATUS_LABELS,
  TIME_GROUP_LABELS,
  VISIBLE_CATEGORY_LABELS,
  type VisibleSelfCareCategory,
} from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'
import {
  buildAvailableTodayEntries,
  buildItemEntry,
  buildTodayCourseEntries,
  getLatestProgressCompletionByItemId,
  getNextPlannedDateByItemId,
  getPlannedEntriesCountForDate,
  getPlanOccurrenceEntries,
  inferNextCompletionDate,
  isClosedTodayEntry,
  isEntryDoneToday,
  mergeLatestProgressCompletion,
  mergeRitualProgressCompletion,
  shiftDateKey,
  shouldShowOverdueEntry,
  shouldShowTodayEntry,
} from './SelfCarePage.schedule'
import { SelfCareSection } from './SelfCarePage.sections'

export { SelfCareSettingsTab } from './SelfCarePage.settings'

export function SelfCareTodayTab({
  dashboard,
  history,
  hiddenScheduledItemIds,
  isBusy,
  list,
  onAddCare,
  onCardAction,
  onArchiveItem,
  onEditItem,
  onRestartCourse,
  onScheduleItem,
  onSkipOccurrence,
  onShowHistory,
  onShowPlan,
  plan,
  ritualStepDrafts,
  todayKey,
  uploadedIcons,
  onToggleRitualStep,
}: {
  dashboard: ReturnType<typeof useSelfCareDashboard>['data'] | undefined
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  hiddenScheduledItemIds: ReadonlySet<string>
  isBusy: boolean
  list: SelfCareListResponse | undefined
  onAddCare: () => void
  onCardAction: (entry: SelfCareTodayItem) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
  onRestartCourse: (entry: SelfCareTodayItem) => void
  onScheduleItem: (entry: SelfCareTodayItem) => void
  onSkipOccurrence: (entry: SelfCareTodayItem) => void
  onShowHistory: () => void
  onShowPlan: () => void
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  ritualStepDrafts: RitualStepDrafts
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
  onToggleRitualStep: (entry: SelfCareTodayItem, stepId: string) => void
}) {
  const latestCompletionByItemId = useMemo(
    () => getLatestProgressCompletionByItemId(history),
    [history],
  )
  const nextPlannedDateByItemId = useMemo(
    () => getNextPlannedDateByItemId(plan, todayKey),
    [plan, todayKey],
  )

  if (!dashboard) {
    return <div className={styles.tabPanel} />
  }

  const dashboardTodayItems = dashboard.todayItems
  const dashboardFlexibleGoals = dashboard.flexibleGoals
  const overdueItems = dashboard.overdueItems.filter(shouldShowOverdueEntry)
  const todayItems = dashboardTodayItems
    .filter(shouldShowTodayEntry)
    .filter((entry) => entry.item.type !== 'course')
  const flexibleGoals = dashboardFlexibleGoals.filter(shouldShowTodayEntry)
  const courseEntries = buildTodayCourseEntries({
    dashboardTodayItems,
    latestCompletionByItemId,
    nextPlannedDateByItemId,
    planCourses: plan?.courses ?? [],
    todayKey,
  })
  const availableTodayEntries = buildAvailableTodayEntries({
    dashboard,
    history,
    list,
    plan,
    todayKey,
  }).filter((entry) => entry.item.type !== 'course')
  const planningHints = dashboard.planningHints.filter(
    (entry) => !hiddenScheduledItemIds.has(entry.item.id),
  )
  const groupedItems = groupTodayItems(todayItems)
  const hasVisibleTodayContent =
    overdueItems.length > 0 ||
    todayItems.length > 0 ||
    courseEntries.length > 0 ||
    availableTodayEntries.length > 0 ||
    flexibleGoals.length > 0 ||
    planningHints.length > 0
  const hasClosedTodayWork = [
    ...dashboardTodayItems,
    ...dashboardFlexibleGoals,
  ].some(isClosedTodayEntry)
  const tomorrowCount = getPlannedEntriesCountForDate(
    plan,
    shiftDateKey(todayKey, 1),
  )
  const isAvailableTodayLoading = !list || !history

  if (!hasVisibleTodayContent && isAvailableTodayLoading) {
    return (
      <div className={styles.tabPanel}>
        <section className={styles.emptyPanel}>
          Загружаем доступные на сегодня действия.
        </section>
      </div>
    )
  }

  if (!hasVisibleTodayContent) {
    return (
      <SelfCareTodayClearState
        hasClosedTodayWork={hasClosedTodayWork}
        tomorrowCount={tomorrowCount}
        onAddCare={onAddCare}
        onShowHistory={onShowHistory}
        onShowPlan={onShowPlan}
      />
    )
  }

  return (
    <div className={styles.tabPanel}>
      {overdueItems.length ? (
        <SelfCareSection title="Не закрыто за прошлые дни">
          {overdueItems.map((entry) => (
            <SelfCareItemCard
              key={`overdue-${entry.occurrence?.id ?? entry.item.id}`}
              entry={entry}
              isTodayView
              isBusy={isBusy}
              todayKey={todayKey}
              scheduleActionLabel="Перенести"
              stepDraft={getRitualStepDraft(ritualStepDrafts, entry, todayKey)}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onSchedule={onScheduleItem}
              onSkipOccurrence={
                shouldShowSelfCareSkipAction(entry, 'overdue')
                  ? onSkipOccurrence
                  : undefined
              }
              onToggleStep={onToggleRitualStep}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {courseEntries.length ? (
        <SelfCareSection title="Курсы">
          {courseEntries.map((entry) => (
            <SelfCareItemCard
              key={`today-course-${entry.item.id}`}
              entry={entry}
              isTodayView
              isBusy={isBusy}
              todayKey={todayKey}
              nextOccurrenceDate={nextPlannedDateByItemId.get(entry.item.id)}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onRestartCourse={onRestartCourse}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {(['morning', 'afternoon', 'evening', 'night', 'anytime'] as const).map(
        (group) =>
          groupedItems[group].length ? (
            <SelfCareSection key={group} title={TIME_GROUP_LABELS[group]}>
              {groupedItems[group].map((entry) => (
                <SelfCareItemCard
                  key={entry.occurrence?.id ?? entry.item.id}
                  entry={entry}
                  isTodayView
                  isBusy={isBusy}
                  todayKey={todayKey}
                  stepDraft={getRitualStepDraft(
                    ritualStepDrafts,
                    entry,
                    todayKey,
                  )}
                  uploadedIcons={uploadedIcons}
                  onAction={onCardAction}
                  onArchive={onArchiveItem}
                  onEdit={onEditItem}
                  onRestartCourse={onRestartCourse}
                  onToggleStep={onToggleRitualStep}
                />
              ))}
            </SelfCareSection>
          ) : null,
      )}

      {availableTodayEntries.length ? (
        <SelfCareSection title="Доступно сегодня">
          {availableTodayEntries.map((entry) => (
            <SelfCareItemCard
              key={`available-${entry.item.id}`}
              entry={entry}
              isTodayView
              isBusy={isBusy}
              todayKey={todayKey}
              stepDraft={getRitualStepDraft(ritualStepDrafts, entry, todayKey)}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onRestartCourse={onRestartCourse}
              onToggleStep={onToggleRitualStep}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {flexibleGoals.length ? (
        <SelfCareSection title="Гибкие цели">
          {flexibleGoals.map((entry) => (
            <SelfCareItemCard
              key={`goal-${entry.item.id}`}
              entry={entry}
              isTodayView
              isBusy={isBusy}
              todayKey={todayKey}
              uploadedIcons={uploadedIcons}
              onAction={onCardAction}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onRestartCourse={onRestartCourse}
            />
          ))}
        </SelfCareSection>
      ) : null}

      {planningHints.length ? (
        <SelfCareSection title="Ближайшее важное">
          {planningHints.map((entry) => (
            <PlanningHintCard
              key={`hint-${entry.item.id}-${entry.occurrence?.id ?? 'item'}`}
              entry={entry}
              isTodayView
              isBusy={isBusy}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
              onSchedule={onScheduleItem}
            />
          ))}
        </SelfCareSection>
      ) : null}
    </div>
  )
}

function SelfCareTodayClearState({
  hasClosedTodayWork,
  onAddCare,
  onShowHistory,
  onShowPlan,
  tomorrowCount,
}: {
  hasClosedTodayWork: boolean
  onAddCare: () => void
  onShowHistory: () => void
  onShowPlan: () => void
  tomorrowCount: number | null
}) {
  return (
    <div className={styles.tabPanel}>
      <section className={styles.clearStatePanel}>
        <div className={styles.clearStateContent}>
          <div className={styles.clearStateHero}>
            <div>
              <h2>
                {hasClosedTodayWork
                  ? 'Сегодня можно выдохнуть'
                  : 'Сегодня спокойно'}
              </h2>
              <p>
                {hasClosedTodayWork
                  ? 'Всё запланированное на сегодня уже выполнено. Можно ничего не добавлять — отдых тоже часть заботы.'
                  : 'На сегодня ничего не запланировано. Можно оставить день свободным или добавить что-то маленькое для себя.'}
              </p>
            </div>
          </div>

          <div className={styles.clearStateActions}>
            <button
              className={styles.softButton}
              type="button"
              onClick={onShowHistory}
            >
              Посмотреть выполненное
            </button>
            <button
              className={styles.primaryButton}
              type="button"
              onClick={onAddCare}
            >
              Добавить заботу
            </button>
          </div>

          <div className={styles.tomorrowPreview}>
            <div>
              <span>Завтра</span>
              <strong>{formatTomorrowPlanSummary(tomorrowCount)}</strong>
            </div>
            {tomorrowCount && tomorrowCount > 0 ? (
              <button
                className={styles.softButton}
                type="button"
                onClick={onShowPlan}
              >
                Посмотреть
              </button>
            ) : null}
          </div>
        </div>

        <div className={styles.clearStateArtwork} aria-hidden="true">
          <img
            className={cx(styles.clearStateImage, styles.clearStateImageLight)}
            src="/self-care/today-clear-light.webp"
            alt=""
            loading="lazy"
            decoding="async"
          />
          <img
            className={cx(styles.clearStateImage, styles.clearStateImageDark)}
            src="/self-care/today-clear-dark.webp"
            alt=""
            loading="lazy"
            decoding="async"
          />
        </div>
      </section>
    </div>
  )
}

export function SelfCarePlanTab({
  hiddenScheduledItemIds,
  history,
  isBusy,
  onCardAction,
  onArchiveItem,
  onCancelOccurrence,
  onEditItem,
  onRestartCourse,
  onScheduleItem,
  plan,
  todayKey,
  uploadedIcons,
}: {
  hiddenScheduledItemIds: ReadonlySet<string>
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  isBusy: boolean
  onCardAction: (entry: SelfCareTodayItem) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onCancelOccurrence: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
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
            />
          ))}
        </SelfCareSection>
      ) : !hasPlanContent ? (
        <section className={styles.emptyPanel}>
          На ближайшие даты пока ничего не запланировано.
        </section>
      ) : null}

      {planningHints.length ? (
        <SelfCareSection title="Пора запланировать">
          {planningHints.map((entry) => (
            <PlanningHintCard
              key={`plan-hint-${entry.item.id}`}
              entry={entry}
              isBusy={isBusy}
              onArchive={onArchiveItem}
              onEdit={onEditItem}
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
              onRestartCourse={onRestartCourse}
            />
          ))}
        </SelfCareSection>
      ) : null}
    </div>
  )
}

export function SelfCareRitualsTab({
  dashboardItems,
  history,
  isBusy,
  list,
  plan,
  ritualStepDrafts,
  todayKey,
  uploadedIcons,
  onCardAction,
  onArchiveItem,
  onEditItem,
  onRestartCourse,
  onToggleRitualStep,
}: {
  dashboardItems: SelfCareTodayItem[]
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
  isBusy: boolean
  list: SelfCareListResponse | undefined
  plan: ReturnType<typeof useSelfCarePlan>['data'] | undefined
  ritualStepDrafts: RitualStepDrafts
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
  onCardAction: (entry: SelfCareTodayItem) => void
  onArchiveItem: (entry: SelfCareTodayItem) => void
  onEditItem: (entry: SelfCareTodayItem) => void
  onRestartCourse: (entry: SelfCareTodayItem) => void
  onToggleRitualStep: (entry: SelfCareTodayItem, stepId: string) => void
}) {
  const grouped = useMemo(() => groupItemsByCategory(list), [list])
  const latestCompletionByItemId = useMemo(
    () => getLatestProgressCompletionByItemId(history),
    [history],
  )
  const nextPlannedDateByItemId = useMemo(
    () => getNextPlannedDateByItemId(plan, todayKey),
    [plan, todayKey],
  )
  const todayByItemId = new Map(
    dashboardItems.map((entry) => [entry.item.id, entry]),
  )

  if (!list) {
    return <div className={styles.tabPanel} />
  }

  return (
    <div className={styles.tabPanel}>
      {Object.entries(grouped).map(([category, items]) =>
        items.length ? (
          <SelfCareSection
            key={category}
            title={VISIBLE_CATEGORY_LABELS[category as VisibleSelfCareCategory]}
          >
            {items.map((item) => {
              const baseEntry =
                todayByItemId.get(item.id) ?? buildItemEntry(item, list)
              const latestCompletion =
                latestCompletionByItemId.get(item.id) ?? null
              const entry = mergeRitualProgressCompletion(
                baseEntry,
                latestCompletion,
              )
              const nextOccurrenceDate =
                nextPlannedDateByItemId.get(item.id) ??
                inferNextCompletionDate({
                  completion: entry.completion,
                  scheduleRule: entry.scheduleRule,
                  todayKey,
                })

              return (
                <SelfCareItemCard
                  key={item.id}
                  entry={entry}
                  isBusy={isBusy}
                  todayKey={todayKey}
                  nextOccurrenceDate={nextOccurrenceDate}
                  stepDraft={getRitualStepDraft(
                    ritualStepDrafts,
                    entry,
                    todayKey,
                  )}
                  uploadedIcons={uploadedIcons}
                  onAction={onCardAction}
                  onArchive={onArchiveItem}
                  onEdit={onEditItem}
                  onRestartCourse={onRestartCourse}
                  onToggleStep={onToggleRitualStep}
                  compact
                />
              )
            })}
          </SelfCareSection>
        ) : null,
      )}
    </div>
  )
}

export function SelfCareHistoryTab({
  history,
}: {
  history: ReturnType<typeof useSelfCareHistory>['data'] | undefined
}) {
  const itemById = new Map(
    (history?.items ?? []).map((item) => [item.id, item]),
  )
  const completions = [...(history?.completions ?? [])].sort((left, right) =>
    right.completedAt.localeCompare(left.completedAt),
  )

  if (!completions.length) {
    return (
      <section className={styles.emptyPanel}>
        История появится после первых выполнений.
      </section>
    )
  }

  return (
    <div className={styles.timeline}>
      {completions.map((completion) => {
        const item = itemById.get(completion.itemId)
        const measurementHistoryValue = formatCompletionMeasurementHistoryValue(
          completion,
          item,
        )
        return (
          <article key={completion.id} className={styles.historyCard}>
            <time>{formatDate(completion.completedAt.slice(0, 10))}</time>
            <div>
              <h3>{item?.title ?? 'Забота о себе'}</h3>
              <p>{STATUS_LABELS[completion.status]}</p>
              {measurementHistoryValue ? (
                <p className={styles.measurementHistoryValue}>
                  {measurementHistoryValue}
                </p>
              ) : null}
              {formatStateCompletionSummary(completion) ? (
                <p className={styles.stateHistoryValue}>
                  {formatStateCompletionSummary(completion)}
                </p>
              ) : null}
              {completion.note ? (
                <p className={styles.noteText}>{completion.note}</p>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

function SelfCareCardIcon({
  uploadedIcons,
  value,
}: {
  uploadedIcons: UploadedIconAsset[]
  value: string | null | undefined
}) {
  const iconValue = value?.trim()

  return (
    <div className={styles.cardIcon} aria-hidden="true">
      {iconValue ? (
        <IconMark
          className={styles.cardIconMark}
          uploadedIcons={uploadedIcons}
          value={iconValue}
        />
      ) : (
        <ImageStackIcon className={styles.cardIconPlaceholder} />
      )}
    </div>
  )
}

function SelfCareItemCard({
  actions = 'today',
  compact = false,
  entry,
  isBusy,
  isTodayView = false,
  nextOccurrenceDate,
  onAction,
  onArchive,
  onCancelOccurrence,
  onEdit,
  onRestartCourse,
  onSchedule,
  onSkipOccurrence,
  onToggleStep,
  scheduleActionLabel = 'Перенести',
  stepDraft,
  todayKey,
  uploadedIcons,
}: {
  actions?: 'plan' | 'today'
  compact?: boolean
  entry: SelfCareTodayItem
  isBusy: boolean
  isTodayView?: boolean
  nextOccurrenceDate?: string | null | undefined
  onAction: (entry: SelfCareTodayItem) => void
  onArchive: (entry: SelfCareTodayItem) => void
  onCancelOccurrence?: (entry: SelfCareTodayItem) => void
  onEdit: (entry: SelfCareTodayItem) => void
  onRestartCourse?: ((entry: SelfCareTodayItem) => void) | undefined
  onSchedule?: (entry: SelfCareTodayItem) => void
  onSkipOccurrence?: ((entry: SelfCareTodayItem) => void) | undefined
  onToggleStep?: (entry: SelfCareTodayItem, stepId: string) => void
  scheduleActionLabel?: string
  stepDraft?: readonly string[] | undefined
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const plannerTimeZone = usePlannerTimeZone()
  const isInactive = !entry.item.isActive || entry.item.isArchived
  const isDone = isEntryDoneToday(entry, todayKey)
  const primaryActionLabel = getPrimaryActionLabel(entry, isDone)
  const flexibleProgressLabel = entry.flexibleProgress
    ? `${entry.flexibleProgress.completedCount} из ${entry.flexibleProgress.targetCount}`
    : null
  const courseProgress = getCourseProgress(entry.courseDetails)
  const typeLabel = getTypeLabel(entry.item)
  const scheduleLabel = formatSchedule(entry.scheduleRule)
  const cardMetaLabel = [
    CATEGORY_LABELS[entry.item.category],
    typeLabel,
    scheduleLabel === typeLabel ? null : scheduleLabel,
  ]
    .filter(Boolean)
    .join(' · ')
  const todayScheduleLabel = isTodayView ? getTodayScheduleLabel(entry) : null
  const detailsLabel = formatEntryDetails(entry)
  const measurementLabel = formatMeasurementSummary(entry)
  const measurementTargetLabel = formatMeasurementTarget(entry)
  const exerciseLabel = formatExerciseSummary(entry)
  const exercisePlanLabel = formatExercisePlan(entry)
  const stateLabel = formatStateSummary(entry)
  const completionLabel =
    entry.item.type === 'course'
      ? formatCourseCompletionState(entry, todayKey)
      : formatCompletionState(entry.completion, todayKey)
  const nextLabel = nextOccurrenceDate
    ? canRestartCourse(entry)
      ? null
      : `Следующее выполнение: ${formatDate(nextOccurrenceDate)}`
    : null
  const restartCourseAction = canRestartCourse(entry)
    ? onRestartCourse
    : undefined
  const shouldShowSkipAction = Boolean(onSkipOccurrence && entry.occurrence)
  const shouldShowScheduleAction = Boolean(onSchedule && entry.occurrence)
  const todayActionOrder = getSelfCareTodayCardActionOrder({
    hasRestartAction: Boolean(restartCourseAction),
    hasScheduleAction: shouldShowScheduleAction,
    hasSkipAction: shouldShowSkipAction,
  })

  function renderTodayAction(action: (typeof todayActionOrder)[number]) {
    switch (action) {
      case 'complete':
        return (
          <button
            key={action}
            className={cx(styles.cardActionButton, styles.cardActionButtonDone)}
            type="button"
            disabled={isBusy || isDone || isInactive}
            title={primaryActionLabel}
            aria-label={`${primaryActionLabel}: «${entry.item.title}»`}
            onClick={() => onAction(entry)}
          >
            <CheckIcon size={18} strokeWidth={2.3} />
          </button>
        )

      case 'edit':
        return (
          <button
            key={action}
            className={cx(styles.cardActionButton, styles.cardActionButtonSoft)}
            type="button"
            disabled={isBusy}
            title="Настроить"
            aria-label={`Настроить заботу «${entry.item.title}»`}
            onClick={() => onEdit(entry)}
          >
            <GearIcon size={18} strokeWidth={2.1} />
          </button>
        )

      case 'archive':
        return (
          <button
            key={action}
            className={cx(
              styles.cardActionButton,
              styles.cardActionButtonDanger,
            )}
            type="button"
            disabled={isBusy}
            title="Удалить"
            aria-label={`Удалить заботу «${entry.item.title}»`}
            onClick={() => onArchive(entry)}
          >
            <TrashIcon size={18} strokeWidth={2.1} />
          </button>
        )

      case 'restart':
        return restartCourseAction ? (
          <button
            key={action}
            className={cx(styles.cardTextButton, styles.cardTextButtonSoft)}
            type="button"
            disabled={isBusy}
            onClick={() => restartCourseAction(entry)}
          >
            Повторить
          </button>
        ) : null

      case 'skip':
        return onSkipOccurrence ? (
          <button
            key={action}
            className={cx(styles.cardTextButton, styles.cardTextButtonSoft)}
            type="button"
            disabled={isBusy || isDone}
            onClick={() => onSkipOccurrence(entry)}
          >
            Пропустить
          </button>
        ) : null

      case 'schedule':
        return onSchedule ? (
          <button
            key={action}
            className={cx(styles.cardTextButton, styles.cardTextButtonSoft)}
            type="button"
            disabled={isBusy || isDone}
            onClick={() => onSchedule(entry)}
          >
            {scheduleActionLabel}
          </button>
        ) : null
    }
  }

  return (
    <article
      className={cx(
        styles.card,
        compact && styles.cardCompact,
        (isDone || isInactive) && styles.cardDone,
      )}
    >
      <div className={styles.cardMain}>
        <SelfCareCardIcon
          uploadedIcons={uploadedIcons}
          value={entry.item.icon}
        />
        <div>
          <div className={styles.cardTitleRow}>
            <h3>{entry.item.title}</h3>
          </div>
          {!isTodayView ? (
            <p className={styles.cardMeta}>{cardMetaLabel}</p>
          ) : null}
          {isInactive ? <p className={styles.progressText}>Неактивна</p> : null}
          {todayScheduleLabel ? (
            <p className={styles.cardMeta}>{todayScheduleLabel}</p>
          ) : null}
          {!isTodayView && entry.occurrence ? (
            <p className={styles.cardMeta}>
              {formatDate(entry.occurrence.scheduledFor)}
              {entry.occurrence.dueAt
                ? ` · ${formatTime(
                    entry.occurrence.dueAt,
                    getSelfCareEntryTimeZone(entry, plannerTimeZone),
                  )}`
                : ''}
            </p>
          ) : null}
          {detailsLabel ? (
            <p className={styles.cardMeta}>{detailsLabel}</p>
          ) : null}
          {measurementLabel ? (
            <p className={styles.measurementValue}>{measurementLabel}</p>
          ) : null}
          {measurementTargetLabel ? (
            <p className={styles.cardMeta}>{measurementTargetLabel}</p>
          ) : null}
          {exerciseLabel ? (
            <p className={styles.measurementValue}>{exerciseLabel}</p>
          ) : null}
          {exercisePlanLabel ? (
            <p className={styles.cardMeta}>{exercisePlanLabel}</p>
          ) : null}
          {stateLabel ? (
            <p className={styles.stateValue}>{stateLabel}</p>
          ) : null}
          {completionLabel ? (
            <p className={styles.progressText}>{completionLabel}</p>
          ) : null}
          {nextLabel ? <p className={styles.cardMeta}>{nextLabel}</p> : null}
          {courseProgress ? (
            <div
              className={styles.courseProgress}
              aria-label={courseProgress.ariaLabel}
            >
              <p className={styles.progressText}>{courseProgress.label}</p>
              <div className={styles.courseProgressTrack} aria-hidden="true">
                <span style={{ inlineSize: `${courseProgress.percent}%` }} />
              </div>
              <p className={styles.cardMeta}>{courseProgress.meta}</p>
            </div>
          ) : null}
          {flexibleProgressLabel ? (
            <p className={styles.progressText}>
              Прогресс: {flexibleProgressLabel}
            </p>
          ) : null}
          {entry.steps.length ? (
            <ChecklistPreview
              entry={entry}
              isBusy={isBusy}
              isDone={isDone}
              selectedStepIds={getEffectiveRitualStepIds(entry, stepDraft)}
              onToggleStep={onToggleStep}
            />
          ) : null}
        </div>
      </div>
      <div className={styles.cardActions}>
        {actions === 'plan' ? (
          <>
            <button
              className={cx(
                styles.cardActionButton,
                styles.cardActionButtonSoft,
              )}
              type="button"
              disabled={isBusy}
              title="Настроить"
              aria-label={`Настроить заботу «${entry.item.title}»`}
              onClick={() => onEdit(entry)}
            >
              <GearIcon size={18} strokeWidth={2.1} />
            </button>
            <button
              className={cx(styles.cardTextButton, styles.cardTextButtonDanger)}
              type="button"
              disabled={isBusy || !entry.occurrence}
              onClick={() => onCancelOccurrence?.(entry)}
            >
              Убрать из плана
            </button>
          </>
        ) : (
          todayActionOrder.map(renderTodayAction)
        )}
      </div>
    </article>
  )
}

function PlanningHintCard({
  entry,
  isBusy,
  isTodayView = false,
  onArchive,
  onEdit,
  onSchedule,
}: {
  entry: SelfCareTodayItem
  isBusy?: boolean
  isTodayView?: boolean
  onArchive?: (entry: SelfCareTodayItem) => void
  onEdit?: (entry: SelfCareTodayItem) => void
  onSchedule?: (entry: SelfCareTodayItem) => void
}) {
  const plannerTimeZone = usePlannerTimeZone()
  const planningText = formatPlanningText(entry, plannerTimeZone)
  const shouldShowPlanningText = !isTodayView || !entry.occurrence

  return (
    <article className={styles.hintCard}>
      <strong>{entry.item.title}</strong>
      {!isTodayView ? (
        <span>
          {CATEGORY_LABELS[entry.item.category]} · {getTypeLabel(entry.item)}
        </span>
      ) : null}
      {shouldShowPlanningText ? <p>{planningText}</p> : null}
      <div className={styles.hintActions}>
        {onSchedule && !entry.occurrence ? (
          <button
            className={cx(styles.cardTextButton, styles.cardTextButtonSoft)}
            type="button"
            disabled={isBusy}
            onClick={() => onSchedule(entry)}
          >
            Запланировать
          </button>
        ) : null}
        {onEdit ? (
          <button
            className={cx(styles.cardActionButton, styles.cardActionButtonSoft)}
            type="button"
            disabled={isBusy}
            title="Настроить"
            aria-label={`Настроить заботу «${entry.item.title}»`}
            onClick={() => onEdit(entry)}
          >
            <GearIcon size={18} strokeWidth={2.1} />
          </button>
        ) : null}
        {onArchive ? (
          <button
            className={cx(
              styles.cardActionButton,
              styles.cardActionButtonDanger,
            )}
            type="button"
            disabled={isBusy}
            title="Удалить"
            aria-label={`Удалить заботу «${entry.item.title}»`}
            onClick={() => onArchive(entry)}
          >
            <TrashIcon size={18} strokeWidth={2.1} />
          </button>
        ) : null}
      </div>
    </article>
  )
}

function ChecklistPreview({
  entry,
  isBusy,
  isDone,
  onToggleStep,
  selectedStepIds,
}: {
  entry: SelfCareTodayItem
  isBusy: boolean
  isDone: boolean
  onToggleStep?:
    ((entry: SelfCareTodayItem, stepId: string) => void) | undefined
  selectedStepIds: readonly string[]
}) {
  const selectedStepIdSet = new Set(selectedStepIds)
  const isInteractive = Boolean(onToggleStep) && !isDone

  return (
    <div className={styles.stepPreview} aria-label="Этапы ритуала">
      {entry.steps.map((step) => {
        const isStepDone = isDone || selectedStepIdSet.has(step.id)

        return (
          <button
            key={step.id}
            className={cx(styles.stepChip, isStepDone && styles.stepChipDone)}
            type="button"
            disabled={isBusy}
            aria-pressed={isStepDone}
            aria-disabled={!isInteractive}
            onClick={() => {
              if (!isInteractive) {
                return
              }

              onToggleStep?.(entry, step.id)
            }}
          >
            <CheckIcon size={13} />
            <span>{step.title}</span>
          </button>
        )
      })}
    </div>
  )
}
