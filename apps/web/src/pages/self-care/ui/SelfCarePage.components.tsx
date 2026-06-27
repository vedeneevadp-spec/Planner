import type {
  SelfCareCategory,
  SelfCareCompletionInput,
  SelfCareFlexiblePeriod,
  SelfCareIntervalUnit,
  SelfCareItemScheduleInput,
  SelfCareItemType,
  SelfCareItemUpdateInput,
  SelfCareListResponse,
  SelfCareTemplate,
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
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  GearIcon,
  getIconLabel,
  IconChoicePicker,
  IconMark,
  TrashIcon,
  type UploadedIconAsset,
} from '@/shared/ui/Icon'
import { SelectPicker, type SelectPickerOption } from '@/shared/ui/SelectPicker'

import {
  areNumberArraysEqual,
  canUseExactTimePreference,
  getClientTimeZone,
  getInitialReminderOffsets,
  getReminderOffsetsFromSelectValue,
  getReminderSelectValue,
  getTimePreferenceOptions,
  hasStoredExactTimePreference,
  SELF_CARE_REMINDER_CLEAR_VALUE,
  SELF_CARE_REMINDER_SELECT_OPTIONS,
  shouldShowExactScheduleTimeField,
  shouldShowPreferredTimePreference,
} from './SelfCarePage.form-model'
import {
  ADD_CARE_TEMPLATE_FILTERS,
  type AddCareTemplateFilter,
  buildCreateScheduleRule,
  buildDateTimeInput,
  buildRestartCourseScheduleRule,
  canRestartCourse,
  CATEGORY_LABELS,
  CATEGORY_SELECT_OPTIONS,
  COURSE_REPEAT_SELECT_OPTIONS,
  COURSE_SCHEDULE_SELECT_OPTIONS,
  COURSE_TYPE_SELECT_OPTIONS,
  FLEXIBLE_GOAL_REPEAT_SELECT_OPTIONS,
  FLEXIBLE_PERIOD_SELECT_OPTIONS,
  formatCompletionState,
  formatCourseCompletionState,
  formatDate,
  formatEntryDetails,
  formatMeasurementSummary,
  formatMeasurementTarget,
  formatMeasurementValue,
  formatOptionalNumber,
  formatPlanningText,
  formatSchedule,
  formatStateCompletionSummary,
  formatStateSummary,
  formatTime,
  formatTomorrowPlanSummary,
  getAddCareFilterCategories,
  getAddCareFilterLabel,
  getCourseProgress,
  getCourseUnitLabel,
  getCourseVisibleRepeatKind,
  getCreateScheduleRepeatKind,
  getDefaultFlexibleGoalIntervalUnit,
  getDefaultFlexibleGoalRepeatKind,
  getEffectiveRitualStepIds,
  getExactScheduleDateLabel,
  getExactScheduleTimeLabel,
  getInitialEditRepeatMode,
  getInitialFlexibleGoalRepeatMode,
  getInitialMeasurementValue,
  getInitialScheduleDate,
  getInitialScheduleTime,
  getPrimaryActionLabel,
  getRitualStepDraft,
  getSelfCareEntryTimeZone,
  getSelfCareTodayCardActionOrder,
  getTemplateTypeLabel,
  getTodayScheduleLabel,
  getTypeLabel,
  getVisibleRepeatKind,
  groupItemsByCategory,
  groupTodayItems,
  INTERVAL_UNIT_SELECT_OPTIONS,
  normalizeOptionalText,
  parseBoundedInteger,
  parseMultilineTitles,
  parseNonnegativeInteger,
  parseOptionalPrice,
  parsePositiveInteger,
  parseRequiredMeasurementNumber,
  repeatKindRequiresInterval,
  type RitualStepDrafts,
  type SelfCareCourseEditScheduleMode,
  type SelfCareCourseRepeatMode,
  type SelfCareCourseRestartPayload,
  type SelfCareCourseScheduleMode,
  type SelfCareCourseType,
  type SelfCareCreateDialogMode,
  type SelfCareCreateRepeatKind,
  type SelfCareCustomCreatePayload,
  type SelfCareEditRepeatMode,
  type SelfCareEditSubmitPayload,
  type SelfCareStandardRepeatKind,
  type SelfCareTimePreference,
  shouldShowSelfCareSkipAction,
  shouldShowVisitDetails,
  shouldUseExactSchedule,
  STANDARD_REPEAT_SELECT_OPTIONS,
  STATUS_LABELS,
  TIME_GROUP_LABELS,
  toggleWeekday,
  VISIBLE_CATEGORY_LABELS,
  type VisibleSelfCareCategory,
  WEEKDAY_OPTIONS,
} from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'
import {
  addIntervalDateKey,
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
  shiftDateKey,
  shouldShowTodayEntry,
} from './SelfCarePage.schedule'
import { SelfCareSection } from './SelfCarePage.sections'

export { SelfCareAnalyticsTab } from './SelfCarePage.analytics'
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
]

const CREATE_TYPE_SELECT_OPTIONS: Array<SelectPickerOption<SelfCareItemType>> =
  CREATE_TYPE_OPTIONS.map(({ label, value }) => ({ label, value }))

const SELF_CARE_ICON_PICKER_OPEN_DATA_KEY = 'selfCareIconPickerOpen'

const ADD_CARE_TEMPLATE_TILE_CLASS_NAMES: Record<
  AddCareTemplateFilter,
  string | undefined
> = {
  beauty: styles.addCareCategoryBeauty,
  health: styles.addCareCategoryHealth,
  movement: styles.addCareCategoryMovement,
  rest: styles.addCareCategoryRest,
}

