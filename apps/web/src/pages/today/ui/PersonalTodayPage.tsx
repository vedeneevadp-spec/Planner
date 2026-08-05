import { useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { useSelfCareDashboard } from '@/features/self-care'
import {
  usePlannerSession,
  usePlannerTimeZone,
  useUpdateUserPreferences,
} from '@/features/session'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import type { EnergyMode } from '../lib/resource-plan'
import {
  buildTodaySelfCareModel,
  getSelfCareTaskKey,
} from '../lib/today-self-care'
import { buildTodayTaskModel, getTodayTaskView } from '../lib/today-task-model'
import { useWidgetTaskComposerDraft } from '../model/useWidgetTaskComposerDraft'
import { ResourcePlanPanel } from './ResourcePlanPanel'
import { SelfCareTodayTaskCard } from './SelfCareTodayTaskCard'
import { TodayPageLayout } from './TodayPageLayout'
import { TodayTaskSections } from './TodayTaskSections'

export function PersonalTodayPage() {
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
  const taskView = getTodayTaskView(searchParams)
  const taskCardVariant = taskView === 'list' ? 'compact' : 'card'
  const taskModel = useMemo(
    () =>
      buildTodayTaskModel({
        plannerTimeZone,
        tasks,
        todayKey,
        tomorrowKey,
      }),
    [plannerTimeZone, tasks, todayKey, tomorrowKey],
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
    <TodayPageLayout openDraft={widgetTaskComposerDraft} todayKey={todayKey}>
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
        extras={{
          overdue: {
            itemCount: selfCareOverdueTaskCards.length,
            items: selfCareOverdueTaskCards,
          },
          routine: {
            itemCount: selfCareRoutineTaskCards.length,
            items: selfCareRoutineTaskCards,
          },
          tomorrow: {
            itemCount: selfCareTomorrowTaskCards.length,
            items: selfCareTomorrowTaskCards,
          },
        }}
        model={taskModel}
        spheres={spheres}
        taskView={taskView}
        tasks={tasks}
        todayKey={todayKey}
        tomorrowKey={tomorrowKey}
        uploadedIcons={uploadedIcons}
        workspace={{ kind: 'personal' }}
      />
    </TodayPageLayout>
  )
}
