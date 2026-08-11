import type {
  SelfCareCompletion,
  SelfCareCompletionInput,
  SelfCareCompletionUpdateInput,
  SelfCareItemScheduleInput,
  SelfCareTodayItem,
} from '@planner/contracts'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'

import {
  getSelfCareErrorMessage,
  isSelfCareApiUnavailableError,
  SELF_CARE_API_UNAVAILABLE_MESSAGE,
  useSelfCareOfflineQueue,
} from '@/features/self-care'
import { useSessionFeatureReadiness } from '@/features/session'
import {
  isBrowserRetryableOfflineError,
  useBrowserOffline,
} from '@/shared/lib/offline-sync'
import pageStyles from '@/shared/ui/Page'
import { PageStateView, PageStatusBanner } from '@/shared/ui/PageState'

import {
  SelfCareHistoryTab,
  SelfCarePlanTab,
  SelfCareRitualsTab,
  SelfCareSettingsTab,
  SelfCareTodayTab,
} from './SelfCarePage.components'
import { useSelfCarePageData } from './SelfCarePage.data'
import {
  DeferredSelfCareCompletionEditDialog,
  DeferredSelfCareCourseRestartDialog,
  DeferredSelfCareCreateDialog,
  DeferredSelfCareEditDialog,
  DeferredSelfCareExerciseDialog,
  DeferredSelfCareMeasurementDialog,
  DeferredSelfCareScheduleDialog,
} from './SelfCarePage.deferred-dialog'
import { startSelfCareDialogWarmup } from './SelfCarePage.dialog-loader'
import {
  applyRitualStepDraftOverrides,
  buildCompletionInput,
  buildRitualStepCompletionInput,
  buildRitualStepDraftInput,
  canRestartCourse,
  firstErrorMessage,
  formatDate,
  getCompletionCost,
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
    activeTabReadErrors,
    createdTemplateIds,
    createDialogReadErrors,
    dashboard,
    defaultCurrency,
    history,
    hasActiveTabData,
    hasCreateDialogData,
    hasCreateDialogReadError,
    isActiveTabCacheLoading,
    isActiveTabLoading,
    isCreateDialogLoading,
    list,
    lastSuccessfulSyncAt,
    plan,
    retryActiveTab,
    serverRitualStepDrafts,
    settingsResponse,
    templates,
    templatesLoaded,
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
    updateCompletionMutation,
    updateSettingsMutation,
    upsertRitualStepDraftMutation,
  } = useSelfCarePageMutations()
  const { readiness: selfCareReadiness, sessionQuery: selfCareSessionQuery } =
    useSessionFeatureReadiness()
  const selfCareOfflineQueue = useSelfCareOfflineQueue()
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
  const [completionEditDialogEntry, setCompletionEditDialogEntry] =
    useState<SelfCareCompletion | null>(null)
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
  const isBrowserOffline = useBrowserOffline()
  const visibleFormError = formError
  const hasFeatureConnectionError = activeTabReadErrors.some(
    isBrowserRetryableOfflineError,
  )
  const hasReadConnectionIssue = selfCareReadiness.reason === 'planner_error'
  const canQueueSelfCareWrites =
    selfCareOfflineQueue.canWriteFromSession &&
    selfCareOfflineQueue.canQueueWrites
  const hasDeferredAuthWithLocalWrites =
    selfCareReadiness.reason === 'auth_deferred' && canQueueSelfCareWrites
  const hasOfflineConnectionIssue =
    isBrowserOffline ||
    hasFeatureConnectionError ||
    hasReadConnectionIssue ||
    hasDeferredAuthWithLocalWrites
  const canUseSelfCareWrites =
    selfCareOfflineQueue.canWriteFromSession &&
    (hasOfflineConnectionIssue
      ? selfCareOfflineQueue.canQueueWrites
      : selfCareReadiness.canWriteProtectedData ||
        selfCareOfflineQueue.canQueueWrites)
  const canUseSelfCareActions =
    canUseSelfCareWrites && (!hasFeatureConnectionError || hasActiveTabData)
  const isAddingCare =
    createItemMutation.isPending || createFromTemplateMutation.isPending
  const isSelfCareActionBusy = isActionBusy || !canUseSelfCareActions
  const readErrorMessage = hasFeatureConnectionError
    ? 'Не удалось связаться с сервером. Проверь подключение и попробуй снова.'
    : firstErrorMessage(activeTabReadErrors, {
        shouldIgnore: isSelfCareApiUnavailableError,
      })
  const mutationErrorMessage = firstErrorMessage([...mutationErrors], {
    shouldIgnore: isSelfCareApiUnavailableError,
  })
  const createDialogReadErrorMessage = firstErrorMessage(
    createDialogReadErrors,
    { shouldIgnore: isSelfCareApiUnavailableError },
  )
  const createDialogErrorMessage =
    visibleFormError || createDialogReadErrorMessage || mutationErrorMessage
  const canUseCreateDialogActions =
    canUseSelfCareWrites && (!hasCreateDialogReadError || hasCreateDialogData)
  const isSessionRestoring =
    selfCareReadiness.reason === 'auth_restoring' ||
    selfCareReadiness.reason === 'planner_pending'
  const isSessionUnavailable =
    selfCareReadiness.reason === 'unauthorized' ||
    selfCareReadiness.reason === 'no_session' ||
    (selfCareReadiness.reason === 'auth_deferred' &&
      !hasDeferredAuthWithLocalWrites)
  const shouldShowLoadingState =
    !hasActiveTabData &&
    (isActiveTabCacheLoading ||
      (!hasOfflineConnectionIssue &&
        (isSessionRestoring || isActiveTabLoading)))
  const blockingState = hasActiveTabData
    ? null
    : isSessionUnavailable
      ? 'unavailable'
      : shouldShowLoadingState
        ? 'loading'
        : hasOfflineConnectionIssue
          ? 'offline'
          : 'error'
  const canShowCreateDialog = Boolean(
    createDialogMode && canUseSelfCareWrites && !isSessionUnavailable,
  )

  useEffect(() => {
    if (!hasActiveTabData) {
      return
    }

    return startSelfCareDialogWarmup()
  }, [hasActiveTabData])

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
    if (!canUseSelfCareActions) {
      setFormError(SELF_CARE_API_UNAVAILABLE_MESSAGE)
      return
    }

    setSearchParams(getSelfCareCreateDialogSearchParams(searchParams, 'choice'))
  }

  function retrySelfCare(): void {
    setFormError(null)
    void (async () => {
      if (!selfCareReadiness.canUseProtectedApi) {
        await selfCareSessionQuery.refetch()
        return
      }

      await retryActiveTab()
    })()
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

    void createItemMutation
      .mutateAsync({
        input: payload.input,
        scheduleInput: payload.scheduleInput,
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

  function closeCompletionEditDialog(): void {
    setFormError(null)
    setCompletionEditDialogEntry(null)
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
    void updateItemMutation
      .mutateAsync({
        entry,
        input: payload.input,
        itemId: entry.item.id,
        moveNote: 'Дата записи изменена в настройках.',
        scheduleInput: payload.scheduleInput,
      })
      .then(() => {
        if (payload.scheduleInput) {
          setHiddenScheduledItemIds((current) =>
            new Set(current).add(entry.item.id),
          )
        }
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
          ? 'Перенесено из плана с прошедшей датой.'
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

  function handleCompletionEditSubmit(
    input: SelfCareCompletionUpdateInput,
  ): void {
    if (!completionEditDialogEntry) {
      return
    }

    setFormError(null)
    void updateCompletionMutation
      .mutateAsync({
        completionId: completionEditDialogEntry.id,
        input,
      })
      .then(() => {
        closeCompletionEditDialog()
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
      <h1 className={pageStyles.visuallyHidden}>Забота о себе</h1>
      <SelfCarePageTabs activeTab={activeTab} onSelectTab={setActiveTab} />

      {blockingState === 'loading' ? (
        <PageStateView
          kind="loading"
          title={
            isBrowserOffline && isActiveTabCacheLoading
              ? 'Проверяем сохранённые данные'
              : 'Загружаем заботу о себе'
          }
          skeletonVariant={activeTab === 'settings' ? 'settings' : 'cards'}
        />
      ) : null}

      {blockingState === 'offline' ? (
        <PageStateView
          action={{ label: 'Повторить', onClick: retrySelfCare }}
          description="На устройстве нет полного сохранённого набора данных для этого раздела. Проверь подключение и попробуй ещё раз."
          kind="offline"
          lastSyncedAt={lastSuccessfulSyncAt}
          showUnknownLastSync
          title="Забота о себе недоступна без подключения"
        />
      ) : null}

      {blockingState === 'unavailable' ? (
        <PageStateView
          action={{ label: 'Обновить доступ', onClick: retrySelfCare }}
          description="Не удалось подтвердить сессию. После восстановления доступа данные загрузятся автоматически."
          kind="unavailable"
          title="Нужно восстановить доступ"
        />
      ) : null}

      {blockingState === 'error' ? (
        <PageStateView
          action={{ label: 'Повторить', onClick: retrySelfCare }}
          description={
            readErrorMessage ??
            (hasReadConnectionIssue
              ? 'Не удалось связаться с сервером. Попробуй ещё раз.'
              : 'Не удалось загрузить данные. Попробуй ещё раз.')
          }
          kind="error"
          lastSyncedAt={lastSuccessfulSyncAt}
          title="Не удалось открыть заботу о себе"
        />
      ) : null}

      {hasActiveTabData &&
      hasOfflineConnectionIssue &&
      !isSessionUnavailable ? (
        <PageStatusBanner
          action={{ label: 'Повторить', onClick: retrySelfCare }}
          description={
            selfCareOfflineQueue.canQueueWrites
              ? 'Сохранённые данные доступны. Новые изменения останутся на устройстве и отправятся после восстановления связи.'
              : 'Можно просматривать сохранённые данные. Для изменений нужно восстановить связь.'
          }
          kind="offline"
          lastSyncedAt={lastSuccessfulSyncAt}
          showUnknownLastSync
        />
      ) : null}

      {hasActiveTabData && isSessionRestoring && !hasOfflineConnectionIssue ? (
        <PageStatusBanner
          description="Сохранённые данные доступны для просмотра. Изменения появятся после восстановления доступа."
          kind="info"
          lastSyncedAt={lastSuccessfulSyncAt}
          showUnknownLastSync
          title="Восстанавливаем доступ"
        />
      ) : null}

      {hasActiveTabData &&
      !hasOfflineConnectionIssue &&
      hasReadConnectionIssue ? (
        <PageStatusBanner
          action={{ label: 'Повторить', onClick: retrySelfCare }}
          description={
            selfCareOfflineQueue.canQueueWrites
              ? 'Показываем сохранённые данные. Новые изменения безопасно сохранятся на устройстве.'
              : 'Показываем сохранённые данные. Для изменений нужно восстановить связь с сервером.'
          }
          kind="error"
          lastSyncedAt={lastSuccessfulSyncAt}
          showUnknownLastSync
          title="Не удалось обновить данные"
        />
      ) : null}

      {hasActiveTabData && isSessionUnavailable ? (
        <PageStatusBanner
          action={{ label: 'Обновить доступ', onClick: retrySelfCare }}
          description="Данные доступны для просмотра. Для изменений нужно восстановить сессию."
          kind="error"
          lastSyncedAt={lastSuccessfulSyncAt}
          showUnknownLastSync
          title="Изменения временно недоступны"
        />
      ) : null}

      {hasActiveTabData &&
      !hasOfflineConnectionIssue &&
      !hasReadConnectionIssue &&
      !isSessionUnavailable &&
      readErrorMessage ? (
        <PageStatusBanner
          action={{ label: 'Повторить', onClick: retrySelfCare }}
          description={readErrorMessage}
          kind="error"
          lastSyncedAt={lastSuccessfulSyncAt}
          showUnknownLastSync
        />
      ) : null}

      {hasActiveTabData &&
      !readErrorMessage &&
      (visibleFormError || mutationErrorMessage) ? (
        <PageStatusBanner
          description={visibleFormError ?? mutationErrorMessage ?? undefined}
          kind="error"
          title="Не удалось выполнить действие"
        />
      ) : null}

      <SelfCareQueueStatus
        isOffline={hasOfflineConnectionIssue}
        queue={selfCareOfflineQueue}
      />

      {hasActiveTabData && activeTab === 'today' ? (
        <SelfCareTodayTab
          canAddCare={canUseSelfCareActions}
          dashboard={dashboard}
          history={history}
          hiddenScheduledItemIds={hiddenScheduledItemIds}
          isBusy={isSelfCareActionBusy}
          isAddingCare={isAddingCare}
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

      {hasActiveTabData && activeTab === 'plan' ? (
        <SelfCarePlanTab
          canAddCare={canUseSelfCareActions}
          hiddenScheduledItemIds={hiddenScheduledItemIds}
          history={history}
          isBusy={isSelfCareActionBusy}
          isAddingCare={isAddingCare}
          plan={plan}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onCardAction={handleCardAction}
          onArchiveItem={handleArchiveItem}
          onAddCare={openCreateDialog}
          onCancelOccurrence={handleCancelPlannedOccurrence}
          onEditItem={handleEditItem}
          onRestartCourse={handleRestartCourse}
          onScheduleItem={handleScheduleItem}
        />
      ) : null}

      {hasActiveTabData && activeTab === 'rituals' ? (
        <SelfCareRitualsTab
          canAddCare={canUseSelfCareActions}
          list={list}
          history={history}
          plan={plan}
          dashboardItems={buildRitualDashboardItems(dashboard)}
          isBusy={isSelfCareActionBusy}
          isAddingCare={isAddingCare}
          ritualStepDrafts={ritualStepDrafts}
          todayKey={todayKey}
          uploadedIcons={uploadedIcons}
          onCardAction={handleCardAction}
          onArchiveItem={handleArchiveItem}
          onEditItem={handleEditItem}
          onRestartCourse={handleRestartCourse}
          onToggleRitualStep={handleToggleRitualStep}
          onAddCare={openCreateDialog}
        />
      ) : null}

      {hasActiveTabData && activeTab === 'history' ? (
        <SelfCareHistoryTab
          canAddCare={canUseSelfCareActions}
          defaultCurrency={defaultCurrency}
          history={history}
          isBusy={updateCompletionMutation.isPending || !canUseSelfCareActions}
          isAddingCare={isAddingCare}
          onAddCare={openCreateDialog}
          onEditCompletion={setCompletionEditDialogEntry}
        />
      ) : null}

      {hasActiveTabData && activeTab === 'analytics' ? (
        <Suspense
          fallback={
            <PageStateView
              kind="loading"
              skeletonVariant="cards"
              title="Загружаем аналитику"
            />
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

      {hasActiveTabData && activeTab === 'settings' ? (
        <SelfCareSettingsTab
          isBusy={isSelfCareActionBusy}
          disabledTemplateIds={disabledTemplateIds}
          settings={settingsResponse}
          templates={templates}
          onCreateFromTemplate={handleCreateFromTemplate}
          onUpdateSettings={handleUpdateSettings}
        />
      ) : null}

      {canShowCreateDialog && createDialogMode ? (
        <DeferredSelfCareCreateDialog
          mode={createDialogMode}
          defaultCurrency={defaultCurrency}
          errorMessage={createDialogErrorMessage}
          disabledTemplateIds={disabledTemplateIds}
          hasRequiredData={hasCreateDialogData}
          hasReadError={hasCreateDialogReadError}
          isBusy={
            isActionBusy || !canUseCreateDialogActions || !hasCreateDialogData
          }
          isLoading={isCreateDialogLoading}
          todayKey={todayKey}
          templates={templates}
          templatesLoaded={templatesLoaded}
          uploadedIcons={uploadedIcons}
          onBack={() => setCreateDialogMode('choice')}
          onClose={closeCreateDialog}
          onCreateCustom={handleCreateCustomCare}
          onCreateFromTemplate={(templateId) =>
            handleCreateFromTemplate(templateId, { closeAfterCreate: true })
          }
          onRetry={retrySelfCare}
          onSelectCustom={() => setCreateDialogMode('custom')}
          onSelectTemplate={() => setCreateDialogMode('template')}
        />
      ) : null}

      {scheduleDialogEntry ? (
        <DeferredSelfCareScheduleDialog
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
        <DeferredSelfCareMeasurementDialog
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
        <DeferredSelfCareExerciseDialog
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
        <DeferredSelfCareEditDialog
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

      {completionEditDialogEntry ? (
        <DeferredSelfCareCompletionEditDialog
          completion={completionEditDialogEntry}
          defaultCurrency={defaultCurrency}
          errorMessage={visibleFormError}
          initialCost={getCompletionCost(
            completionEditDialogEntry,
            history?.items.find(
              (item) => item.id === completionEditDialogEntry.itemId,
            ) ?? null,
            {
              appointmentDetails: history?.appointmentDetails ?? [],
              procedureDetails: history?.procedureDetails ?? [],
            },
          )}
          isBusy={updateCompletionMutation.isPending || !canUseSelfCareActions}
          item={
            history?.items.find(
              (item) => item.id === completionEditDialogEntry.itemId,
            ) ?? null
          }
          onClose={closeCompletionEditDialog}
          onSubmit={handleCompletionEditSubmit}
        />
      ) : null}

      {restartCourseDialogEntry ? (
        <DeferredSelfCareCourseRestartDialog
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

function SelfCareQueueStatus({
  isOffline,
  queue,
}: {
  isOffline: boolean
  queue: ReturnType<typeof useSelfCareOfflineQueue>
}) {
  if (queue.conflicted > 0) {
    return (
      <>
        <PageStatusBanner
          action={{
            label: 'Обновить и повторить',
            onClick: () => {
              void queue.refreshAndRetryConflicts()
            },
          }}
          description={`${queue.conflicted} ${queue.conflicted === 1 ? 'изменение требует' : 'изменения требуют'} сверки с актуальными данными. Ничего не заменено без вашего решения.`}
          kind="error"
          title="Нужно проверить изменения"
        />
        <PageStatusBanner
          action={{
            label: 'Отменить локальные изменения',
            onClick: () => {
              void queue.discardConflicts()
            },
          }}
          description="Конфликтующие изменения и зависящие от них локальные шаги будут отменены."
          kind="info"
          title="Можно оставить данные сервера"
        />
      </>
    )
  }

  if (queue.isDraining || queue.awaitingRefresh > 0) {
    return (
      <PageStatusBanner
        description="Сохранённые на устройстве изменения отправляются по порядку."
        kind="info"
        title="Синхронизируем изменения"
      />
    )
  }

  if (queue.failed > 0 && !isOffline) {
    return (
      <PageStatusBanner
        action={{
          label: 'Повторить',
          onClick: () => {
            void queue.retry()
          },
        }}
        description="Изменения остаются на устройстве. Можно повторить отправку."
        kind="error"
        title="Не все изменения синхронизированы"
      />
    )
  }

  if (queue.pending > 0 || queue.failed > 0) {
    const count = queue.pending + queue.failed
    return (
      <PageStatusBanner
        description={formatQueuedChangeCount(count)}
        kind={isOffline ? 'offline' : 'info'}
        title="Изменения сохранены на устройстве"
      />
    )
  }

  return null
}

function formatQueuedChangeCount(count: number): string {
  const remainder100 = count % 100
  const remainder10 = count % 10
  const noun =
    remainder10 === 1 && remainder100 !== 11
      ? 'изменение будет отправлено'
      : remainder10 >= 2 &&
          remainder10 <= 4 &&
          (remainder100 < 12 || remainder100 > 14)
        ? 'изменения будут отправлены'
        : 'изменений будут отправлены'

  return `${count} ${noun} после восстановления связи.`
}