function isSelfCareIconPickerOpen(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.body.dataset[SELF_CARE_ICON_PICKER_OPEN_DATA_KEY] === 'true'
  )
}

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
  const overdueItems = dashboard.overdueItems.filter(shouldShowTodayEntry)
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
              const entry = mergeLatestProgressCompletion(
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
        return (
          <article key={completion.id} className={styles.historyCard}>
            <time>{formatDate(completion.completedAt.slice(0, 10))}</time>
            <div>
              <h3>{item?.title ?? 'Забота о себе'}</h3>
              <p>{STATUS_LABELS[completion.status]}</p>
              {completion.measurementValue !== null ? (
                <p className={styles.measurementHistoryValue}>
                  {formatMeasurementValue(
                    completion.measurementValue,
                    completion.measurementUnit,
                  )}
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
        <span className={styles.cardIconPlaceholder}>♡</span>
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

export function SelfCareCreateDialog({
  defaultCurrency,
  disabledTemplateIds,
  errorMessage,
  isBusy,
  mode,
  onBack,
  onClose,
  onCreateCustom,
  onCreateFromTemplate,
  onSelectCustom,
  onSelectTemplate,
  templates,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  disabledTemplateIds: ReadonlySet<string>
  errorMessage: string | null
  isBusy: boolean
  mode: SelfCareCreateDialogMode
  onBack: () => void
  onClose: () => void
  onCreateCustom: (payload: SelfCareCustomCreatePayload) => void
  onCreateFromTemplate: (templateId: string) => void
  onSelectCustom: () => void
  onSelectTemplate: () => void
  templates: SelfCareTemplate[]
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  const [templateFilter, setTemplateFilter] =
    useState<AddCareTemplateFilter | null>(null)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (isSelfCareIconPickerOpen()) {
          return
        }

        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  const heading =
    mode === 'template'
      ? templateFilter
        ? `Шаблоны: ${getAddCareFilterLabel(templateFilter)}`
        : 'Выбрать из шаблона'
      : mode === 'custom'
        ? 'Создать свою заботу'
        : 'Добавить заботу'
  const filteredTemplates = templateFilter
    ? templates.filter((template) =>
        getAddCareFilterCategories(templateFilter).includes(template.category),
      )
    : templates

  function openTemplatePicker(filter: AddCareTemplateFilter | null): void {
    setTemplateFilter(filter)
    onSelectTemplate()
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-care-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть добавление заботы"
        onClick={onClose}
      />

      <section
        className={cx(
          styles.modalPanel,
          mode === 'choice' && styles.addCareChoicePanel,
        )}
      >
        <div className={styles.modalHeader}>
          <div>
            <h2 id="add-care-title">{heading}</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть добавление заботы"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        {mode !== 'choice' ? (
          <button
            className={styles.backLinkButton}
            type="button"
            disabled={isBusy}
            onClick={onBack}
          >
            <ChevronLeftIcon size={17} strokeWidth={2.2} />
            Назад к выбору
          </button>
        ) : null}

        {errorMessage ? (
          <p className={styles.errorText}>{errorMessage}</p>
        ) : null}

        {mode === 'choice' ? (
          <div className={styles.addCareChoiceContent}>
            <div className={styles.createChoiceGrid}>
              <button
                className={cx(
                  styles.createChoiceCard,
                  styles.addCareCreateCard,
                )}
                type="button"
                disabled={isBusy}
                onClick={onSelectCustom}
              >
                <strong>Создать свою</strong>
                <span className={styles.addCareChoiceText}>
                  Для ухода, процедуры, медицинского напоминания или регулярной
                  заботы.
                </span>
              </button>
              <section
                className={cx(
                  styles.createChoiceCard,
                  styles.addCareTemplateCard,
                )}
                aria-labelledby="add-care-template-title"
              >
                <button
                  className={styles.addCareTemplateMainButton}
                  type="button"
                  disabled={isBusy}
                  onClick={() => openTemplatePicker(null)}
                >
                  <span className={styles.addCareTemplateCopy}>
                    <strong id="add-care-template-title">
                      Выбрать из шаблона
                    </strong>
                    <span className={styles.addCareChoiceText}>
                      Готовые идеи для ухода, здоровья и восстановления.
                    </span>
                  </span>
                  <span
                    className={styles.addCareArrowButton}
                    aria-hidden="true"
                  >
                    <ChevronRightIcon size={18} strokeWidth={2.15} />
                  </span>
                </button>
                <div
                  className={styles.addCareCategoryGrid}
                  aria-label="Категории шаблонов"
                >
                  {ADD_CARE_TEMPLATE_FILTERS.map((filter) => (
                    <button
                      key={filter.value}
                      className={cx(
                        styles.addCareCategoryButton,
                        ADD_CARE_TEMPLATE_TILE_CLASS_NAMES[filter.value],
                      )}
                      type="button"
                      disabled={isBusy}
                      onClick={() => openTemplatePicker(filter.value)}
                    >
                      <span>{filter.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </div>
        ) : null}

        {mode === 'custom' ? (
          <SelfCareCustomCreateForm
            defaultCurrency={defaultCurrency}
            isBusy={isBusy}
            todayKey={todayKey}
            uploadedIcons={uploadedIcons}
            onCreate={onCreateCustom}
          />
        ) : null}

        {mode === 'template' ? (
          filteredTemplates.length ? (
            <div className={styles.templateGrid}>
              {filteredTemplates.slice(0, 12).map((template) => {
                const isTemplateDisabled = disabledTemplateIds.has(template.id)

                return (
                  <button
                    key={template.id}
                    className={styles.templateCard}
                    type="button"
                    disabled={isBusy || isTemplateDisabled}
                    onClick={() => onCreateFromTemplate(template.id)}
                  >
                    <strong>{template.title}</strong>
                    <span>
                      {CATEGORY_LABELS[template.category]} ·{' '}
                      {getTemplateTypeLabel(template)}
                      {isTemplateDisabled ? ' · уже добавлено' : ''}
                    </span>
                    <p>
                      {template.description ||
                        'Можно добавить и настроить под себя.'}
                    </p>
                  </button>
                )
              })}
            </div>
          ) : (
            <p className={styles.mutedText}>Шаблоны загружаются.</p>
          )
        ) : null}
      </section>
    </div>,
    document.body,
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
            <span className={styles.iconSelectButtonPlaceholder}>♡</span>
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

function SelfCareReminderOffsetsField({
  disabled,
  value,
  onChange,
}: {
  disabled?: boolean | undefined
  value: readonly number[]
  onChange: (value: number[]) => void
}) {
  const selectValue = getReminderSelectValue(value)

  function handleChange(nextValue: string[]): void {
    onChange(getReminderOffsetsFromSelectValue(nextValue))
  }

  return (
    <SelectPicker
      className={styles.selectField}
      label="Напомнить"
      multiple
      clearValue={SELF_CARE_REMINDER_CLEAR_VALUE}
      disabled={disabled}
      value={selectValue}
      options={SELF_CARE_REMINDER_SELECT_OPTIONS}
      onChange={handleChange}
    />
  )
}

function SelfCareCustomCreateForm({
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
  const [stepsText, setStepsText] = useState('')
  const selectedType = CREATE_TYPE_OPTIONS.find(
    (option) => option.value === type,
  )
  const showPreferredTimePreference = shouldShowPreferredTimePreference(type)
  const usesExactTimePreference =
    canUseExactTimePreference(type) && preferredTimePreference === 'exact'
  const showExactScheduleTimeField = shouldShowExactScheduleTimeField(
    type,
    usesExactTimePreference,
  )
  const showCourseExactTimeField = type === 'course' && usesExactTimePreference
  const intervalNumber = parsePositiveInteger(intervalValue)
  const flexibleTargetNumber = parsePositiveInteger(flexibleTargetCount)
  const courseTotalNumber = parsePositiveInteger(courseTotalCount)
  const courseBreakDaysNumber = parseNonnegativeInteger(courseBreakDays)
  const preferredTimeOfDay =
    showPreferredTimePreference && preferredTimePreference !== 'exact'
      ? preferredTimePreference
      : null
  const usesExactSchedule = shouldUseExactSchedule(type)
  const dayOfMonthNumber = parseBoundedInteger(dayOfMonth, 1, 31)
  const monthOfYearNumber = parseBoundedInteger(monthOfYear, 1, 12)
  const scheduleRepeatKind = getCreateScheduleRepeatKind(type, repeatKind)
  const visibleRepeatKind = getVisibleRepeatKind(type, repeatKind, {
    courseScheduleMode,
  })
  const needsInterval =
    repeatKindRequiresInterval(scheduleRepeatKind) ||
    (type === 'course' && courseScheduleMode === 'interval')
  const usesFlexibleGoalRepeat = type === 'flexible_goal'
  const canSubmit =
    title.trim().length > 0 &&
    (!needsInterval || Boolean(intervalNumber)) &&
    (usesFlexibleGoalRepeat ||
      visibleRepeatKind !== 'weekly' ||
      daysOfWeek.length > 0) &&
    (usesFlexibleGoalRepeat ||
      visibleRepeatKind !== 'monthly' ||
      Boolean(dayOfMonthNumber)) &&
    (usesFlexibleGoalRepeat ||
      visibleRepeatKind !== 'yearly' ||
      (Boolean(dayOfMonthNumber) && Boolean(monthOfYearNumber))) &&
    (type !== 'flexible_goal' || Boolean(flexibleTargetNumber)) &&
    (type !== 'course' || Boolean(courseTotalNumber)) &&
    (type !== 'course' ||
      courseRepeatMode !== 'cycle' ||
      courseBreakDaysNumber !== null) &&
    (!usesExactSchedule || scheduledDate.length > 0) &&
    (!usesExactTimePreference || scheduledTime.length > 0) &&
    (!(usesExactSchedule && showExactScheduleTimeField) ||
      reminderOffsetsMinutes.length === 0 ||
      scheduledTime.length > 0) &&
    (type !== 'measurement' || measurementUnit.trim().length > 0)

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
  }

  return (
    <form
      className={styles.createForm}
      onSubmit={(event) => {
        event.preventDefault()

        if (!canSubmit) {
          return
        }

        const detailsPriceValue = parseOptionalPrice(detailsPrice)
        const defaultDetailsCurrency = normalizeOptionalText(defaultCurrency)
        const normalizedScheduledTime = normalizeOptionalText(scheduledTime)
        const normalizedExactTime = usesExactTimePreference
          ? normalizedScheduledTime
          : null
        const reminderTimeZone = getClientTimeZone(plannerTimeZone)
        const reminderOffsetsForExactTime = normalizedExactTime
          ? reminderOffsetsMinutes
          : []
        const canStoreVisitDetails = shouldShowVisitDetails(type)
        const scheduleRule =
          type === 'task' && scheduleRepeatKind === 'none'
            ? undefined
            : buildCreateScheduleRule({
                courseScheduleMode:
                  type === 'course' ? courseScheduleMode : undefined,
                dayOfMonth: dayOfMonthNumber ?? getDatePart(todayKey, 'day'),
                daysOfWeek,
                flexiblePeriod,
                flexibleTargetCount: flexibleTargetNumber ?? 1,
                hasFlexibleGoal: type === 'flexible_goal',
                intervalUnit,
                intervalValue: intervalNumber ?? 1,
                monthOfYear:
                  monthOfYearNumber ?? getDatePart(todayKey, 'month'),
                preferredTime: normalizedExactTime,
                reminderOffsetsMinutes: reminderOffsetsForExactTime,
                repeatKind: scheduleRepeatKind,
                startDate: usesExactSchedule ? scheduledDate : todayKey,
                timezone: reminderTimeZone,
              })
        const scheduledStartsAt = buildDateTimeInput(
          scheduledDate,
          normalizedScheduledTime,
          reminderTimeZone,
        )

        onCreate({
          input: {
            alternatives: [],
            appointmentDetails:
              type === 'appointment'
                ? {
                    currency:
                      detailsPriceValue === null
                        ? null
                        : defaultDetailsCurrency,
                    endsAt: null,
                    place: normalizeOptionalText(detailsPlace),
                    preparationNote: null,
                    price: detailsPriceValue,
                    resultNote: null,
                    specialistContact: normalizeOptionalText(detailsContact),
                    specialistName: normalizeOptionalText(detailsSpecialist),
                    startsAt: scheduledStartsAt,
                  }
                : undefined,
            category,
            color: null,
            courseDetails:
              type === 'course'
                ? {
                    breakDays:
                      courseRepeatMode === 'cycle'
                        ? (courseBreakDaysNumber ?? 0)
                        : 0,
                    completedCount: 0,
                    courseType,
                    endDate: null,
                    isCompleted: false,
                    isPaused: false,
                    repeatAfterCompletion: courseRepeatMode === 'cycle',
                    startDate: todayKey,
                    totalCount: courseTotalNumber ?? 1,
                  }
                : undefined,
            customCategoryId: null,
            defaultDurationMinutes: null,
            description: description.trim(),
            icon: normalizeOptionalText(icon),
            importance: 'recommended',
            isActive: true,
            isArchived: false,
            isPrivate: true,
            medicalDetails:
              type === 'medical'
                ? {
                    analysisList: [],
                    clinicAddress: normalizeOptionalText(detailsPlace),
                    clinicName: null,
                    documentUrls: [],
                    doctorName: normalizeOptionalText(detailsSpecialist),
                    nextControlDate: scheduledDate || null,
                    phone: normalizeOptionalText(detailsContact),
                    reminderStrategy: 'soft',
                    resultNote: null,
                    website: null,
                  }
                : undefined,
            measurementDetails:
              type === 'measurement'
                ? {
                    targetMax: null,
                    targetMin: null,
                    unit: measurementUnit.trim(),
                    valueLabel: measurementValueLabel.trim() || 'Значение',
                  }
                : undefined,
            migratedFromHabitId: null,
            preferredTimeOfDay,
            procedureDetails:
              type === 'procedure'
                ? {
                    contact: normalizeOptionalText(detailsContact),
                    currency: defaultDetailsCurrency,
                    defaultPrice: detailsPriceValue,
                    place: normalizeOptionalText(detailsPlace),
                    specialistName: normalizeOptionalText(detailsSpecialist),
                  }
                : undefined,
            scheduleRule,
            steps:
              type === 'ritual'
                ? parseMultilineTitles(stepsText).map((stepTitle, index) => ({
                    defaultChecked: false,
                    isOptional: false,
                    order: index,
                    title: stepTitle,
                  }))
                : [],
            title: title.trim(),
            type,
          },
          scheduleInput: usesExactSchedule
            ? {
                currency:
                  !canStoreVisitDetails || detailsPriceValue === null
                    ? null
                    : defaultDetailsCurrency,
                note: '',
                place: canStoreVisitDetails
                  ? normalizeOptionalText(detailsPlace)
                  : null,
                price: canStoreVisitDetails ? detailsPriceValue : null,
                reminderOffsetsMinutes:
                  showExactScheduleTimeField && normalizedScheduledTime
                    ? reminderOffsetsMinutes
                    : [],
                scheduledFor: scheduledDate,
                scheduledTime: showExactScheduleTimeField
                  ? normalizedScheduledTime
                  : null,
                specialistContact: canStoreVisitDetails
                  ? normalizeOptionalText(detailsContact)
                  : null,
                specialistName: canStoreVisitDetails
                  ? normalizeOptionalText(detailsSpecialist)
                  : null,
                timezone: reminderTimeZone,
              }
            : undefined,
        })
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

export function SelfCareEditDialog({
  defaultCurrency,
  entry,
  errorMessage,
  isBusy,
  onClose,
  onSubmit,
  todayKey,
  uploadedIcons,
}: {
  defaultCurrency: string
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onClose: () => void
  onSubmit: (payload: SelfCareEditSubmitPayload) => void
  todayKey: string
  uploadedIcons: UploadedIconAsset[]
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (isSelfCareIconPickerOpen()) {
          return
        }

        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-edit-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть настройки заботы"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-edit-title">Настроить заботу</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть настройки заботы"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        {errorMessage ? (
          <p className={styles.errorText}>{errorMessage}</p>
        ) : null}

        <SelfCareEditForm
          defaultCurrency={defaultCurrency}
          entry={entry}
          isBusy={isBusy}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onCancel={onClose}
          onSubmit={onSubmit}
        />
      </section>
    </div>,
    document.body,
  )
}

function SelfCareEditForm({
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
  const intervalNumber = parsePositiveInteger(intervalValue)
  const flexibleTargetNumber = parsePositiveInteger(flexibleTargetCount)
  const courseTotalNumber = parsePositiveInteger(courseTotalCount)
  const courseBreakDaysNumber = parseNonnegativeInteger(courseBreakDays)
  const showPreferredTimePreference = shouldShowPreferredTimePreference(
    entry.item.type,
  )
  const usesExactTimePreference =
    canUseExactTimePreference(entry.item.type) &&
    preferredTimePreference === 'exact'
  const showExactScheduleTimeField = shouldShowExactScheduleTimeField(
    entry.item.type,
    usesExactTimePreference,
  )
  const showCourseExactTimeField =
    entry.item.type === 'course' && usesExactTimePreference
  const preferredTimeOfDay =
    showPreferredTimePreference && preferredTimePreference !== 'exact'
      ? preferredTimePreference
      : null
  const dayOfMonthNumber = parseBoundedInteger(dayOfMonth, 1, 31)
  const monthOfYearNumber = parseBoundedInteger(monthOfYear, 1, 12)
  const selectedRepeatKind = repeatMode === 'keep' ? null : repeatMode
  const selectedCourseScheduleMode =
    courseScheduleMode === 'keep' ? null : courseScheduleMode
  const isFlexibleGoal = entry.item.type === 'flexible_goal'
  const usesFlexibleGoalRepeat = entry.item.type === 'flexible_goal'
  const editVisibleRepeatKind = selectedCourseScheduleMode
    ? getCourseVisibleRepeatKind(selectedCourseScheduleMode)
    : selectedRepeatKind
  const usesExactSchedule = shouldUseExactSchedule(entry.item.type)
  const canStoreVisitDetails = shouldShowVisitDetails(entry.item.type)
  const canSubmit =
    title.trim().length > 0 &&
    (!usesExactSchedule || scheduledDate.length > 0) &&
    (!editVisibleRepeatKind ||
      ((!(
        repeatKindRequiresInterval(editVisibleRepeatKind) ||
        selectedCourseScheduleMode === 'interval'
      ) ||
        Boolean(intervalNumber)) &&
        (usesFlexibleGoalRepeat ||
          editVisibleRepeatKind !== 'weekly' ||
          daysOfWeek.length > 0) &&
        (usesFlexibleGoalRepeat ||
          editVisibleRepeatKind !== 'monthly' ||
          Boolean(dayOfMonthNumber)) &&
        (usesFlexibleGoalRepeat ||
          editVisibleRepeatKind !== 'yearly' ||
          (Boolean(dayOfMonthNumber) && Boolean(monthOfYearNumber))) &&
        (entry.item.type !== 'flexible_goal' ||
          Boolean(flexibleTargetNumber)))) &&
    (!isFlexibleGoal || Boolean(flexibleTargetNumber)) &&
    (entry.item.type !== 'course' || Boolean(courseTotalNumber)) &&
    (entry.item.type !== 'course' ||
      courseRepeatMode !== 'cycle' ||
      courseBreakDaysNumber !== null) &&
    (!usesExactTimePreference || scheduledTime.length > 0) &&
    (!(usesExactSchedule && showExactScheduleTimeField) ||
      reminderOffsetsMinutes.length === 0 ||
      scheduledTime.length > 0) &&
    (entry.item.type !== 'measurement' || measurementUnit.trim().length > 0)

  return (
    <form
      className={styles.createForm}
      onSubmit={(event) => {
        event.preventDefault()

        if (!canSubmit) {
          return
        }

        const detailsPriceValue = parseOptionalPrice(procedurePrice)
        const normalizedProcedureCurrency =
          normalizeOptionalText(procedureCurrency)
        const normalizedScheduledTime = normalizeOptionalText(scheduledTime)
        const normalizedExactTime = usesExactTimePreference
          ? normalizedScheduledTime
          : null
        const reminderOffsetsForExactTime = normalizedExactTime
          ? reminderOffsetsMinutes
          : []
        const reminderTimeZone = getClientTimeZone(plannerTimeZone)
        const input: SelfCareItemUpdateInput = {
          category,
          description: description.trim(),
          expectedVersion: entry.item.version,
          icon: normalizeOptionalText(icon),
          minimumVersion: null,
          preferredTimeOfDay,
          title: title.trim(),
        }

        if (entry.item.type === 'course' && selectedCourseScheduleMode) {
          input.scheduleRule = buildCreateScheduleRule({
            courseScheduleMode: selectedCourseScheduleMode,
            dayOfMonth: dayOfMonthNumber ?? getDatePart(todayKey, 'day'),
            daysOfWeek,
            flexiblePeriod,
            flexibleTargetCount: flexibleTargetNumber ?? 1,
            hasFlexibleGoal: false,
            intervalUnit,
            intervalValue: intervalNumber ?? 1,
            monthOfYear: monthOfYearNumber ?? getDatePart(todayKey, 'month'),
            preferredTime: normalizedExactTime,
            reminderOffsetsMinutes: reminderOffsetsForExactTime,
            repeatKind: 'course',
            startDate: entry.scheduleRule?.startDate ?? todayKey,
            timezone: reminderTimeZone,
          })
        } else if (entry.item.type === 'flexible_goal') {
          const flexibleRepeatKind =
            selectedRepeatKind ??
            (entry.scheduleRule?.repeatKind === 'flexible_goal'
              ? 'flexible_goal'
              : getInitialFlexibleGoalRepeatMode(entry.scheduleRule))
          input.isActive = true
          input.scheduleRule = buildCreateScheduleRule({
            dayOfMonth: dayOfMonthNumber ?? getDatePart(todayKey, 'day'),
            daysOfWeek,
            flexiblePeriod,
            flexibleTargetCount: flexibleTargetNumber ?? 1,
            hasFlexibleGoal: true,
            intervalUnit,
            intervalValue: intervalNumber ?? 1,
            monthOfYear: monthOfYearNumber ?? getDatePart(todayKey, 'month'),
            repeatKind: flexibleRepeatKind,
            startDate: entry.scheduleRule?.startDate ?? todayKey,
          })
        } else if (selectedRepeatKind) {
          input.scheduleRule = buildCreateScheduleRule({
            dayOfMonth: dayOfMonthNumber ?? getDatePart(todayKey, 'day'),
            daysOfWeek,
            flexiblePeriod,
            flexibleTargetCount: flexibleTargetNumber ?? 1,
            hasFlexibleGoal: false,
            intervalUnit,
            intervalValue: intervalNumber ?? 1,
            monthOfYear: monthOfYearNumber ?? getDatePart(todayKey, 'month'),
            preferredTime: normalizedExactTime,
            reminderOffsetsMinutes: reminderOffsetsForExactTime,
            repeatKind: selectedRepeatKind,
            startDate: usesExactSchedule
              ? scheduledDate
              : (entry.scheduleRule?.startDate ?? todayKey),
            timezone: reminderTimeZone,
          })
        }

        if (
          canUseExactTimePreference(entry.item.type) &&
          !selectedRepeatKind &&
          !(entry.item.type === 'course' && selectedCourseScheduleMode) &&
          entry.scheduleRule &&
          ((entry.scheduleRule?.preferredTime ?? null) !==
            normalizedExactTime ||
            !areNumberArraysEqual(
              entry.scheduleRule?.reminderOffsetsMinutes ?? [],
              reminderOffsetsForExactTime,
            ))
        ) {
          input.scheduleRule = {
            allowMultiplePerDay:
              entry.scheduleRule?.allowMultiplePerDay ?? false,
            dayOfMonth: entry.scheduleRule?.dayOfMonth ?? null,
            daysOfWeek: entry.scheduleRule?.daysOfWeek ?? [],
            endDate: entry.scheduleRule?.endDate ?? null,
            flexiblePeriod: entry.scheduleRule?.flexiblePeriod ?? null,
            flexibleTargetCount:
              entry.scheduleRule?.flexibleTargetCount ?? null,
            generateInCalendar: entry.scheduleRule?.generateInCalendar ?? false,
            generateInTaskList: entry.scheduleRule?.generateInTaskList ?? true,
            intervalUnit: entry.scheduleRule?.intervalUnit ?? null,
            intervalValue: entry.scheduleRule?.intervalValue ?? null,
            monthOfYear: entry.scheduleRule?.monthOfYear ?? null,
            preferredTime: normalizedExactTime,
            reminderOffsetsMinutes: reminderOffsetsForExactTime,
            repeatKind: entry.scheduleRule?.repeatKind ?? 'daily',
            startDate: entry.scheduleRule?.startDate ?? scheduledDate,
            timezone: reminderTimeZone ?? entry.scheduleRule?.timezone ?? null,
            weekOfMonth: entry.scheduleRule?.weekOfMonth ?? null,
          }
        }

        if (entry.item.type === 'ritual') {
          input.steps = parseMultilineTitles(stepsText).map(
            (stepTitle, index) => ({
              defaultChecked: false,
              isOptional: false,
              order: index,
              title: stepTitle,
            }),
          )
        }

        if (entry.item.type === 'course') {
          input.courseDetails = {
            breakDays:
              courseRepeatMode === 'cycle' ? (courseBreakDaysNumber ?? 0) : 0,
            completedCount: entry.courseDetails?.completedCount ?? 0,
            courseType,
            endDate: entry.courseDetails?.endDate ?? null,
            isCompleted: entry.courseDetails?.isCompleted ?? false,
            isPaused: entry.courseDetails?.isPaused ?? false,
            repeatAfterCompletion: courseRepeatMode === 'cycle',
            startDate:
              entry.courseDetails?.startDate ??
              entry.scheduleRule?.startDate ??
              todayKey,
            totalCount:
              courseTotalNumber ?? entry.courseDetails?.totalCount ?? 1,
          }
        }

        if (entry.item.type === 'procedure') {
          input.procedureDetails = {
            contact: normalizeOptionalText(procedureContact),
            currency: normalizedProcedureCurrency,
            defaultPrice: detailsPriceValue,
            place: normalizeOptionalText(procedurePlace),
            specialistName: normalizeOptionalText(procedureSpecialist),
          }
        }

        if (entry.item.type === 'measurement') {
          input.measurementDetails = {
            targetMax: null,
            targetMin: null,
            unit: measurementUnit.trim(),
            valueLabel: measurementValueLabel.trim() || 'Значение',
          }
        }

        onSubmit({
          input,
          scheduleInput: usesExactSchedule
            ? {
                currency:
                  !canStoreVisitDetails || detailsPriceValue === null
                    ? null
                    : normalizedProcedureCurrency,
                note: canStoreVisitDetails
                  ? (entry.appointment?.preparationNote ?? '')
                  : '',
                place: canStoreVisitDetails
                  ? normalizeOptionalText(procedurePlace)
                  : null,
                price: canStoreVisitDetails ? detailsPriceValue : null,
                reminderOffsetsMinutes:
                  showExactScheduleTimeField && normalizedScheduledTime
                    ? reminderOffsetsMinutes
                    : [],
                scheduledFor: scheduledDate,
                scheduledTime: showExactScheduleTimeField
                  ? normalizedScheduledTime
                  : null,
                specialistContact: canStoreVisitDetails
                  ? normalizeOptionalText(procedureContact)
                  : null,
                specialistName: canStoreVisitDetails
                  ? normalizeOptionalText(procedureSpecialist)
                  : null,
                timezone: reminderTimeZone,
              }
            : undefined,
        })
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

export function SelfCareCourseRestartDialog({
  entry,
  errorMessage,
  isBusy,
  onClose,
  onSubmit,
  todayKey,
}: {
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onClose: () => void
  onSubmit: (payload: SelfCareCourseRestartPayload) => void
  todayKey: string
}) {
  const [restartMode, setRestartMode] = useState<'now' | 'delay'>('now')
  const [intervalValue, setIntervalValue] = useState('1')
  const [intervalUnit, setIntervalUnit] =
    useState<SelfCareIntervalUnit>('month')
  const intervalNumber = parsePositiveInteger(intervalValue)
  const restartDate =
    restartMode === 'now'
      ? todayKey
      : intervalNumber
        ? addIntervalDateKey(todayKey, intervalNumber, intervalUnit)
        : ''
  const course = entry.courseDetails
  const canSubmit = Boolean(course && restartDate)

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined' || !course) {
    return null
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-course-restart-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть повтор курса"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-course-restart-title">Повторить курс</h2>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть повтор курса"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <form
          className={styles.scheduleForm}
          onSubmit={(event) => {
            event.preventDefault()

            if (!canSubmit) {
              return
            }

            onSubmit({
              input: {
                courseDetails: {
                  breakDays: course.breakDays,
                  completedCount: 0,
                  courseType: course.courseType,
                  endDate: null,
                  isCompleted: false,
                  isPaused: false,
                  repeatAfterCompletion: course.repeatAfterCompletion,
                  startDate: restartDate,
                  totalCount: course.totalCount,
                },
                expectedVersion: entry.item.version,
                scheduleRule: buildRestartCourseScheduleRule(
                  entry,
                  restartDate,
                ),
              },
              restartDate,
            })
          }}
        >
          <div className={styles.scheduleTarget}>
            <strong>{entry.item.title}</strong>
            <span>
              {course.totalCount}{' '}
              {getCourseUnitLabel(course.courseType, course.totalCount)}
            </span>
          </div>

          <div
            className={styles.quickDateGrid}
            role="group"
            aria-label="Когда повторить курс"
          >
            <button
              className={cx(
                styles.quickDateButton,
                restartMode === 'now' && styles.quickDateButtonActive,
              )}
              type="button"
              disabled={isBusy}
              aria-pressed={restartMode === 'now'}
              onClick={() => setRestartMode('now')}
            >
              Активировать сейчас
            </button>
            <button
              className={cx(
                styles.quickDateButton,
                restartMode === 'delay' && styles.quickDateButtonActive,
              )}
              type="button"
              disabled={isBusy}
              aria-pressed={restartMode === 'delay'}
              onClick={() => setRestartMode('delay')}
            >
              Повторить через период
            </button>
          </div>

          {restartMode === 'delay' ? (
            <div className={styles.createFormGrid}>
              <label className={styles.dateField}>
                <span>Повторить через</span>
                <input
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  required
                  value={intervalValue}
                  onChange={(event) => setIntervalValue(event.target.value)}
                />
              </label>

              <SelectPicker<SelfCareIntervalUnit>
                className={styles.selectField}
                label="Период"
                value={intervalUnit}
                options={INTERVAL_UNIT_SELECT_OPTIONS}
                onChange={setIntervalUnit}
              />
            </div>
          ) : null}

          <p className={styles.mutedText}>
            Новый старт: {restartDate ? formatDate(restartDate) : 'выбери срок'}
          </p>

          {errorMessage ? (
            <p className={styles.errorText}>{errorMessage}</p>
          ) : null}

          <div className={styles.modalActions}>
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              className={styles.doneButton}
              type="submit"
              disabled={isBusy || !canSubmit}
            >
              Повторить
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

export function SelfCareScheduleDialog({
  date,
  defaultCurrency,
  entry,
  errorMessage,
  isBusy,
  onChangeDate,
  onClose,
  onSubmit,
  todayKey,
}: {
  date: string
  defaultCurrency: string
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onChangeDate: (date: string) => void
  onClose: () => void
  onSubmit: (input: SelfCareItemScheduleInput) => void
  todayKey: string
}) {
  const plannerTimeZone = usePlannerTimeZone()
  const [scheduledTime, setScheduledTime] = useState(
    getInitialScheduleTime(entry, plannerTimeZone),
  )
  const [reminderOffsetsMinutes, setReminderOffsetsMinutes] = useState<
    number[]
  >(() => getInitialReminderOffsets(entry))
  const [place, setPlace] = useState(
    entry.appointment?.place ?? entry.procedure?.place ?? '',
  )
  const [specialistName, setSpecialistName] = useState(
    entry.appointment?.specialistName ?? entry.procedure?.specialistName ?? '',
  )
  const [specialistContact, setSpecialistContact] = useState(
    entry.appointment?.specialistContact ?? entry.procedure?.contact ?? '',
  )
  const [price, setPrice] = useState(
    formatOptionalNumber(
      entry.appointment?.price ?? entry.procedure?.defaultPrice,
    ),
  )
  const [note, setNote] = useState(entry.appointment?.preparationNote ?? '')

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  const quickOptions = [
    { label: 'Сегодня', value: todayKey },
    { label: 'Завтра', value: shiftDateKey(todayKey, 1) },
    { label: 'Через неделю', value: shiftDateKey(todayKey, 7) },
    { label: 'Через месяц', value: shiftDateKey(todayKey, 30) },
  ]

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-schedule-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть планирование заботы"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-schedule-title">Запланировать</h2>
            <p>Выбери дату, время и детали записи.</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть планирование заботы"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <form
          className={styles.scheduleForm}
          onSubmit={(event) => {
            event.preventDefault()
            const priceValue = parseOptionalPrice(price)
            onSubmit({
              currency:
                priceValue === null
                  ? null
                  : (entry.appointment?.currency ??
                    entry.procedure?.currency ??
                    defaultCurrency),
              note,
              place: normalizeOptionalText(place),
              price: priceValue,
              reminderOffsetsMinutes,
              scheduledFor: date,
              scheduledTime: normalizeOptionalText(scheduledTime),
              specialistContact: normalizeOptionalText(specialistContact),
              specialistName: normalizeOptionalText(specialistName),
              timezone: getClientTimeZone(plannerTimeZone),
            })
          }}
        >
          <div className={styles.scheduleTarget}>
            <strong>{entry.item.title}</strong>
            <span>
              {CATEGORY_LABELS[entry.item.category]} ·{' '}
              {getTypeLabel(entry.item)}
            </span>
          </div>

          <div className={styles.scheduleDetailsGrid}>
            <label className={styles.dateField}>
              <span>Дата</span>
              <input
                type="date"
                min={todayKey}
                required
                value={date}
                onChange={(event) => onChangeDate(event.target.value)}
              />
            </label>

            <label className={styles.dateField}>
              <span>Время</span>
              <input
                type="time"
                value={scheduledTime}
                onChange={(event) => setScheduledTime(event.target.value)}
              />
            </label>
          </div>

          <SelfCareReminderOffsetsField
            value={reminderOffsetsMinutes}
            onChange={setReminderOffsetsMinutes}
          />

          <div
            className={styles.quickDateGrid}
            role="group"
            aria-label="Быстрый выбор даты"
          >
            {quickOptions.map((option) => (
              <button
                key={option.value}
                className={cx(
                  styles.quickDateButton,
                  option.value === date && styles.quickDateButtonActive,
                )}
                type="button"
                disabled={isBusy}
                onClick={() => onChangeDate(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className={styles.scheduleDetailsGrid}>
            <label className={styles.dateField}>
              <span>Место</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Салон, клиника, адрес"
                value={place}
                onChange={(event) => setPlace(event.target.value)}
              />
            </label>

            <label className={styles.dateField}>
              <span>Мастер / специалист</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Имя мастера или врача"
                value={specialistName}
                onChange={(event) => setSpecialistName(event.target.value)}
              />
            </label>

            <label className={styles.dateField}>
              <span>Контакт</span>
              <input
                type="text"
                autoComplete="off"
                placeholder="Телефон, ссылка, мессенджер"
                value={specialistContact}
                onChange={(event) => setSpecialistContact(event.target.value)}
              />
            </label>

            <label className={styles.dateField}>
              <span>Стоимость</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="decimal"
                placeholder="0 ₽"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
          </div>

          <label className={styles.dateField}>
            <span>Комментарий</span>
            <textarea
              rows={3}
              maxLength={600}
              placeholder="Что важно помнить перед записью"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {errorMessage ? (
            <p className={styles.errorText}>{errorMessage}</p>
          ) : null}

          <div className={styles.modalActions}>
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              className={styles.doneButton}
              type="submit"
              disabled={
                isBusy ||
                !date ||
                (reminderOffsetsMinutes.length > 0 && !scheduledTime)
              }
            >
              Запланировать
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  )
}

export function SelfCareMeasurementDialog({
  entry,
  errorMessage,
  isBusy,
  onClose,
  onSubmit,
}: {
  entry: SelfCareTodayItem
  errorMessage: string | null
  isBusy: boolean
  onClose: () => void
  onSubmit: (input: SelfCareCompletionInput) => void
}) {
  const [value, setValue] = useState(() => getInitialMeasurementValue(entry))
  const [note, setNote] = useState('')
  const numericValue = parseRequiredMeasurementNumber(value)
  const targetLabel = formatMeasurementTarget(entry)
  const unit = entry.measurement?.unit ?? ''
  const label = entry.measurement?.valueLabel ?? 'Значение'

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.modalOverlay}
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-care-measurement-title"
    >
      <button
        className={styles.backdropButton}
        type="button"
        tabIndex={-1}
        aria-label="Закрыть ввод измерения"
        onClick={onClose}
      />

      <section className={styles.modalPanel}>
        <div className={styles.modalHeader}>
          <div>
            <h2 id="self-care-measurement-title">Записать измерение</h2>
            <p>{entry.item.title}</p>
          </div>
          <button
            className={styles.closeButton}
            type="button"
            aria-label="Закрыть ввод измерения"
            onClick={onClose}
          >
            <CloseIcon size={18} strokeWidth={2.2} />
          </button>
        </div>

        <form
          className={styles.scheduleForm}
          onSubmit={(event) => {
            event.preventDefault()

            if (numericValue === null) {
              return
            }

            onSubmit({
              alternativeTitle: null,
              completedVariant: 'full',
              durationMinutes: null,
              energyAfter: null,
              energyBefore: null,
              measurementUnit: unit || null,
              measurementValue: numericValue,
              moodAfter: null,
              moodBefore: null,
              note,
              status: 'done',
            })
          }}
        >
          <div className={styles.scheduleTarget}>
            <strong>{label}</strong>
            <span>{targetLabel ?? 'Без заданной нормы'}</span>
          </div>

          <label className={styles.dateField}>
            <span>{unit ? `${label}, ${unit}` : label}</span>
            <input
              type="number"
              step="any"
              inputMode="decimal"
              autoFocus
              required
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>

          <label className={styles.dateField}>
            <span>Комментарий</span>
            <textarea
              rows={3}
              maxLength={1200}
              placeholder="Можно оставить пустым"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>

          {errorMessage ? (
            <p className={styles.errorText}>{errorMessage}</p>
          ) : null}

          <div className={styles.modalActions}>
            <button
              className={styles.softButton}
              type="button"
              disabled={isBusy}
              onClick={onClose}
            >
              Отмена
            </button>
            <button
              className={styles.doneButton}
              type="submit"
              disabled={isBusy || numericValue === null}
            >
              Сохранить
            </button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
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
