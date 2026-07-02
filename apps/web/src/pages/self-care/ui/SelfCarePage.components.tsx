import type {
  SelfCareCategory,
  SelfCareFlexiblePeriod,
  SelfCareIntervalUnit,
  SelfCareItemType,
  SelfCareListResponse,
  SelfCareTodayItem,
} from '@planner/contracts'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import type {
  useSelfCareDashboard,
  useSelfCareHistory,
  useSelfCarePlan,
} from '@/features/self-care'
import { usePlannerTimeZone } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import {
  CheckIcon,
  CloseIcon,
  GearIcon,
  getIconLabel,
  IconChoicePicker,
  IconMark,
  ImageStackIcon,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'
import { SelectPicker, type SelectPickerOption } from '@/shared/ui/SelectPicker'

import { SelfCareReminderOffsetsField } from './SelfCarePage.form-controls'
import {
  buildSelfCareCustomCreatePayload,
  buildSelfCareEditPayload,
  canUseExactTimePreference,
  getInitialReminderOffsets,
  getSelfCareCustomCreateFormModel,
  getSelfCareEditFormModel,
  getTimePreferenceOptions,
  hasStoredExactTimePreference,
} from './SelfCarePage.form-model'
import {
  canRestartCourse,
  CATEGORY_LABELS,
  CATEGORY_SELECT_OPTIONS,
  COURSE_REPEAT_SELECT_OPTIONS,
  COURSE_SCHEDULE_SELECT_OPTIONS,
  COURSE_TYPE_SELECT_OPTIONS,
  EXERCISE_METRIC_SELECT_OPTIONS,
  FLEXIBLE_GOAL_REPEAT_SELECT_OPTIONS,
  FLEXIBLE_PERIOD_SELECT_OPTIONS,
  formatCompletionMeasurementHistoryValue,
  formatCompletionState,
  formatCourseCompletionState,
  formatDate,
  formatEntryDetails,
  formatExercisePlan,
  formatExerciseSummary,
  formatMeasurementSummary,
  formatMeasurementTarget,
  formatOptionalNumber,
  formatPlanningText,
  formatSchedule,
  formatStateCompletionSummary,
  formatStateSummary,
  formatTime,
  formatTomorrowPlanSummary,
  getCourseProgress,
  getCourseVisibleRepeatKind,
  getDefaultFlexibleGoalIntervalUnit,
  getDefaultFlexibleGoalRepeatKind,
  getEffectiveRitualStepIds,
  getExactScheduleDateLabel,
  getExactScheduleTimeLabel,
  getExerciseMetricValue,
  getInitialEditRepeatMode,
  getInitialFlexibleGoalRepeatMode,
  getInitialScheduleDate,
  getInitialScheduleTime,
  getPrimaryActionLabel,
  getRitualStepDraft,
  getSelfCareEntryTimeZone,
  getSelfCareTodayCardActionOrder,
  getTodayScheduleLabel,
  getTypeLabel,
  groupItemsByCategory,
  groupTodayItems,
  INTERVAL_UNIT_SELECT_OPTIONS,
  repeatKindRequiresInterval,
  type RitualStepDrafts,
  type SelfCareCourseEditScheduleMode,
  type SelfCareCourseRepeatMode,
  type SelfCareCourseScheduleMode,
  type SelfCareCourseType,
  type SelfCareCreateRepeatKind,
  type SelfCareCustomCreatePayload,
  type SelfCareEditRepeatMode,
  type SelfCareEditSubmitPayload,
  type SelfCareStandardRepeatKind,
  type SelfCareTimePreference,
  shouldShowSelfCareSkipAction,
  shouldShowVisitDetails,
  STANDARD_REPEAT_SELECT_OPTIONS,
  STATUS_LABELS,
  TIME_GROUP_LABELS,
  toggleWeekday,
  VISIBLE_CATEGORY_LABELS,
  type VisibleSelfCareCategory,
  WEEKDAY_OPTIONS,
} from './SelfCarePage.helpers'
import { SELF_CARE_ICON_PICKER_OPEN_DATA_KEY } from './SelfCarePage.icon-picker-state'
import styles from './SelfCarePage.module.css'
import {
  buildAvailableTodayEntries,
  buildItemEntry,
  buildTodayCourseEntries,
  getDatePart,
  getIsoWeekdayFromDateKey,
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

const CREATE_TYPE_OPTIONS: ReadonlyArray<{
  description: string
  label: string
  value: SelfCareItemType
}> = [
  {
    description:
      'Разовое или повторяемое действие: купить, выбрать, уточнить, записаться.',
    label: 'Задача',
    value: 'task',
  },
  {
    description: 'Уход или подготовка с несколькими шагами.',
    label: 'Ритуал',
    value: 'ritual',
  },
  {
    description:
      'Запись с датой, временем, местом, специалистом и повтором при необходимости.',
    label: 'Запись',
    value: 'appointment',
  },
  {
    description: 'Набрать несколько выполнений за день, неделю или месяц.',
    label: 'Цель на период',
    value: 'flexible_goal',
  },
  {
    description: 'Курс по дням или сессиям: витамины, процедуры, упражнения.',
    label: 'Курс',
    value: 'course',
  },
  {
    description: 'Числовой показатель: вес, пульс, температура, объем.',
    label: 'Измерение',
    value: 'measurement',
  },
  {
    description: 'Фиксировать выполнение, подходы и динамику результата.',
    label: 'Упражнение',
    value: 'exercise',
  },
]

const CREATE_TYPE_SELECT_OPTIONS: Array<SelectPickerOption<SelfCareItemType>> =
  CREATE_TYPE_OPTIONS.map(({ label, value }) => ({ label, value }))

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

function SelfCareTitleIconField({
  icon,
  maxLength,
  placeholder,
  required = false,
  title,
  uploadedIcons,
  onOpenIconPicker,
  onTitleChange,
}: {
  icon: string
  maxLength: number
  placeholder?: string | undefined
  required?: boolean | undefined
  title: string
  uploadedIcons: UploadedIconAsset[]
  onOpenIconPicker: () => void
  onTitleChange: (title: string) => void
}) {
  const normalizedIcon = icon.trim()
  const iconLabel = getIconLabel(normalizedIcon, uploadedIcons)

  return (
    <div className={styles.titleIconFieldRow}>
      <label className={styles.dateField}>
        <span>Название</span>
        <input
          type="text"
          autoComplete="off"
          maxLength={maxLength}
          required={required}
          placeholder={placeholder}
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
        />
      </label>

      <button
        className={styles.iconSelectButton}
        type="button"
        aria-label={`Выбрать иконку. Сейчас: ${iconLabel}`}
        onClick={onOpenIconPicker}
      >
        <span className={styles.iconSelectButtonMark} aria-hidden="true">
          {normalizedIcon ? (
            <IconMark
              className={styles.iconSelectButtonIcon}
              uploadedIcons={uploadedIcons}
              value={normalizedIcon}
            />
          ) : (
            <ImageStackIcon className={styles.iconSelectButtonPlaceholder} />
          )}
        </span>
      </button>
    </div>
  )
}

function SelfCareIconPickerDialog({
  uploadedIcons,
  value,
  onChange,
  onClose,
}: {
  uploadedIcons: UploadedIconAsset[]
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const previousValue =
      document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY]
    document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY] = 'true'

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)

      if (previousValue === undefined) {
        delete document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY]
        return
      }

      document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY] = previousValue
    }
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={cx(styles.modalOverlay, styles.iconPickerDialogOverlay)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-icon-picker-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть выбор иконки"
        onClick={onClose}
      />

      <section className={cx(styles.modalPanel, styles.iconPickerDialogPanel)}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-icon-picker-title">Иконка</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть выбор иконки"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <IconChoicePicker
          className={styles.iconPickerDialogPicker}
          hideLabel
          label="Иконка"
          uploadedIcons={uploadedIcons}
          value={value}
          onChange={(nextValue) => {
            onChange(nextValue)
            onClose()
          }}
        />
      </section>
    </div>,
    document.body,
  )
}

