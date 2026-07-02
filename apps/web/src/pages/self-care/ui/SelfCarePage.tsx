import type {
  SelfCareCompletionInput,
  SelfCareItemScheduleInput,
  SelfCareTodayItem,
} from '@planner/contracts'
import { lazy, Suspense, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  getSelfCareErrorMessage,
  isSelfCareApiUnavailableError,
  SELF_CARE_API_UNAVAILABLE_MESSAGE,
} from '@/features/self-care'
import { useSessionFeatureReadiness } from '@/features/session'
import pageStyles from '@/shared/ui/Page'

import {
  SelfCareCourseRestartDialog,
  SelfCareExerciseDialog,
  SelfCareMeasurementDialog,
  SelfCareScheduleDialog,
} from './SelfCarePage.action-dialogs'
import {
  SelfCareHistoryTab,
  SelfCarePlanTab,
  SelfCareRitualsTab,
  SelfCareSettingsTab,
  SelfCareTodayTab,
} from './SelfCarePage.components'
import { useSelfCarePageData } from './SelfCarePage.data'
import {
  SelfCareCreateDialog,
  SelfCareEditDialog,
} from './SelfCarePage.dialogs'
import {
  applyRitualStepDraftOverrides,
  buildCompletionInput,
  buildRitualStepCompletionInput,
  buildRitualStepDraftInput,
  canRestartCourse,
  firstErrorMessage,
  formatDate,
  getInitialRitualStepDraft,
  getInitialScheduleDate,
  getRitualStepDraft,
  getRitualStepDraftKey,
  type RitualStepDraftOverrides,
  type SelfCareAnalyticsDetailSelection,
  type SelfCareCourseRestartPayload,
  type SelfCareCreateDialogMode,
  type SelfCareCustomCreatePayload,
  type SelfCareEditSubmitPayload,
  type SelfCareSettingsPatch,
  type SelfCareTab,
} from './SelfCarePage.helpers'
import {
  getSelfCareAnalyticsDetailSearchParams,
  getSelfCareAnalyticsOverviewSearchParams,
  getSelfCareCloseCreateDialogAndTabSearchParams,
  getSelfCareCloseCreateDialogSearchParams,
  getSelfCareCreateDialogSearchParams,
  getSelfCarePageRouteState,
  getSelfCareTabSearchParams,
} from './SelfCarePage.model'
import styles from './SelfCarePage.module.css'
import { useSelfCarePageMutations } from './SelfCarePage.mutations'
import {
  buildRitualDashboardItems,
  isEntryDoneToday,
  scheduleSelfCareEntryOccurrence,
} from './SelfCarePage.schedule'
import { SelfCarePageTabs } from './SelfCarePage.tabs'

const SelfCareAnalyticsTab = lazy(() =>
  import('./SelfCarePage.analytics').then((module) => ({
    default: module.SelfCareAnalyticsTab,
  })),
)

