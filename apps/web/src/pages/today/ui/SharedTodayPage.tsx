import { type ReactNode, useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import {
  usePlannerSession,
  usePlannerTimeZone,
  useWorkspaceUsers,
} from '@/features/session'
import { useTodayTaskView } from '@/shared/lib/today-task-view'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import { buildTodayTaskModel } from '../lib/today-task-model'
import { useTodayRoutineSummary } from '../model/useTodayRoutineSummary'
import { useWidgetTaskComposerDraft } from '../model/useWidgetTaskComposerDraft'
import { TodayPageLayout } from './TodayPageLayout'
import { TodayRoutineSummaryCards } from './TodayRoutineSummaryCards'
import { TodayTaskSections } from './TodayTaskSections'

export function SharedTodayPage({ status }: { status?: ReactNode }) {
  const { data: session } = usePlannerSession()
  const [searchParams] = useSearchParams()
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
  const workspaceUsersQuery = useWorkspaceUsers()
  const workspaceUsers = workspaceUsersQuery.data?.users ?? []
  const plannerTimeZone = usePlannerTimeZone()
  const todayKey = getTodayDate(plannerTimeZone)
  const tomorrowKey = addDateDays(todayKey, 1)
  const widgetTaskComposerDraft = useWidgetTaskComposerDraft(todayKey)
  const taskView = useTodayTaskView(searchParams)
  const routineSummary = useTodayRoutineSummary(todayKey)
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

  return (
    <TodayPageLayout
      openDraft={widgetTaskComposerDraft}
      status={status}
      todayKey={todayKey}
    >
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
          routine: {
            itemCount: routineSummary.itemCount,
            items: (
              <TodayRoutineSummaryCards
                {...routineSummary}
                variant={taskView === 'list' ? 'compact' : 'card'}
              />
            ),
          },
        }}
        model={taskModel}
        spheres={spheres}
        taskView={taskView}
        tasks={tasks}
        todayKey={todayKey}
        tomorrowKey={tomorrowKey}
        uploadedIcons={uploadedIcons}
        workspace={{
          currentActorUserId: session?.actorUserId,
          kind: 'shared',
          sharedWorkspaceGroupRole: session?.groupRole,
          sharedWorkspaceRole: session?.role,
          workspaceUsers,
        }}
      />
    </TodayPageLayout>
  )
}
