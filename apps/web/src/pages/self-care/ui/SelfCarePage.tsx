import type {
  SelfCareCompletionInput,
  SelfCareItemScheduleInput,
  SelfCareTodayItem,
} from '@planner/contracts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useUploadedIconAssets } from '@/features/emoji-library'
import {
  getSelfCareErrorMessage,
  useArchiveSelfCareItem,
  useCancelSelfCareOccurrence,
  useCompleteSelfCareCourseSession,
  useCompleteSelfCareFlexibleGoal,
  useCompleteSelfCareItemNow,
  useCompleteSelfCareOccurrence,
  useCreateSelfCareItem,
  useCreateSelfCareItemFromTemplate,
  useMoveSelfCareOccurrence,
  useScheduleSelfCareItem,
  useSelfCareAnalytics,
  useSelfCareDashboard,
  useSelfCareHistory,
  useSelfCareItems,
  useSelfCarePlan,
  useSelfCareRitualStepDrafts,
  useSelfCareSettings,
  useSelfCareTemplates,
  useSkipSelfCareOccurrence,
  useUpdateSelfCareItem,
  useUpdateSelfCareSettings,
  useUpsertSelfCareRitualStepDraft,
} from '@/features/self-care'
import { usePlannerTimeZone } from '@/features/session'
import { cx } from '@/shared/lib/classnames'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'
import pageStyles from '@/shared/ui/Page'

