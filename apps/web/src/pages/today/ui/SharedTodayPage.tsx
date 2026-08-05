import { useMemo } from 'react'
import { useSearchParams } from 'react-router'

import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import {
  usePlannerSession,
  usePlannerTimeZone,
  useWorkspaceUsers,
} from '@/features/session'
import { addDateDays, getTodayDate } from '@/shared/time/time.service'

import { buildTodayTaskModel, getTodayTaskView } from '../lib/today-task-model'
import { useWidgetTaskComposerDraft } from '../model/useWidgetTaskComposerDraft'
import { TodayPageLayout } from './TodayPageLayout'
import { TodayTaskSections } from './TodayTaskSections'

export function SharedTodayPage() {
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
  const taskView = getTodayTaskView(searchParams)
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
    <TodayPageLayout openDraft={widgetTaskComposerDraft} todayKey={todayKey}>
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