export function SelfCareCustomCreateForm({
  defaultCurrency,
  isBusy,
  onCreate,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  isBusy: boolean
  onCreate: (payload: SelfCareCustomCreatePayload) => void
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const plannerTimeZone = usePlannerTimeZone()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState('')
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const [type, setType] = useState<SelfCareItemType>('task')
  const [category, setCategory] = useState<SelfCareCategory>('custom')
  const [preferredTimePreference, setPreferredTimePreference] =
    useState<SelfCareTimePreference>('anytime')
  const [repeatKind, setRepeatKind] =
    useState<SelfCareStandardRepeatKind>('none')
  const [courseScheduleMode, setCourseScheduleMode] =
    useState<SelfCareCourseScheduleMode>('daily')
  const [intervalValue, setIntervalValue] = useState('4')
  const [intervalUnit, setIntervalUnit] = useState<SelfCareIntervalUnit>('week')
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(() => [
    getIsoWeekdayFromDateKey(todayKey),
  ])
  const [dayOfMonth, setDayOfMonth] = useState(() =>
    String(Number(todayKey.slice(8, 10))),
  )
  const [monthOfYear, setMonthOfYear] = useState(() =>
    String(Number(todayKey.slice(5, 7))),
  )
  const [flexibleTargetCount, setFlexibleTargetCount] = useState('3')
  const [flexiblePeriod, setFlexiblePeriod] =
    useState<SelfCareFlexiblePeriod>('week')
  const [courseType, setCourseType] = useState<SelfCareCourseType>('days')
  const [courseTotalCount, setCourseTotalCount] = useState('30')
  const [courseRepeatMode, setCourseRepeatMode] =
    useState<SelfCareCourseRepeatMode>('once')
  const [courseBreakDays, setCourseBreakDays] = useState('7')
  const [scheduledDate, setScheduledDate] = useState(todayKey)
  const [scheduledTime, setScheduledTime] = useState('')
  const [reminderOffsetsMinutes, setReminderOffsetsMinutes] = useState<
    number[]
  >([])
  const [detailsPlace, setDetailsPlace] = useState('')
  const [detailsSpecialist, setDetailsSpecialist] = useState('')
  const [detailsContact, setDetailsContact] = useState('')
  const [detailsPrice, setDetailsPrice] = useState('')
  const [measurementValueLabel, setMeasurementValueLabel] = useState('Значение')
  const [measurementUnit, setMeasurementUnit] = useState('')
  const [exerciseMetricValue, setExerciseMetricValue] = useState('count:reps')
  const [exerciseUseSets, setExerciseUseSets] = useState(false)
  const [exercisePlannedValue, setExercisePlannedValue] = useState('')
  const [exercisePlannedSets, setExercisePlannedSets] = useState('3')
  const [stepsText, setStepsText] = useState('')
  const selectedType = CREATE_TYPE_OPTIONS.find(
    (option) => option.value === type,
  )
  const formDraft = {
    category,
    courseBreakDays,
    courseRepeatMode,
    courseScheduleMode,
    courseTotalCount,
    courseType,
    dayOfMonth,
    daysOfWeek,
    defaultCurrency,
    description,
    detailsContact,
    detailsPlace,
    detailsPrice,
    detailsSpecialist,
    exerciseMetricValue,
    exercisePlannedSets,
    exercisePlannedValue,
    exerciseUseSets,
    flexiblePeriod,
    flexibleTargetCount,
    icon,
    intervalUnit,
    intervalValue,
    measurementUnit,
    measurementValueLabel,
    monthOfYear,
    plannerTimeZone,
    preferredTimePreference,
    reminderOffsetsMinutes,
    repeatKind,
    scheduledDate,
    scheduledTime,
    stepsText,
    title,
    todayKey,
    type,
  }
  const {
    canSubmit,
    showCourseExactTimeField,
    showExactScheduleTimeField,
    showPreferredTimePreference,
    usesExactSchedule,
    usesExactTimePreference,
    visibleRepeatKind,
  } = getSelfCareCustomCreateFormModel(formDraft)

  function handleTypeChange(nextType: SelfCareItemType): void {
    setType(nextType)

    if (!canUseExactTimePreference(nextType)) {
      setPreferredTimePreference((value) =>
        value === 'exact' ? 'anytime' : value,
      )
    }

    if (nextType === 'task') {
      setCategory('custom')
      setRepeatKind('none')
      setScheduledTime('')
    }

    if (nextType === 'habit' || nextType === 'ritual') {
      setRepeatKind('daily')
    }

    if (nextType === 'appointment') {
      setCategory('health')
      setRepeatKind('after_completion')
      setIntervalValue('4')
      setIntervalUnit('week')
      setScheduledTime((value) => value || '09:00')
    }

    if (nextType === 'flexible_goal') {
      setCategory('movement')
      setFlexibleTargetCount('3')
      setFlexiblePeriod('week')
      setIntervalValue('1')
      setIntervalUnit('week')
      setRepeatKind('weekly')
    }

    if (nextType === 'course') {
      setCategory('health')
      setCourseScheduleMode('daily')
      setCourseTotalCount('30')
      setCourseRepeatMode('once')
      setCourseBreakDays('7')
    }

    if (nextType === 'measurement') {
      setCategory('health')
      setRepeatKind('daily')
      setScheduledTime('')
      setMeasurementValueLabel((value) => value || 'Значение')
    }

    if (nextType === 'exercise') {
      setCategory('movement')
      setRepeatKind('daily')
      setScheduledTime('')
      setExerciseMetricValue('count:reps')
      setExercisePlannedSets('3')
    }
  }

  return (
    <form
      className={styles.createForm}
      onSubmit={(event) => {
        event.preventDefault()

        const payload = buildSelfCareCustomCreatePayload(formDraft)

        if (!payload) {
          return
        }

        onCreate(payload)
      }}
    >
      <SelfCareTitleIconField
        icon={icon}
        maxLength={160}
        placeholder="Например: растяжка, стоматолог, стрижка"
        required
        title={title}
        uploadedIcons={uploadedIcons}
        onOpenIconPicker={() => setIsIconPickerOpen(true)}
        onTitleChange={setTitle}
      />

      {isIconPickerOpen ? (
        <SelfCareIconPickerDialog
          uploadedIcons={uploadedIcons}
          value={icon}
          onChange={setIcon}
          onClose={() => setIsIconPickerOpen(false)}
        />
      ) : null}

      <div className={styles.selectWithHint}>
        <SelectPicker<SelfCareItemType>
          className={styles.selectField}
          label="Тип"
          value={type}
          options={CREATE_TYPE_SELECT_OPTIONS}
          onChange={handleTypeChange}
        />
        {selectedType ? (
          <small className={styles.fieldHint}>{selectedType.description}</small>
        ) : null}
      </div>

      <SelectPicker<SelfCareCategory>
        className={styles.selectField}
        label="Категория"
        value={category}
        options={CATEGORY_SELECT_OPTIONS}
        onChange={setCategory}
      />

      <div
        className={cx(
          styles.createFormGrid,
          !showPreferredTimePreference && styles.createFormGridSingle,
        )}
      >
        {showPreferredTimePreference ? (
          <SelectPicker<SelfCareTimePreference>
            className={styles.selectField}
            label="Когда удобнее"
            value={preferredTimePreference}
            options={getTimePreferenceOptions(type)}
            onChange={setPreferredTimePreference}
          />
        ) : null}

        {type === 'course' ? (
          <SelectPicker<SelfCareCourseScheduleMode>
            className={styles.selectField}
            label="Расписание курса"
            value={courseScheduleMode}
            options={COURSE_SCHEDULE_SELECT_OPTIONS}
            onChange={setCourseScheduleMode}
          />
        ) : type === 'flexible_goal' ? (
          <SelectPicker<SelfCareStandardRepeatKind>
            className={styles.selectField}
            label="Повтор цели"
            value={repeatKind}
            options={FLEXIBLE_GOAL_REPEAT_SELECT_OPTIONS}
            onChange={setRepeatKind}
          />
        ) : (
          <SelectPicker<SelfCareStandardRepeatKind>
            className={styles.selectField}
            label="Регулярность"
            value={repeatKind}
            options={STANDARD_REPEAT_SELECT_OPTIONS}
            onChange={setRepeatKind}
          />
        )}
      </div>

      {type === 'flexible_goal' ? (
        <SelfCareFlexibleGoalFields
          flexiblePeriod={flexiblePeriod}
          flexibleTargetCount={flexibleTargetCount}
          onChangeFlexiblePeriod={(nextPeriod) => {
            setFlexiblePeriod(nextPeriod)
            setIntervalUnit(getDefaultFlexibleGoalIntervalUnit(nextPeriod))
            setRepeatKind(getDefaultFlexibleGoalRepeatKind(nextPeriod))
          }}
          onChangeFlexibleTargetCount={setFlexibleTargetCount}
        />
      ) : null}

      <SelfCareRepeatFields
        dayOfMonth={dayOfMonth}
        daysOfWeek={daysOfWeek}
        flexiblePeriod={flexiblePeriod}
        flexibleTargetCount={flexibleTargetCount}
        hideCalendarDetails={type === 'flexible_goal'}
        intervalUnit={intervalUnit}
        intervalValue={intervalValue}
        monthOfYear={monthOfYear}
        repeatKind={visibleRepeatKind}
        onChangeDayOfMonth={setDayOfMonth}
        onChangeFlexiblePeriod={setFlexiblePeriod}
        onChangeFlexibleTargetCount={setFlexibleTargetCount}
        onChangeIntervalUnit={setIntervalUnit}
        onChangeIntervalValue={setIntervalValue}
        onChangeMonthOfYear={setMonthOfYear}
        onToggleWeekday={(weekday) =>
          setDaysOfWeek((current) => toggleWeekday(current, weekday))
        }
      />

      {usesExactSchedule ? (
        <>
          <div className={styles.createFormGrid}>
            <label className={styles.dateField}>
              <span>{getExactScheduleDateLabel(type)}</span>
              <input
                type="date"
                min={todayKey}
                required
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
              />
            </label>

            {showExactScheduleTimeField ? (
              <label className={styles.dateField}>
                <span>{getExactScheduleTimeLabel(type)}</span>
                <input
                  type="time"
                  required={usesExactTimePreference}
                  value={scheduledTime}
                  onChange={(event) => setScheduledTime(event.target.value)}
                />
              </label>
            ) : null}
          </div>

          {showExactScheduleTimeField ? (
            <SelfCareReminderOffsetsField
              value={reminderOffsetsMinutes}
              onChange={setReminderOffsetsMinutes}
            />
          ) : null}
        </>
      ) : null}

      {showCourseExactTimeField ? (
        <>
          <div
            className={cx(styles.createFormGrid, styles.createFormGridSingle)}
          >
            <label className={styles.dateField}>
              <span>{getExactScheduleTimeLabel(type)}</span>
              <input
                type="time"
                required
                value={scheduledTime}
                onChange={(event) => setScheduledTime(event.target.value)}
              />
            </label>
          </div>

          <SelfCareReminderOffsetsField
            value={reminderOffsetsMinutes}
            onChange={setReminderOffsetsMinutes}
          />
        </>
      ) : null}

      {type === 'course' ? (
        <>
          <div className={styles.createFormGrid}>
            <label className={styles.dateField}>
              <span>Длина курса</span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                required
                value={courseTotalCount}
                onChange={(event) => setCourseTotalCount(event.target.value)}
              />
            </label>

            <SelectPicker<SelfCareCourseType>
              className={styles.selectField}
              label="Единица курса"
              value={courseType}
              options={COURSE_TYPE_SELECT_OPTIONS}
              onChange={setCourseType}
            />
          </div>

          <div className={styles.createFormGrid}>
            <SelectPicker<SelfCareCourseRepeatMode>
              className={styles.selectField}
              label="Повтор курса"
              value={courseRepeatMode}
              options={COURSE_REPEAT_SELECT_OPTIONS}
              onChange={setCourseRepeatMode}
            />

            {courseRepeatMode === 'cycle' ? (
              <label className={styles.dateField}>
                <span>Перерыв, дней</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  required
                  value={courseBreakDays}
                  onChange={(event) => setCourseBreakDays(event.target.value)}
                />
              </label>
            ) : null}
          </div>
        </>
      ) : null}

      {type === 'measurement' ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>Что измеряем</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={80}
              required
              placeholder="Вес, пульс, температура"
              value={measurementValueLabel}
              onChange={(event) => setMeasurementValueLabel(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Единица</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={32}
              required
              placeholder="кг, см, °C"
              value={measurementUnit}
              onChange={(event) => setMeasurementUnit(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {type === 'exercise' ? (
        <div className={styles.exerciseFields}>
          <SelectPicker<string>
            className={styles.selectField}
            label="Что отслеживаем"
            value={exerciseMetricValue}
            options={EXERCISE_METRIC_SELECT_OPTIONS}
            onChange={setExerciseMetricValue}
          />

          <label className={styles.toggleField}>
            <input
              type="checkbox"
              checked={exerciseUseSets}
              onChange={(event) => setExerciseUseSets(event.target.checked)}
            />
            <span>Использовать подходы</span>
          </label>

          <div className={styles.createFormGrid}>
            <label className={styles.dateField}>
              <span>Плановое значение</span>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                placeholder="20"
                value={exercisePlannedValue}
                onChange={(event) =>
                  setExercisePlannedValue(event.target.value)
                }
              />
            </label>

            {exerciseUseSets ? (
              <label className={styles.dateField}>
                <span>Плановое количество подходов</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  required
                  value={exercisePlannedSets}
                  onChange={(event) =>
                    setExercisePlannedSets(event.target.value)
                  }
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      {shouldShowVisitDetails(type) ? (
        <SelfCareVisitDetailsFields
          contact={detailsContact}
          place={detailsPlace}
          price={detailsPrice}
          specialist={detailsSpecialist}
          onChangeContact={setDetailsContact}
          onChangePlace={setDetailsPlace}
          onChangePrice={setDetailsPrice}
          onChangeSpecialist={setDetailsSpecialist}
        />
      ) : null}

      {type === 'ritual' ? (
        <label className={styles.dateField}>
          <span>Шаги ритуала</span>
          <textarea
            rows={4}
            maxLength={800}
            placeholder={'Умыться\nКрем\nSPF'}
            value={stepsText}
            onChange={(event) => setStepsText(event.target.value)}
          />
        </label>
      ) : null}

      <label className={styles.dateField}>
        <span>Описание</span>
        <textarea
          rows={3}
          maxLength={1200}
          placeholder="Можно оставить пустым"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className={styles.modalActions}>
        <button
          className={styles.doneButton}
          type="submit"
          disabled={isBusy || !canSubmit}
        >
          Создать заботу
        </button>
      </div>
    </form>
  )
}

function SelfCareVisitDetailsFields({
  contact,
  onChangeContact,
  onChangePlace,
  onChangePrice,
  onChangeSpecialist,
  place,
  price,
  specialist,
}: {
  contact: string
  onChangeContact: (value: string) => void
  onChangePlace: (value: string) => void
  onChangePrice: (value: string) => void
  onChangeSpecialist: (value: string) => void
  place: string
  price: string
  specialist: string
}) {
  return (
    <details className={styles.visitDetailsDisclosure}>
      <summary>Детали</summary>
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Место</span>
          <input
            type="text"
            autoComplete="off"
            placeholder="Салон, клиника, адрес"
            value={place}
            onChange={(event) => onChangePlace(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>Мастер / специалист</span>
          <input
            type="text"
            autoComplete="off"
            placeholder="Имя мастера или врача"
            value={specialist}
            onChange={(event) => onChangeSpecialist(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>Контакт</span>
          <input
            type="text"
            autoComplete="off"
            placeholder="Телефон, ссылка, мессенджер"
            value={contact}
            onChange={(event) => onChangeContact(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>Стоимость</span>
          <input
            type="number"
            min="0"
            step="1"
            inputMode="decimal"
            value={price}
            onChange={(event) => onChangePrice(event.target.value)}
          />
        </label>
      </div>
    </details>
  )
}

function SelfCareFlexibleGoalFields({
  flexiblePeriod,
  flexibleTargetCount,
  onChangeFlexiblePeriod,
  onChangeFlexibleTargetCount,
}: {
  flexiblePeriod: SelfCareFlexiblePeriod
  flexibleTargetCount: string
  onChangeFlexiblePeriod: (value: SelfCareFlexiblePeriod) => void
  onChangeFlexibleTargetCount: (value: string) => void
}) {
  return (
    <div className={styles.createFormGrid}>
      <label className={styles.dateField}>
        <span>Цель</span>
        <input
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          required
          value={flexibleTargetCount}
          onChange={(event) => onChangeFlexibleTargetCount(event.target.value)}
        />
      </label>

      <SelectPicker<SelfCareFlexiblePeriod>
        className={styles.selectField}
        label="Период цели"
        value={flexiblePeriod}
        options={FLEXIBLE_PERIOD_SELECT_OPTIONS}
        onChange={onChangeFlexiblePeriod}
      />
    </div>
  )
}

function SelfCareRepeatFields({
  dayOfMonth,
  daysOfWeek,
  flexiblePeriod,
  flexibleTargetCount,
  hideCalendarDetails = false,
  intervalUnit,
  intervalValue,
  monthOfYear,
  onChangeDayOfMonth,
  onChangeFlexiblePeriod,
  onChangeFlexibleTargetCount,
  onChangeIntervalUnit,
  onChangeIntervalValue,
  onChangeMonthOfYear,
  onToggleWeekday,
  repeatKind,
}: {
  dayOfMonth: string
  daysOfWeek: number[]
  flexiblePeriod: SelfCareFlexiblePeriod
  flexibleTargetCount: string
  hideCalendarDetails?: boolean | undefined
  intervalUnit: SelfCareIntervalUnit
  intervalValue: string
  monthOfYear: string
  onChangeDayOfMonth: (value: string) => void
  onChangeFlexiblePeriod: (value: SelfCareFlexiblePeriod) => void
  onChangeFlexibleTargetCount: (value: string) => void
  onChangeIntervalUnit: (value: SelfCareIntervalUnit) => void
  onChangeIntervalValue: (value: string) => void
  onChangeMonthOfYear: (value: string) => void
  onToggleWeekday: (weekday: number) => void
  repeatKind: SelfCareCreateRepeatKind
}) {
  if (repeatKindRequiresInterval(repeatKind)) {
    return (
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Повторять через</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            required
            value={intervalValue}
            onChange={(event) => onChangeIntervalValue(event.target.value)}
          />
        </label>

        <SelectPicker<SelfCareIntervalUnit>
          className={styles.selectField}
          label="Период"
          value={intervalUnit}
          options={INTERVAL_UNIT_SELECT_OPTIONS}
          onChange={onChangeIntervalUnit}
        />
      </div>
    )
  }

  if (hideCalendarDetails) {
    return null
  }

  if (repeatKind === 'weekly') {
    return (
      <div
        className={styles.quickDateGrid}
        role="group"
        aria-label="Дни недели для повтора"
      >
        {WEEKDAY_OPTIONS.map((weekday) => {
          const isSelected = daysOfWeek.includes(weekday.value)

          return (
            <button
              key={weekday.value}
              className={cx(
                styles.quickDateButton,
                isSelected && styles.quickDateButtonActive,
              )}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onToggleWeekday(weekday.value)}
            >
              {weekday.label}
            </button>
          )
        })}
      </div>
    )
  }

  if (repeatKind === 'monthly') {
    return (
      <label className={styles.dateField}>
        <span>День месяца</span>
        <input
          type="number"
          min="1"
          max="31"
          step="1"
          inputMode="numeric"
          required
          value={dayOfMonth}
          onChange={(event) => onChangeDayOfMonth(event.target.value)}
        />
      </label>
    )
  }

  if (repeatKind === 'yearly') {
    return (
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Месяц</span>
          <input
            type="number"
            min="1"
            max="12"
            step="1"
            inputMode="numeric"
            required
            value={monthOfYear}
            onChange={(event) => onChangeMonthOfYear(event.target.value)}
          />
        </label>

        <label className={styles.dateField}>
          <span>День месяца</span>
          <input
            type="number"
            min="1"
            max="31"
            step="1"
            inputMode="numeric"
            required
            value={dayOfMonth}
            onChange={(event) => onChangeDayOfMonth(event.target.value)}
          />
        </label>
      </div>
    )
  }

  if (repeatKind === 'flexible_goal') {
    return (
      <div className={styles.createFormGrid}>
        <label className={styles.dateField}>
          <span>Цель</span>
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            required
            value={flexibleTargetCount}
            onChange={(event) =>
              onChangeFlexibleTargetCount(event.target.value)
            }
          />
        </label>

        <SelectPicker<SelfCareFlexiblePeriod>
          className={styles.selectField}
          label="Период цели"
          value={flexiblePeriod}
          options={FLEXIBLE_PERIOD_SELECT_OPTIONS}
          onChange={onChangeFlexiblePeriod}
        />
      </div>
    )
  }

  return null
}

export function SelfCareEditForm({
  defaultCurrency,
  entry,
  isBusy,
  onCancel,
  onSubmit,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  entry: SelfCareTodayItem
  isBusy: boolean
  onCancel: () => void
  onSubmit: (payload: SelfCareEditSubmitPayload) => void
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const plannerTimeZone = usePlannerTimeZone()
  const [title, setTitle] = useState(entry.item.title)
  const [description, setDescription] = useState(entry.item.description)
  const [icon, setIcon] = useState(entry.item.icon ?? '')
  const [isIconPickerOpen, setIsIconPickerOpen] = useState(false)
  const [category, setCategory] = useState<SelfCareCategory>(
    entry.item.category,
  )
  const [preferredTimePreference, setPreferredTimePreference] =
    useState<SelfCareTimePreference>(
      hasStoredExactTimePreference(entry, plannerTimeZone)
        ? 'exact'
        : (entry.item.preferredTimeOfDay ?? 'anytime'),
    )
  const [repeatMode, setRepeatMode] = useState<SelfCareEditRepeatMode>(
    entry.item.type === 'flexible_goal'
      ? getInitialFlexibleGoalRepeatMode(entry.scheduleRule)
      : getInitialEditRepeatMode(entry.scheduleRule),
  )
  const [courseScheduleMode, setCourseScheduleMode] =
    useState<SelfCareCourseEditScheduleMode>('keep')
  const [intervalValue, setIntervalValue] = useState(
    formatOptionalNumber(
      entry.scheduleRule?.intervalValue ??
        (entry.item.type === 'flexible_goal' ? 1 : 4),
    ),
  )
  const [intervalUnit, setIntervalUnit] = useState<SelfCareIntervalUnit>(
    entry.scheduleRule?.intervalUnit ??
      (entry.item.type === 'flexible_goal'
        ? getDefaultFlexibleGoalIntervalUnit(
            entry.scheduleRule?.flexiblePeriod ?? 'week',
          )
        : 'week'),
  )
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    entry.scheduleRule?.daysOfWeek.length
      ? entry.scheduleRule.daysOfWeek
      : [getIsoWeekdayFromDateKey(todayKey)],
  )
  const [dayOfMonth, setDayOfMonth] = useState(
    formatOptionalNumber(
      entry.scheduleRule?.dayOfMonth ?? getDatePart(todayKey, 'day'),
    ),
  )
  const [monthOfYear, setMonthOfYear] = useState(
    formatOptionalNumber(
      entry.scheduleRule?.monthOfYear ?? getDatePart(todayKey, 'month'),
    ),
  )
  const [flexibleTargetCount, setFlexibleTargetCount] = useState(
    formatOptionalNumber(entry.scheduleRule?.flexibleTargetCount ?? 3),
  )
  const [flexiblePeriod, setFlexiblePeriod] = useState<SelfCareFlexiblePeriod>(
    entry.scheduleRule?.flexiblePeriod ?? 'week',
  )
  const [courseType, setCourseType] = useState<SelfCareCourseType>(
    entry.courseDetails?.courseType ?? 'days',
  )
  const [courseTotalCount, setCourseTotalCount] = useState(
    formatOptionalNumber(entry.courseDetails?.totalCount ?? 30),
  )
  const [courseRepeatMode, setCourseRepeatMode] =
    useState<SelfCareCourseRepeatMode>(
      entry.courseDetails?.repeatAfterCompletion ? 'cycle' : 'once',
    )
  const [courseBreakDays, setCourseBreakDays] = useState(
    formatOptionalNumber(entry.courseDetails?.breakDays ?? 7),
  )
  const [stepsText, setStepsText] = useState(
    entry.steps.map((step) => step.title).join('\n'),
  )
  const [scheduledDate, setScheduledDate] = useState(
    getInitialScheduleDate(entry, todayKey, plannerTimeZone),
  )
  const [scheduledTime, setScheduledTime] = useState(
    getInitialScheduleTime(entry, plannerTimeZone),
  )
  const [reminderOffsetsMinutes, setReminderOffsetsMinutes] = useState<
    number[]
  >(() => getInitialReminderOffsets(entry))
  const [procedurePlace, setProcedurePlace] = useState(
    entry.appointment?.place ?? entry.procedure?.place ?? '',
  )
  const [procedureSpecialist, setProcedureSpecialist] = useState(
    entry.appointment?.specialistName ?? entry.procedure?.specialistName ?? '',
  )
  const [procedureContact, setProcedureContact] = useState(
    entry.appointment?.specialistContact ?? entry.procedure?.contact ?? '',
  )
  const [procedurePrice, setProcedurePrice] = useState(
    formatOptionalNumber(
      entry.appointment?.price ?? entry.procedure?.defaultPrice,
    ),
  )
  const procedureCurrency =
    entry.appointment?.currency ?? entry.procedure?.currency ?? defaultCurrency
  const [measurementValueLabel, setMeasurementValueLabel] = useState(
    entry.measurement?.valueLabel ?? 'Значение',
  )
  const [measurementUnit, setMeasurementUnit] = useState(
    entry.measurement?.unit ?? '',
  )
  const [exerciseMetricValue, setExerciseMetricValue] = useState(
    getExerciseMetricValue(
      entry.exercise?.metricType ?? 'count',
      entry.exercise?.unit ?? 'reps',
    ),
  )
  const [exerciseUseSets, setExerciseUseSets] = useState(
    entry.exercise?.useSets ?? false,
  )
  const [exercisePlannedValue, setExercisePlannedValue] = useState(
    formatOptionalNumber(entry.exercise?.plannedValue),
  )
  const [exercisePlannedSets, setExercisePlannedSets] = useState(
    formatOptionalNumber(entry.exercise?.plannedSets ?? 3),
  )
  const formDraft = {
    category,
    courseBreakDays,
    courseRepeatMode,
    courseScheduleMode,
    courseTotalCount,
    courseType,
    dayOfMonth,
    daysOfWeek,
    description,
    entry,
    exerciseMetricValue,
    exercisePlannedSets,
    exercisePlannedValue,
    exerciseUseSets,
    flexiblePeriod,
    flexibleTargetCount,
    icon,
    intervalUnit,
    intervalValue,
    measurementUnit,
    measurementValueLabel,
    monthOfYear,
    plannerTimeZone,
    preferredTimePreference,
    procedureContact,
    procedureCurrency,
    procedurePlace,
    procedurePrice,
    procedureSpecialist,
    reminderOffsetsMinutes,
    repeatMode,
    scheduledDate,
    scheduledTime,
    stepsText,
    title,
    todayKey,
  }
  const {
    canStoreVisitDetails,
    canSubmit,
    selectedCourseScheduleMode,
    selectedRepeatKind,
    showCourseExactTimeField,
    showExactScheduleTimeField,
    showPreferredTimePreference,
    usesExactSchedule,
    usesExactTimePreference,
  } = getSelfCareEditFormModel(formDraft)

  return (
    <form
      className={styles.createForm}
      onSubmit={(event) => {
        event.preventDefault()

        const payload = buildSelfCareEditPayload(formDraft)

        if (!payload) {
          return
        }

        onSubmit(payload)
      }}
    >
      <div className={styles.scheduleTarget}>
        <strong>{entry.item.title}</strong>
        <span>
          {CATEGORY_LABELS[entry.item.category]} · {getTypeLabel(entry.item)}
        </span>
      </div>

      <SelfCareTitleIconField
        icon={icon}
        maxLength={160}
        required
        title={title}
        uploadedIcons={uploadedIcons}
        onOpenIconPicker={() => setIsIconPickerOpen(true)}
        onTitleChange={setTitle}
      />

      {isIconPickerOpen ? (
        <SelfCareIconPickerDialog
          uploadedIcons={uploadedIcons}
          value={icon}
          onChange={setIcon}
          onClose={() => setIsIconPickerOpen(false)}
        />
      ) : null}

      <SelectPicker<SelfCareCategory>
        className={styles.selectField}
        label="Категория"
        value={category}
        options={CATEGORY_SELECT_OPTIONS}
        onChange={setCategory}
      />

      <div
        className={cx(
          styles.createFormGrid,
          !showPreferredTimePreference && styles.createFormGridSingle,
        )}
      >
        {showPreferredTimePreference ? (
          <SelectPicker<SelfCareTimePreference>
            className={styles.selectField}
            label="Когда удобнее"
            value={preferredTimePreference}
            options={getTimePreferenceOptions(entry.item.type)}
            onChange={setPreferredTimePreference}
          />
        ) : null}

        {entry.item.type === 'course' ? (
          <SelectPicker<SelfCareCourseEditScheduleMode>
            className={styles.selectField}
            label="Расписание курса"
            value={courseScheduleMode}
            options={[
              {
                label: `Не менять: ${formatSchedule(entry.scheduleRule)}`,
                value: 'keep',
              },
              ...COURSE_SCHEDULE_SELECT_OPTIONS,
            ]}
            onChange={setCourseScheduleMode}
          />
        ) : entry.item.type === 'flexible_goal' ? (
          <SelectPicker<SelfCareEditRepeatMode>
            className={styles.selectField}
            label="Повтор цели"
            value={repeatMode}
            options={FLEXIBLE_GOAL_REPEAT_SELECT_OPTIONS}
            onChange={setRepeatMode}
          />
        ) : (
          <SelectPicker<SelfCareEditRepeatMode>
            className={styles.selectField}
            label="Регулярность"
            value={repeatMode}
            options={[
              {
                label: `Не менять: ${formatSchedule(entry.scheduleRule)}`,
                value: 'keep',
              },
              ...STANDARD_REPEAT_SELECT_OPTIONS,
            ]}
            onChange={setRepeatMode}
          />
        )}
      </div>

      {entry.item.type === 'flexible_goal' ? (
        <SelfCareFlexibleGoalFields
          flexiblePeriod={flexiblePeriod}
          flexibleTargetCount={flexibleTargetCount}
          onChangeFlexiblePeriod={(nextPeriod) => {
            setFlexiblePeriod(nextPeriod)
            setIntervalUnit(getDefaultFlexibleGoalIntervalUnit(nextPeriod))
            setRepeatMode(getDefaultFlexibleGoalRepeatKind(nextPeriod))
          }}
          onChangeFlexibleTargetCount={setFlexibleTargetCount}
        />
      ) : null}

      {entry.item.type === 'course' && selectedCourseScheduleMode ? (
        <SelfCareRepeatFields
          dayOfMonth={dayOfMonth}
          daysOfWeek={daysOfWeek}
          flexiblePeriod={flexiblePeriod}
          flexibleTargetCount={flexibleTargetCount}
          hideCalendarDetails={false}
          intervalUnit={intervalUnit}
          intervalValue={intervalValue}
          monthOfYear={monthOfYear}
          repeatKind={getCourseVisibleRepeatKind(selectedCourseScheduleMode)}
          onChangeDayOfMonth={setDayOfMonth}
          onChangeFlexiblePeriod={setFlexiblePeriod}
          onChangeFlexibleTargetCount={setFlexibleTargetCount}
          onChangeIntervalUnit={setIntervalUnit}
          onChangeIntervalValue={setIntervalValue}
          onChangeMonthOfYear={setMonthOfYear}
          onToggleWeekday={(weekday) =>
            setDaysOfWeek((current) => toggleWeekday(current, weekday))
          }
        />
      ) : entry.item.type === 'flexible_goal' ? (
        <SelfCareRepeatFields
          dayOfMonth={dayOfMonth}
          daysOfWeek={daysOfWeek}
          flexiblePeriod={flexiblePeriod}
          flexibleTargetCount={flexibleTargetCount}
          hideCalendarDetails
          intervalUnit={intervalUnit}
          intervalValue={intervalValue}
          monthOfYear={monthOfYear}
          repeatKind={repeatMode === 'keep' ? 'none' : repeatMode}
          onChangeDayOfMonth={setDayOfMonth}
          onChangeFlexiblePeriod={setFlexiblePeriod}
          onChangeFlexibleTargetCount={setFlexibleTargetCount}
          onChangeIntervalUnit={setIntervalUnit}
          onChangeIntervalValue={setIntervalValue}
          onChangeMonthOfYear={setMonthOfYear}
          onToggleWeekday={(weekday) =>
            setDaysOfWeek((current) => toggleWeekday(current, weekday))
          }
        />
      ) : selectedRepeatKind ? (
        <SelfCareRepeatFields
          dayOfMonth={dayOfMonth}
          daysOfWeek={daysOfWeek}
          flexiblePeriod={flexiblePeriod}
          flexibleTargetCount={flexibleTargetCount}
          hideCalendarDetails={false}
          intervalUnit={intervalUnit}
          intervalValue={intervalValue}
          monthOfYear={monthOfYear}
          repeatKind={selectedRepeatKind}
          onChangeDayOfMonth={setDayOfMonth}
          onChangeFlexiblePeriod={setFlexiblePeriod}
          onChangeFlexibleTargetCount={setFlexibleTargetCount}
          onChangeIntervalUnit={setIntervalUnit}
          onChangeIntervalValue={setIntervalValue}
          onChangeMonthOfYear={setMonthOfYear}
          onToggleWeekday={(weekday) =>
            setDaysOfWeek((current) => toggleWeekday(current, weekday))
          }
        />
      ) : null}

      {usesExactSchedule ? (
        <>
          <div className={styles.createFormGrid}>
            <label className={styles.dateField}>
              <span>{getExactScheduleDateLabel(entry.item.type)}</span>
              <input
                type="date"
                min={todayKey}
                required
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
              />
            </label>

            {showExactScheduleTimeField ? (
              <label className={styles.dateField}>
                <span>{getExactScheduleTimeLabel(entry.item.type)}</span>
                <input
                  type="time"
                  required={usesExactTimePreference}
                  value={scheduledTime}
                  onChange={(event) => setScheduledTime(event.target.value)}
                />
              </label>
            ) : null}
          </div>

          {showExactScheduleTimeField ? (
            <SelfCareReminderOffsetsField
              value={reminderOffsetsMinutes}
              onChange={setReminderOffsetsMinutes}
            />
          ) : null}
        </>
      ) : null}

      {showCourseExactTimeField ? (
        <>
          <div
            className={cx(styles.createFormGrid, styles.createFormGridSingle)}
          >
            <label className={styles.dateField}>
              <span>{getExactScheduleTimeLabel(entry.item.type)}</span>
              <input
                type="time"
                required
                value={scheduledTime}
                onChange={(event) => setScheduledTime(event.target.value)}
              />
            </label>
          </div>

          <SelfCareReminderOffsetsField
            value={reminderOffsetsMinutes}
            onChange={setReminderOffsetsMinutes}
          />
        </>
      ) : null}

      {entry.item.type === 'course' ? (
        <>
          <div className={styles.createFormGrid}>
            <label className={styles.dateField}>
              <span>Длина курса</span>
              <input
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                required
                value={courseTotalCount}
                onChange={(event) => setCourseTotalCount(event.target.value)}
              />
            </label>

            <SelectPicker<SelfCareCourseType>
              className={styles.selectField}
              label="Единица курса"
              value={courseType}
              options={COURSE_TYPE_SELECT_OPTIONS}
              onChange={setCourseType}
            />
          </div>

          <div className={styles.createFormGrid}>
            <SelectPicker<SelfCareCourseRepeatMode>
              className={styles.selectField}
              label="Повтор курса"
              value={courseRepeatMode}
              options={COURSE_REPEAT_SELECT_OPTIONS}
              onChange={setCourseRepeatMode}
            />

            {courseRepeatMode === 'cycle' ? (
              <label className={styles.dateField}>
                <span>Перерыв, дней</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  required
                  value={courseBreakDays}
                  onChange={(event) => setCourseBreakDays(event.target.value)}
                />
              </label>
            ) : null}
          </div>
        </>
      ) : null}

      {entry.item.type === 'ritual' ? (
        <label className={styles.dateField}>
          <span>Шаги ритуала</span>
          <textarea
            rows={4}
            maxLength={800}
            placeholder={'Умыться\nКрем\nSPF'}
            value={stepsText}
            onChange={(event) => setStepsText(event.target.value)}
          />
        </label>
      ) : null}

      {canStoreVisitDetails ? (
        <SelfCareVisitDetailsFields
          contact={procedureContact}
          place={procedurePlace}
          price={procedurePrice}
          specialist={procedureSpecialist}
          onChangeContact={setProcedureContact}
          onChangePlace={setProcedurePlace}
          onChangePrice={setProcedurePrice}
          onChangeSpecialist={setProcedureSpecialist}
        />
      ) : null}

      {entry.item.type === 'measurement' ? (
        <div className={styles.createFormGrid}>
          <label className={styles.dateField}>
            <span>Что измеряем</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={80}
              required
              value={measurementValueLabel}
              onChange={(event) => setMeasurementValueLabel(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Единица</span>
            <input
              type="text"
              autoComplete="off"
              maxLength={32}
              required
              value={measurementUnit}
              onChange={(event) => setMeasurementUnit(event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {entry.item.type === 'exercise' ? (
        <div className={styles.exerciseFields}>
          <SelectPicker<string>
            className={styles.selectField}
            label="Что отслеживаем"
            value={exerciseMetricValue}
            options={EXERCISE_METRIC_SELECT_OPTIONS}
            onChange={setExerciseMetricValue}
          />

          <label className={styles.toggleField}>
            <input
              type="checkbox"
              checked={exerciseUseSets}
              onChange={(event) => setExerciseUseSets(event.target.checked)}
            />
            <span>Использовать подходы</span>
          </label>

          <div className={styles.createFormGrid}>
            <label className={styles.dateField}>
              <span>Плановое значение</span>
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={exercisePlannedValue}
                onChange={(event) =>
                  setExercisePlannedValue(event.target.value)
                }
              />
            </label>

            {exerciseUseSets ? (
              <label className={styles.dateField}>
                <span>Плановое количество подходов</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  required
                  value={exercisePlannedSets}
                  onChange={(event) =>
                    setExercisePlannedSets(event.target.value)
                  }
                />
              </label>
            ) : null}
          </div>
        </div>
      ) : null}

      <label className={styles.dateField}>
        <span>Описание</span>
        <textarea
          rows={3}
          maxLength={1200}
          placeholder="Можно оставить пустым"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className={styles.modalActions}>
        <button
          className={styles.softButton}
          type="button"
          disabled={isBusy}
          onClick={onCancel}
        >
          Отмена
        </button>
        <button
          className={styles.doneButton}
          type="submit"
          disabled={isBusy || !canSubmit}
        >
          Сохранить
        </button>
      </div>
    </form>
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
    | ((entry: SelfCareTodayItem, stepId: string) => void)
    | undefined
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