import {
  SelfCareAnalyticsTab,
  SelfCareCourseRestartDialog,
  SelfCareCreateDialog,
  SelfCareEditDialog,
  SelfCareHistoryTab,
  SelfCareMeasurementDialog,
  SelfCarePlanTab,
  SelfCareRitualsTab,
  SelfCareScheduleDialog,
  SelfCareSettingsTab,
  SelfCareTodayTab,
} from './SelfCarePage.components'
import {
  applyRitualStepDraftOverrides,
  buildCompletionInput,
  buildRitualStepCompletionInput,
  buildRitualStepDraftInput,
  buildRitualStepDraftMap,
  canRestartCourse,
  firstErrorMessage,
  formatDate,
  getCreatedTemplateIds,
  getInitialRitualStepDraft,
  getInitialScheduleDate,
  getRitualStepDraft,
  getRitualStepDraftKey,
  getSelfCareCreateDialogMode,
  getSelfCareTab,
  isVisibleSelfCareTemplate,
  type RitualStepDraftOverrides,
  SELF_CARE_ACTION_REQUEST_SEARCH_PARAM,
  SELF_CARE_ACTION_SEARCH_PARAM,
  SELF_CARE_PLAN_LOOKAHEAD_DAYS,
  SELF_CARE_TABS,
  type SelfCareCourseRestartPayload,
  type SelfCareCreateDialogMode,
  type SelfCareCustomCreatePayload,
  type SelfCareEditSubmitPayload,
  type SelfCareSettingsPatch,
  type SelfCareTab,
} from './SelfCarePage.helpers'
import styles from './SelfCarePage.module.css'
import {
  isEntryDoneToday,
  scheduleSelfCareEntryOccurrence,
} from './SelfCarePage.schedule'
export function SelfCarePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const rangeFrom = addDateDays(todayKey, -30)
  const planTo = addDateDays(todayKey, SELF_CARE_PLAN_LOOKAHEAD_DAYS)
  const activeTab = getSelfCareTab(searchParams)
  const createDialogMode = getSelfCareCreateDialogMode(searchParams)
  const tabsRef = useRef<HTMLElement | null>(null)
  const { uploadedIcons } = useUploadedIconAssets()
  const shouldLoadDashboard = activeTab === 'today' || activeTab === 'rituals'
  const shouldLoadItems =
    activeTab === 'today' ||
    activeTab === 'rituals' ||
    activeTab === 'settings' ||
    Boolean(createDialogMode)
  const shouldLoadPlan =
    activeTab === 'today' || activeTab === 'plan' || activeTab === 'rituals'
  const shouldLoadHistory =
    activeTab === 'today' ||
    activeTab === 'plan' ||
    activeTab === 'rituals' ||
    activeTab === 'history'
  const shouldLoadRitualStepDrafts =
    activeTab === 'today' || activeTab === 'rituals'
  const shouldLoadSettings =
    activeTab === 'settings' || Boolean(createDialogMode)
  const shouldLoadTemplates =
    activeTab === 'settings' || Boolean(createDialogMode)
  const dashboardQuery = useSelfCareDashboard(todayKey, {
    enabled: shouldLoadDashboard,
  })
  const itemsQuery = useSelfCareItems({ enabled: shouldLoadItems })
  const planQuery = useSelfCarePlan(todayKey, planTo, {
    enabled: shouldLoadPlan,
  })
  const stepDraftsQuery = useSelfCareRitualStepDrafts(todayKey, {
    enabled: shouldLoadRitualStepDrafts,
  })
  const historyQuery = useSelfCareHistory(rangeFrom, todayKey, {
    enabled: shouldLoadHistory,
  })
  const analyticsQuery = useSelfCareAnalytics(rangeFrom, todayKey, {
    enabled: activeTab === 'analytics',
  })
  const settingsQuery = useSelfCareSettings({ enabled: shouldLoadSettings })
  const templatesQuery = useSelfCareTemplates({ enabled: shouldLoadTemplates })
  const completeOccurrenceMutation = useCompleteSelfCareOccurrence()
  const completeItemNowMutation = useCompleteSelfCareItemNow()
  const completeFlexibleGoalMutation = useCompleteSelfCareFlexibleGoal()
  const completeCourseMutation = useCompleteSelfCareCourseSession()
  const cancelOccurrenceMutation = useCancelSelfCareOccurrence()
  const skipOccurrenceMutation = useSkipSelfCareOccurrence()
  const archiveItemMutation = useArchiveSelfCareItem()
  const scheduleItemMutation = useScheduleSelfCareItem()
  const moveOccurrenceMutation = useMoveSelfCareOccurrence()
  const createItemMutation = useCreateSelfCareItem()
  const createFromTemplateMutation = useCreateSelfCareItemFromTemplate()
  const updateItemMutation = useUpdateSelfCareItem()
  const updateSettingsMutation = useUpdateSelfCareSettings()
  const upsertRitualStepDraftMutation = useUpsertSelfCareRitualStepDraft()
  const [formError, setFormError] = useState<string | null>(null)
  const [scheduleDialogEntry, setScheduleDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [editDialogEntry, setEditDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [restartCourseDialogEntry, setRestartCourseDialogEntry] =
    useState<SelfCareTodayItem | null>(null)
  const [measurementDialogEntry, setMeasurementDialogEntry] =
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
  const dashboard = dashboardQuery.data
  const list = itemsQuery.data
  const plan = planQuery.data
  const history = historyQuery.data
  const analytics = analyticsQuery.data
  const settingsResponse =
    settingsQuery.data ??
    (dashboard ? { minimumItems: [], settings: dashboard.settings } : undefined)
  const defaultCurrency = settingsResponse?.settings.currency ?? 'RUB'
  const templates = useMemo(
    () => (templatesQuery.data ?? []).filter(isVisibleSelfCareTemplate),
    [templatesQuery.data],
  )
  const isActiveTabLoading =
    (activeTab === 'today' && dashboardQuery.isLoading && !dashboard) ||
    (activeTab === 'plan' && planQuery.isLoading && !plan) ||
    (activeTab === 'rituals' && itemsQuery.isLoading && !list) ||
    (activeTab === 'history' && historyQuery.isLoading && !history) ||
    (activeTab === 'analytics' && analyticsQuery.isLoading && !analytics) ||
    (activeTab === 'settings' && settingsQuery.isLoading && !settingsResponse)
  const serverRitualStepDrafts = useMemo(
    () =>
      stepDraftsQuery.data ? buildRitualStepDraftMap(stepDraftsQuery.data) : {},
    [stepDraftsQuery.data],
  )
  const ritualStepDrafts = useMemo(
    () =>
      applyRitualStepDraftOverrides(
        serverRitualStepDrafts,
        ritualStepDraftOverrides,
      ),
    [ritualStepDraftOverrides, serverRitualStepDrafts],
  )
  const createdTemplateIds = useMemo(() => getCreatedTemplateIds(list), [list])
  const disabledTemplateIds = useMemo(
    () => new Set([...createdTemplateIds, ...creatingTemplateIds]),
    [createdTemplateIds, creatingTemplateIds],
  )
  const isActionBusy =
    completeOccurrenceMutation.isPending ||
    completeItemNowMutation.isPending ||
    completeFlexibleGoalMutation.isPending ||
    completeCourseMutation.isPending ||
    cancelOccurrenceMutation.isPending ||
    skipOccurrenceMutation.isPending ||
    archiveItemMutation.isPending ||
    scheduleItemMutation.isPending ||
    moveOccurrenceMutation.isPending ||
    createItemMutation.isPending ||
    createFromTemplateMutation.isPending ||
    updateItemMutation.isPending ||
    updateSettingsMutation.isPending
  const errorMessage =
    formError ||
    firstErrorMessage([
      dashboardQuery.error,
      itemsQuery.error,
      planQuery.error,
      stepDraftsQuery.error,
      historyQuery.error,
      analyticsQuery.error,
      settingsQuery.error,
      templatesQuery.error,
      completeOccurrenceMutation.error,
      completeItemNowMutation.error,
      completeFlexibleGoalMutation.error,
      completeCourseMutation.error,
      cancelOccurrenceMutation.error,
      skipOccurrenceMutation.error,
      archiveItemMutation.error,
      scheduleItemMutation.error,
      moveOccurrenceMutation.error,
      createItemMutation.error,
      createFromTemplateMutation.error,
      updateItemMutation.error,
      updateSettingsMutation.error,
      upsertRitualStepDraftMutation.error,
    ])

  function setActiveTab(tab: SelfCareTab) {
    const next = new URLSearchParams(searchParams)
    if (tab === 'today') {
      next.delete('tab')
    } else {
      next.set('tab', tab)
    }
    setSearchParams(next, { replace: true })
  }

  function closeCreateDialog(): void {
    const next = new URLSearchParams(searchParams)
    next.delete(SELF_CARE_ACTION_SEARCH_PARAM)
    next.delete(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM)
    setSearchParams(next, { replace: true })
  }

  function closeCreateDialogAndShowTab(tab: SelfCareTab): void {
    const next = new URLSearchParams(searchParams)
    next.delete(SELF_CARE_ACTION_SEARCH_PARAM)
    next.delete(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM)

    if (tab === 'today') {
      next.delete('tab')
    } else {
      next.set('tab', tab)
    }

    setSearchParams(next, { replace: true })
  }

  function openCreateDialog(): void {
    const next = new URLSearchParams(searchParams)
    next.set(SELF_CARE_ACTION_SEARCH_PARAM, 'care')
    next.set(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM, 'choice')
    setSearchParams(next)
  }

  function setCreateDialogMode(mode: SelfCareCreateDialogMode): void {
    const next = new URLSearchParams(searchParams)
    next.set(SELF_CARE_ACTION_SEARCH_PARAM, 'care')
    next.set(SELF_CARE_ACTION_REQUEST_SEARCH_PARAM, mode)
    setSearchParams(next)
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

  useEffect(() => {
    const activeTabButton = tabsRef.current?.querySelector<HTMLElement>(
      '[aria-current="page"]',
    )

    activeTabButton?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    })
  }, [activeTab])

  return (
    <section className={`${pageStyles.page} ${styles.page}`}>
      {errorMessage ? <p className={styles.errorText}>{errorMessage}</p> : null}

      <nav
        ref={tabsRef}
        className={styles.tabs}
        aria-label="Разделы заботы о себе"
      >
        {SELF_CARE_TABS.map((tab) => (
          <button
            key={tab.id}
            className={cx(
              styles.tabButton,
              activeTab === tab.id && styles.tabButtonActive,
            )}
            type="button"
            aria-current={activeTab === tab.id ? 'page' : undefined}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

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
          isBusy={isActionBusy}
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
          isBusy={isActionBusy}
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
          dashboardItems={[
            ...(dashboard?.todayItems ?? []),
            ...(dashboard?.flexibleGoals ?? []),
          ]}
          isBusy={isActionBusy}
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
        <SelfCareAnalyticsTab
          analytics={analytics}
          defaultCurrency={defaultCurrency}
        />
      ) : null}

      {activeTab === 'settings' ? (
        <SelfCareSettingsTab
          isBusy={isActionBusy}
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
          isBusy={isActionBusy || !list}
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
          errorMessage={formError}
          isBusy={
            scheduleItemMutation.isPending || moveOccurrenceMutation.isPending
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
          errorMessage={formError}
          isBusy={
            completeOccurrenceMutation.isPending ||
            completeItemNowMutation.isPending
          }
          onClose={closeMeasurementDialog}
          onSubmit={handleMeasurementSubmit}
        />
      ) : null}

      {editDialogEntry ? (
        <SelfCareEditDialog
          defaultCurrency={defaultCurrency}
          entry={editDialogEntry}
          errorMessage={formError}
          isBusy={
            updateItemMutation.isPending ||
            scheduleItemMutation.isPending ||
            moveOccurrenceMutation.isPending
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
          errorMessage={formError}
          isBusy={updateItemMutation.isPending}
          todayKey={todayKey}
          onClose={closeRestartCourseDialog}
          onSubmit={handleRestartCourseSubmit}
        />
      ) : null}
    </section>
  )
}