export function SelfCarePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const routeState = getSelfCarePageRouteState(searchParams)
  const { activeTab, createDialogMode } = routeState
  const {
    analytics,
    analyticsQuery,
    createdTemplateIds,
    dashboard,
    dashboardQuery,
    defaultCurrency,
    history,
    historyQuery,
    isActiveTabLoading,
    itemsQuery,
    list,
    plan,
    planQuery,
    serverRitualStepDrafts,
    settingsQuery,
    settingsResponse,
    stepDraftsQuery,
    templates,
    templatesQuery,
    todayKey,
    uploadedIcons,
  } = useSelfCarePageData(routeState)
  const {
    archiveItemMutation,
    cancelOccurrenceMutation,
    completeCourseMutation,
    completeFlexibleGoalMutation,
    completeItemNowMutation,
    completeOccurrenceMutation,
    createFromTemplateMutation,
    createItemMutation,
    isActionBusy,
    moveOccurrenceMutation,
    mutationErrors,
    scheduleItemMutation,
    skipOccurrenceMutation,
    updateItemMutation,
    updateSettingsMutation,
    upsertRitualStepDraftMutation,
  } = useSelfCarePageMutations()
  const { readiness: selfCareReadiness } = useSessionFeatureReadiness()
  const [formError, setFormError] = useState<string | null>(null)
  const [scheduleDialogEntry, setScheduleDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [editDialogEntry, setEditDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [restartCourseDialogEntry, setRestartCourseDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [measurementDialogEntry, setMeasurementDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [exerciseDialogEntry, setExerciseDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [scheduleDate, setScheduleDate] = useState(todayKey)
  const [hiddenScheduledItemIds, setHiddenScheduledItemIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [creatingTemplateIds, setCreatingTemplateIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const [ritualStepDraftOverrides, setRitualStepDraftOverrides] =
    useState<RitualStepDraftOverrides>({})
  const ritualStepDrafts = useMemo(
    () =>
      applyRitualStepDraftOverrides(
        serverRitualStepDrafts,
        ritualStepDraftOverrides,
      ),
    [ritualStepDraftOverrides, serverRitualStepDrafts],
  )
  const disabledTemplateIds = useMemo(
    () => new Set([...createdTemplateIds, ...creatingTemplateIds]),
    [createdTemplateIds, creatingTemplateIds],
  )
  const canUseSelfCareActions = selfCareReadiness.canWriteProtectedData
  const isSelfCareActionBusy = isActionBusy || !canUseSelfCareActions
  const visibleFormError =
    formError === SELF_CARE_API_UNAVAILABLE_MESSAGE ? null : formError
  const errorMessage =
    visibleFormError ||
    firstErrorMessage(
      [
        dashboardQuery.error,
        itemsQuery.error,
        planQuery.error,
        stepDraftsQuery.error,
        historyQuery.error,
        analyticsQuery.error,
        settingsQuery.error,
        templatesQuery.error,
        ...mutationErrors,
      ],
      {
        shouldIgnore: isSelfCareApiUnavailableError,
      },
    )

  function setActiveTab(tab: SelfCareTab) {
    setSearchParams(getSelfCareTabSearchParams(searchParams, tab), {
      replace: true,
    })
  }

  function closeCreateDialog(): void {
    setSearchParams(getSelfCareCloseCreateDialogSearchParams(searchParams), {
      replace: true,
    })
  }

  function closeCreateDialogAndShowTab(tab: SelfCareTab): void {
    setSearchParams(
      getSelfCareCloseCreateDialogAndTabSearchParams(searchParams, tab),
      { replace: true },
    )
  }

  function openCreateDialog(): void {
    setSearchParams(getSelfCareCreateDialogSearchParams(searchParams, 'choice'))
  }

  function setCreateDialogMode(mode: SelfCareCreateDialogMode): void {
    setSearchParams(getSelfCareCreateDialogSearchParams(searchParams, mode))
  }

  function showAnalyticsDetail(
    selection: SelfCareAnalyticsDetailSelection,
  ): void {
    setSearchParams(
      getSelfCareAnalyticsDetailSearchParams(searchParams, selection),
    )
  }

  function showAnalyticsOverview(): void {
    setSearchParams(getSelfCareAnalyticsOverviewSearchParams(searchParams))
  }

  function handleCreateCustomCare(payload: SelfCareCustomCreatePayload): void {
    setFormError(null)

    const shouldSchedule = Boolean(payload.scheduleInput)
    void createItemMutation
      .mutateAsync({
        input: payload.input,
        skipInvalidation: shouldSchedule,
      })
      .then(async (item) => {
        if (payload.scheduleInput) {
          await scheduleItemMutation.mutateAsync({
            input: payload.scheduleInput,
            itemId: item.id,
          })
        }
      })
      .then(() => {
        closeCreateDialogAndShowTab(payload.scheduleInput ? 'plan' : 'rituals')
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleCreateFromTemplate(
    templateId: string,
    options: { closeAfterCreate?: boolean } = {},
  ): void {
    setFormError(null)

    if (!list) {
      setFormError(
        'Данные еще загружаются. Попробуй еще раз через пару секунд.',
      )
      return
    }

    if (
      createdTemplateIds.has(templateId) ||
      creatingTemplateIds.has(templateId)
    ) {
      setFormError('Такая забота уже добавлена.')
      return
    }

    setCreatingTemplateIds((current) => new Set(current).add(templateId))

    void createFromTemplateMutation
      .mutateAsync({ templateId })
      .then(() => {
        if (options.closeAfterCreate) {
          closeCreateDialog()
        }
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
      .finally(() => {
        setCreatingTemplateIds((current) => {
          const next = new Set(current)
          next.delete(templateId)
          return next
        })
      })
  }

  async function handleUpdateSettings(
    input: SelfCareSettingsPatch,
  ): Promise<void> {
    setFormError(null)

    try {
      await updateSettingsMutation.mutateAsync(input)
    } catch (error: unknown) {
      setFormError(getSelfCareErrorMessage(error))
      throw error
    }
  }

  function handleArchiveItem(entry: SelfCareTodayItem): void {
    setFormError(null)

    const shouldArchive = window.confirm(
      `Удалить «${entry.item.title}» из заботы о себе? История останется в разделе.`,
    )

    if (!shouldArchive) {
      return
    }

    void archiveItemMutation
      .mutateAsync(entry.item.id)
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleEditItem(entry: SelfCareTodayItem): void {
    setFormError(null)
    setEditDialogEntry(entry)
  }

  function closeEditDialog(): void {
    setFormError(null)
    setEditDialogEntry(null)
  }

  function handleRestartCourse(entry: SelfCareTodayItem): void {
    if (!canRestartCourse(entry)) {
      return
    }

    setFormError(null)
    setRestartCourseDialogEntry(entry)
  }

  function closeRestartCourseDialog(): void {
    setFormError(null)
    setRestartCourseDialogEntry(null)
  }

  function handleRestartCourseSubmit(
    payload: SelfCareCourseRestartPayload,
  ): void {
    if (!restartCourseDialogEntry) {
      return
    }

    const entry = restartCourseDialogEntry
    setFormError(null)
    void updateItemMutation
      .mutateAsync({
        input: payload.input,
        itemId: entry.item.id,
      })
      .then(() => {
        closeRestartCourseDialog()
        setActiveTab(payload.restartDate === todayKey ? 'today' : 'plan')
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleUpdateItem(payload: SelfCareEditSubmitPayload): void {
    if (!editDialogEntry) {
      return
    }

    const entry = editDialogEntry
    setFormError(null)
    void (async () => {
      await updateItemMutation.mutateAsync({
        input: payload.input,
        itemId: entry.item.id,
        skipInvalidation: Boolean(payload.scheduleInput),
      })

      if (payload.scheduleInput) {
        await scheduleSelfCareEntryOccurrence({
          entry,
          input: payload.scheduleInput,
          moveNote: 'Дата записи изменена в настройках.',
          moveOccurrence: moveOccurrenceMutation.mutateAsync,
          scheduleItem: scheduleItemMutation.mutateAsync,
        })
      }
    })()
      .then(() => {
        closeEditDialog()
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleScheduleItem(entry: SelfCareTodayItem): void {
    setFormError(null)
    setScheduleDate(getInitialScheduleDate(entry, todayKey))
    setScheduleDialogEntry(entry)
  }

  function closeScheduleDialog(): void {
    setFormError(null)
    setScheduleDialogEntry(null)
    setScheduleDate(todayKey)
  }

  function closeMeasurementDialog(): void {
    setFormError(null)
    setMeasurementDialogEntry(null)
  }

  function closeExerciseDialog(): void {
    setFormError(null)
    setExerciseDialogEntry(null)
  }

  function handleScheduleSubmit(input: SelfCareItemScheduleInput): void {
    if (!scheduleDialogEntry) {
      return
    }

    const entry = scheduleDialogEntry
    setFormError(null)
    void scheduleSelfCareEntryOccurrence({
      entry,
      input,
      moveNote:
        entry.occurrence && entry.occurrence.scheduledFor < todayKey
          ? 'Перенесено из просроченного плана.'
          : 'Дата записи изменена в плане.',
      moveOccurrence: moveOccurrenceMutation.mutateAsync,
      scheduleItem: scheduleItemMutation.mutateAsync,
    })
      .then(() => {
        setHiddenScheduledItemIds((current) =>
          new Set(current).add(entry.item.id),
        )
        closeScheduleDialog()
        setActiveTab('plan')
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleCancelPlannedOccurrence(entry: SelfCareTodayItem): void {
    if (!entry.occurrence) {
      return
    }

    setFormError(null)
    const shouldCancel = window.confirm(
      `Убрать «${entry.item.title}» из плана на ${formatDate(entry.occurrence.scheduledFor)}? Сама забота останется.`,
    )

    if (!shouldCancel) {
      return
    }

    void cancelOccurrenceMutation
      .mutateAsync(entry.occurrence.id)
      .then(() => {
        setHiddenScheduledItemIds((current) => {
          const next = new Set(current)
          next.delete(entry.item.id)
          return next
        })
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleSkipOccurrence(entry: SelfCareTodayItem): void {
    if (!entry.occurrence) {
      return
    }

    setFormError(null)
    void skipOccurrenceMutation
      .mutateAsync({
        input: { reason: 'Пропущено вручную.' },
        occurrenceId: entry.occurrence.id,
      })
      .then(() => {
        clearRitualStepDraft(entry)
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleMeasurementSubmit(input: SelfCareCompletionInput): void {
    if (!measurementDialogEntry) {
      return
    }

    const entry = measurementDialogEntry
    setFormError(null)

    void (async () => {
      if (entry.occurrence) {
        await completeOccurrenceMutation.mutateAsync({
          input: { ...input, steps: [] },
          occurrenceId: entry.occurrence.id,
        })
        return
      }

      await completeItemNowMutation.mutateAsync({
        input: { ...input, steps: [] },
        itemId: entry.item.id,
      })
    })()
      .then(() => {
        closeMeasurementDialog()
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleExerciseSubmit(input: SelfCareCompletionInput): void {
    if (!exerciseDialogEntry) {
      return
    }

    const entry = exerciseDialogEntry
    setFormError(null)

    void (async () => {
      if (entry.occurrence && input.status !== 'partial') {
        await completeOccurrenceMutation.mutateAsync({
          input: { ...input, steps: [] },
          occurrenceId: entry.occurrence.id,
        })
        return
      }

      await completeItemNowMutation.mutateAsync({
        input: { ...input, steps: [] },
        itemId: entry.item.id,
      })
    })()
      .then(() => {
        closeExerciseDialog()
      })
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function handleToggleRitualStep(
    entry: SelfCareTodayItem,
    stepId: string,
  ): void {
    if (!entry.steps.some((step) => step.id === stepId)) {
      return
    }

    if (isEntryDoneToday(entry, todayKey)) {
      return
    }

    const draftKey = getRitualStepDraftKey(entry, todayKey)
    const selectedStepIds = new Set(
      ritualStepDrafts[draftKey] ?? getInitialRitualStepDraft(entry),
    )

    if (selectedStepIds.has(stepId)) {
      selectedStepIds.delete(stepId)
    } else {
      selectedStepIds.add(stepId)
    }

    const stepIds = [...selectedStepIds]

    setRitualStepDraftOverrides((current) => {
      return { ...current, [draftKey]: stepIds }
    })
    void upsertRitualStepDraftMutation
      .mutateAsync(buildRitualStepDraftInput(entry, todayKey, stepIds))
      .catch((error: unknown) => {
        setFormError(getSelfCareErrorMessage(error))
      })
  }

  function clearRitualStepDraft(entry: SelfCareTodayItem): void {
    const draftKey = getRitualStepDraftKey(entry, todayKey)

    setRitualStepDraftOverrides((current) => {
      if (current[draftKey] === null) {
        return current
      }

      return { ...current, [draftKey]: null }
    })
  }

  function handleCardAction(entry: SelfCareTodayItem): void {
    setFormError(null)

    if (entry.item.type === 'measurement') {
      setMeasurementDialogEntry(entry)
      return
    }

    if (entry.item.type === 'exercise') {
      setExerciseDialogEntry(entry)
      return
    }

    void (async () => {
      const input = buildCompletionInput(entry)
      const ritualSteps = buildRitualStepCompletionInput(
        entry,
        getRitualStepDraft(ritualStepDrafts, entry, todayKey),
      )

      if (entry.occurrence) {
        await completeOccurrenceMutation.mutateAsync({
          input: {
            ...input,
            steps: ritualSteps,
          },
          occurrenceId: entry.occurrence.id,
        })
        clearRitualStepDraft(entry)
        return
      }

      if (entry.item.type === 'flexible_goal') {
        await completeFlexibleGoalMutation.mutateAsync({
          input,
          itemId: entry.item.id,
        })
        return
      }

      if (entry.item.type === 'course') {
        await completeCourseMutation.mutateAsync({
          input,
          itemId: entry.item.id,
        })
        return
      }

      await completeItemNowMutation.mutateAsync({
        input: { ...input, steps: ritualSteps },
        itemId: entry.item.id,
      })
      clearRitualStepDraft(entry)
    })().catch((error: unknown) => {
      setFormError(getSelfCareErrorMessage(error))
    })
  }

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

      <SelfCarePageTabs activeTab={activeTab} onSelectTab={setActiveTab} />

      {isActiveTabLoading ? (
        <section className={styles.emptyPanel}>
          Загружаем заботу о себе.
        </section>
      ) : null}

      {activeTab === 'today' ? (
        <SelfCareTodayTab
          dashboard={dashboard}
          history={history}
          hiddenScheduledItemIds={hiddenScheduledItemIds}
          isBusy={isSelfCareActionBusy}
          list={list}
          plan={plan}
          ritualStepDrafts={ritualStepDrafts}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onAddCare={openCreateDialog}
          onCardAction={handleCardAction}
          onArchiveItem={handleArchiveItem}
          onEditItem={handleEditItem}
          onRestartCourse={handleRestartCourse}
          onScheduleItem={handleScheduleItem}
          onSkipOccurrence={handleSkipOccurrence}
          onShowHistory={() => setActiveTab('history')}
          onShowPlan={() => setActiveTab('plan')}
          onToggleRitualStep={handleToggleRitualStep}
        />
      ) : null}

      {activeTab === 'plan' ? (
        <SelfCarePlanTab
          hiddenScheduledItemIds={hiddenScheduledItemIds}
          history={history}
          isBusy={isSelfCareActionBusy}
          plan={plan}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onCardAction={handleCardAction}
          onArchiveItem={handleArchiveItem}
          onCancelOccurrence={handleCancelPlannedOccurrence}
          onEditItem={handleEditItem}
          onRestartCourse={handleRestartCourse}
          onScheduleItem={handleScheduleItem}
        />
      ) : null}

      {activeTab === 'rituals' ? (
        <SelfCareRitualsTab
          list={list}
          history={history}
          plan={plan}
          dashboardItems={buildRitualDashboardItems(dashboard)}
          isBusy={isSelfCareActionBusy}
          ritualStepDrafts={ritualStepDrafts}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onCardAction={handleCardAction}
          onArchiveItem={handleArchiveItem}
          onEditItem={handleEditItem}
          onRestartCourse={handleRestartCourse}
          onToggleRitualStep={handleToggleRitualStep}
        />
      ) : null}

      {activeTab === 'history' ? (
        <SelfCareHistoryTab history={history} />
      ) : null}

      {activeTab === 'analytics' ? (
        <Suspense
          fallback={
            <section className={styles.emptyPanel}>
              Загружаем аналитику.
            </section>
          }
        >
          <SelfCareAnalyticsTab
            analytics={analytics}
            detailSelection={routeState.analyticsDetailSelection}
            defaultCurrency={defaultCurrency}
            onBackToOverview={showAnalyticsOverview}
            onShowAll={showAnalyticsDetail}
          />
        </Suspense>
      ) : null}

      {activeTab === 'settings' ? (
        <SelfCareSettingsTab
          isBusy={isSelfCareActionBusy}
          disabledTemplateIds={disabledTemplateIds}
          settings={settingsResponse}
          templates={templates}
          onCreateFromTemplate={handleCreateFromTemplate}
          onUpdateSettings={handleUpdateSettings}
        />
      ) : null}

      {createDialogMode ? (
        <SelfCareCreateDialog
          mode={createDialogMode}
          defaultCurrency={defaultCurrency}
          errorMessage={errorMessage}
          disabledTemplateIds={disabledTemplateIds}
          isBusy={isSelfCareActionBusy || !list}
          todayKey={todayKey}
          templates={templates}
          uploadedIcons={uploadedIcons}
          onBack={() => setCreateDialogMode('choice')}
          onClose={closeCreateDialog}
          onCreateCustom={handleCreateCustomCare}
          onCreateFromTemplate={(templateId) =>
            handleCreateFromTemplate(templateId, { closeAfterCreate: true })
          }
          onSelectCustom={() => setCreateDialogMode('custom')}
          onSelectTemplate={() => setCreateDialogMode('template')}
        />
      ) : null}

      {scheduleDialogEntry ? (
        <SelfCareScheduleDialog
          date={scheduleDate}
          defaultCurrency={defaultCurrency}
          entry={scheduleDialogEntry}
          errorMessage={visibleFormError}
          isBusy={
            scheduleItemMutation.isPending ||
            moveOccurrenceMutation.isPending ||
            !canUseSelfCareActions
          }
          todayKey={todayKey}
          onChangeDate={setScheduleDate}
          onClose={closeScheduleDialog}
          onSubmit={handleScheduleSubmit}
        />
      ) : null}

      {measurementDialogEntry ? (
        <SelfCareMeasurementDialog
          entry={measurementDialogEntry}
          errorMessage={visibleFormError}
          isBusy={
            completeOccurrenceMutation.isPending ||
            completeItemNowMutation.isPending ||
            !canUseSelfCareActions
          }
          onClose={closeMeasurementDialog}
          onSubmit={handleMeasurementSubmit}
        />
      ) : null}

      {exerciseDialogEntry ? (
        <SelfCareExerciseDialog
          entry={exerciseDialogEntry}
          errorMessage={visibleFormError}
          isBusy={
            completeOccurrenceMutation.isPending ||
            completeItemNowMutation.isPending ||
            !canUseSelfCareActions
          }
          todayKey={todayKey}
          onClose={closeExerciseDialog}
          onSubmit={handleExerciseSubmit}
        />
      ) : null}

      {editDialogEntry ? (
        <SelfCareEditDialog
          defaultCurrency={defaultCurrency}
          entry={editDialogEntry}
          errorMessage={visibleFormError}
          isBusy={
            updateItemMutation.isPending ||
            scheduleItemMutation.isPending ||
            moveOccurrenceMutation.isPending ||
            !canUseSelfCareActions
          }
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onClose={closeEditDialog}
          onSubmit={handleUpdateItem}
        />
      ) : null}

      {restartCourseDialogEntry ? (
        <SelfCareCourseRestartDialog
          entry={restartCourseDialogEntry}
          errorMessage={visibleFormError}
          isBusy={updateItemMutation.isPending || !canUseSelfCareActions}
          todayKey={todayKey}
          onClose={closeRestartCourseDialog}
          onSubmit={handleRestartCourseSubmit}
        />
      ) : null}
    </section>
  )
}
