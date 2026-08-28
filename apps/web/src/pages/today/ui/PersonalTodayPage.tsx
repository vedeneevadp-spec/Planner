import { type ReactNode, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { useSelfCareDashboard } from '@/features/self-care'
import {
  usePlannerSession,
  usePlannerTimeZone,
  useUpdateUserPreferences,
} from '@/features/session'
import { useTodayTaskView } from '@/shared/lib/today-task-view'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import type { EnergyMode } from '../lib/resource-plan'
import {
  buildTodaySelfCareModel,
  getSelfCareTaskKey,
} from '../lib/today-self-care'
import { buildTodayTaskModel } from '../lib/today-task-model'
import { useTodayClosedTaskPagination } from '../model/useTodayClosedTaskPagination'
import { useTodayRoutineSummary } from '../model/useTodayRoutineSummary'
import { useWidgetTaskComposerDraft } from '../model/useWidgetTaskComposerDraft'
import { ResourcePlanPanel } from './ResourcePlanPanel'
import { SelfCareTodayTaskCard } from './SelfCareTodayTaskCard'
import { TodayClosedTaskPagination } from './TodayClosedTaskPagination'
import { TodayPageLayout } from './TodayPageLayout'
import { TodayRoutineSummaryCards } from './TodayRoutineSummaryCards'
import { TodayTaskSections } from './TodayTaskSections'

export function PersonalTodayPage({
  openTaskId,
  status,
}: {
  openTaskId?: string | null | undefined
  status?: ReactNode
}) {
  const sessionQuery = usePlannerSession()
  const [searchParams] = useSearchParams()
  const updateUserPreferencesMutation = useUpdateUserPreferences()
  const {
    tasks,
    createNextTaskStage,
    copyTaskToPersonal,
    detachTaskFromChain,
    spheres,
    isTaskPending,
    moveTaskToPersonal,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
    taskReadModelCoverage,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const energyMode = sessionQuery.data?.userPreferences.energyMode ?? 'normal'
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const tomorrowKey = addDateDays(todayKey, 1)
  const widgetTaskComposerDraft = useWidgetTaskComposerDraft(todayKey)
  const selfCareDashboardEnabled =
    sessionQuery.data?.workspace.kind === 'personal'
  const selfCareDashboardQuery = useSelfCareDashboard(todayKey, {
    enabled: selfCareDashboardEnabled,
  })
  const tomorrowSelfCareDashboardQuery = useSelfCareDashboard(tomorrowKey, {
    enabled: selfCareDashboardEnabled,
  })
  const taskView = useTodayTaskView(searchParams)
  const taskCardVariant = taskView === 'list' ? 'compact' : 'card'
  const routineSummary = useTodayRoutineSummary(todayKey)
  const closedTaskPagination = useTodayClosedTaskPagination({
    initialCursor: taskReadModelCoverage?.historyNextCursor ?? null,
    initialReturnedCount:
      taskReadModelCoverage?.sources.history.returnedCount ?? 0,
    plannerTimeZone,
    tasks,
    totalCount: taskReadModelCoverage?.sources.history.totalCount ?? 0,
  })
  const taskModel = useMemo(
    () =>
      buildTodayTaskModel({
        plannerTimeZone,
        tasks: closedTaskPagination.tasks,
        todayKey,
        tomorrowKey,
      }),
    [closedTaskPagination.tasks, plannerTimeZone, todayKey, tomorrowKey],
  )
  const selfCareModel = useMemo(
    () =>
      buildTodaySelfCareModel({
        todayDashboard: selfCareDashboardQuery.data,
        tomorrowDashboard: tomorrowSelfCareDashboardQuery.data,
      }),
    [selfCareDashboardQuery.data, tomorrowSelfCareDashboardQuery.data],
  )
  const selfCareRoutineTaskCards = selfCareModel.routineEntries.map((entry) => (
    <SelfCareTodayTaskCard
      key={getSelfCareTaskKey(entry)}
      entry={entry}
      plannerTimeZone={plannerTimeZone}
      uploadedIcons={uploadedIcons}
      variant={taskCardVariant}
    />
  ))
  const selfCareOverdueTaskCards = selfCareModel.overdueEntries.map((entry) => (
    <SelfCareTodayTaskCard
      key={`overdue-${getSelfCareTaskKey(entry)}`}
      entry={entry}
      plannerTimeZone={plannerTimeZone}
      uploadedIcons={uploadedIcons}
      variant={taskCardVariant}
    />
  ))
  const selfCareTomorrowTaskCards = selfCareModel.tomorrowEntries.map(
    (entry) => (
      <SelfCareTodayTaskCard
        key={`tomorrow-${getSelfCareTaskKey(entry)}`}
        entry={entry}
        plannerTimeZone={plannerTimeZone}
        uploadedIcons={uploadedIcons}
        variant={taskCardVariant}
      />
    ),
  )

  function selectEnergyMode(nextEnergyMode: EnergyMode) {
    if (
      sessionQuery.data &&
      nextEnergyMode !== sessionQuery.data.userPreferences.energyMode
    ) {
      updateUserPreferencesMutation.mutate({
        energyMode: nextEnergyMode,
      })
    }
  }

  return (
    <TodayPageLayout
      openDraft={widgetTaskComposerDraft}
      status={status}
      todayKey={todayKey}
    >
      <ResourcePlanPanel
        energyMode={energyMode}
        isTaskPending={isTaskPending}
        tasks={taskModel.resourceTasks}
        onEnergyModeChange={selectEnergyMode}
        onMoveTaskTomorrow={(taskId) => {
          void setTaskPlannedDate(taskId, tomorrowKey)
        }}
      />

      <TodayTaskSections
        actions={{
          copyTaskToPersonal,
          createNextTaskStage,
          detachTaskFromChain,
          isTaskPending,
          moveTaskToPersonal,
          removeTask,
          setTaskPlannedDate,
          setTaskStatus,
          updateTask,
        }}
        closedTaskPagination={
          <TodayClosedTaskPagination
            errorMessage={closedTaskPagination.errorMessage}
            hasMore={closedTaskPagination.hasMore}
            isLoading={closedTaskPagination.isLoading}
            loadedCount={closedTaskPagination.loadedCount}
            totalCount={closedTaskPagination.totalCount}
            onLoadMore={() => {
              void closedTaskPagination.loadMore()
            }}
          />
        }
        extras={{
          overdue: {
            itemCount: selfCareOverdueTaskCards.length,
            items: selfCareOverdueTaskCards,
          },
          routine: {
            itemCount:
              routineSummary.itemCount + selfCareRoutineTaskCards.length,
            items: (
              <>
                <TodayRoutineSummaryCards
                  {...routineSummary}
                  variant={taskCardVariant}
                />
                {selfCareRoutineTaskCards}
              </>
            ),
          },
          tomorrow: {
            itemCount: selfCareTomorrowTaskCards.length,
            items: selfCareTomorrowTaskCards,
          },
        }}
        model={taskModel}
        openTaskId={openTaskId}
        spheres={spheres}
        taskView={taskView}
        tasks={closedTaskPagination.tasks}
        todayKey={todayKey}
        tomorrowKey={tomorrowKey}
        uploadedIcons={uploadedIcons}
        workspace={{ kind: 'personal' }}
      />
    </TodayPageLayout>
  )
}
