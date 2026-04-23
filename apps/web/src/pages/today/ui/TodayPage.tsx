import { useEffect, useMemo, useState } from 'react'

import {
  selectDoneTodayTasks,
  selectTodayTasks,
  selectTodoTasks,
  selectTomorrowTasks,
  type Task,
  TaskSection,
} from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { usePlannerSession } from '@/features/session'
import { TaskComposer } from '@/features/task-create'
import { addDays, getDateKey } from '@/shared/lib/date'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import type { EnergyMode } from '../lib/resource-plan'
import { ResourcePlanPanel } from './ResourcePlanPanel'

const ENERGY_MODE_STORAGE_KEY = 'planner.today.energyMode'

function isRoutineTask(task: Task): boolean {
  return task.urgency === 'urgent'
}

function readStoredEnergyMode(): EnergyMode {
  if (typeof window === 'undefined') {
    return 'normal'
  }

  const value = window.localStorage.getItem(ENERGY_MODE_STORAGE_KEY)

  return value === 'minimum' || value === 'maximum' || value === 'normal'
    ? value
    : 'normal'
}

export function TodayPage() {
  const { data: session } = usePlannerSession()

  return session?.workspace.kind === 'shared' ? (
    <SharedTodayPage />
  ) : (
    <PersonalTodayPage />
  )
}

function PersonalTodayPage() {
  const {
    tasks,
    projects,
    isTaskPending,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const [energyMode, setEnergyMode] = useState<EnergyMode>(readStoredEnergyMode)
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  useEffect(() => {
    window.localStorage.setItem(ENERGY_MODE_STORAGE_KEY, energyMode)
  }, [energyMode])

  const todayTasks = useMemo(
    () => selectTodayTasks(tasks, todayKey),
    [tasks, todayKey],
  )
  const doneTodayTasks = useMemo(
    () => selectDoneTodayTasks(tasks, todayKey),
    [tasks, todayKey],
  )
  const routineTasks = useMemo(
    () => todayTasks.filter((task) => isRoutineTask(task)),
    [todayTasks],
  )
  const mainTodayTasks = useMemo(
    () => todayTasks.filter((task) => !isRoutineTask(task)),
    [todayTasks],
  )
  const tomorrowTasks = useMemo(
    () => selectTomorrowTasks(tasks, tomorrowKey),
    [tasks, tomorrowKey],
  )
  const visibleTaskIds = useMemo(
    () =>
      new Set([
        ...mainTodayTasks.map((task) => task.id),
        ...routineTasks.map((task) => task.id),
        ...tomorrowTasks.map((task) => task.id),
      ]),
    [mainTodayTasks, routineTasks, tomorrowTasks],
  )
  const otherTasks = useMemo(
    () => selectTodoTasks(tasks).filter((task) => !visibleTaskIds.has(task.id)),
    [tasks, visibleTaskIds],
  )
  const resourceTasks = useMemo(
    () => [...todayTasks, ...doneTodayTasks],
    [doneTodayTasks, todayTasks],
  )

  function renderTaskSection(
    title: string,
    sectionTasks: Task[],
    emptyMessage: string,
    tone: 'default' | 'warning' | 'success' = 'default',
  ) {
    return (
      <TaskSection
        title={title}
        tasks={sectionTasks}
        projects={projects}
        uploadedIcons={uploadedIcons}
        emptyMessage={emptyMessage}
        isTaskPending={isTaskPending}
        tone={tone}
        onRemove={(taskId) => {
          void removeTask(taskId)
        }}
        onSetPlannedDate={(taskId, plannedDate) => {
          void setTaskPlannedDate(taskId, plannedDate)
        }}
        onSetStatus={(taskId, status) => {
          void setTaskStatus(taskId, status)
        }}
        onUpdate={updateTask}
      />
    )
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Focus"
        actions={<TaskComposer initialPlannedDate={todayKey} />}
      />

      <ResourcePlanPanel
        energyMode={energyMode}
        isTaskPending={isTaskPending}
        tasks={resourceTasks}
        onEnergyModeChange={setEnergyMode}
        onMoveTaskTomorrow={(taskId) => {
          void setTaskPlannedDate(taskId, tomorrowKey)
        }}
      />

      <div className={pageStyles.gridTwo}>
        {renderTaskSection(
          'Сегодня',
          mainTodayTasks,
          'На сегодня пока нет задач.',
        )}
        {renderTaskSection(
          'Рутина',
          routineTasks,
          'Рутинных задач на сегодня пока нет.',
        )}
      </div>

      <div className={pageStyles.gridTwo}>
        {renderTaskSection(
          'Завтра',
          tomorrowTasks,
          'На завтра пока ничего нет.',
        )}
        {renderTaskSection(
          'Остальные задачи',
          otherTasks,
          'Все активные задачи уже разложены на сегодня или завтра.',
        )}
      </div>

      {renderTaskSection(
        'Выполнено сегодня',
        doneTodayTasks,
        'Когда начнёшь закрывать задачи, последние завершённые появятся здесь.',
        'success',
      )}
    </section>
  )
}

function SharedTodayPage() {
  const {
    tasks,
    projects,
    isTaskPending,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const todayTasks = useMemo(
    () => selectTodayTasks(tasks, todayKey),
    [tasks, todayKey],
  )
  const tomorrowTasks = useMemo(
    () => selectTomorrowTasks(tasks, tomorrowKey),
    [tasks, tomorrowKey],
  )
  const doneTodayTasks = useMemo(
    () => selectDoneTodayTasks(tasks, todayKey),
    [tasks, todayKey],
  )
  const visibleTaskIds = useMemo(
    () =>
      new Set([
        ...todayTasks.map((task) => task.id),
        ...tomorrowTasks.map((task) => task.id),
      ]),
    [todayTasks, tomorrowTasks],
  )
  const otherTasks = useMemo(
    () => selectTodoTasks(tasks).filter((task) => !visibleTaskIds.has(task.id)),
    [tasks, visibleTaskIds],
  )

  function renderTaskSection(
    title: string,
    sectionTasks: Task[],
    emptyMessage: string,
    tone: 'default' | 'warning' | 'success' = 'default',
  ) {
    return (
      <TaskSection
        title={title}
        tasks={sectionTasks}
        projects={projects}
        uploadedIcons={uploadedIcons}
        emptyMessage={emptyMessage}
        isTaskPending={isTaskPending}
        tone={tone}
        onRemove={(taskId) => {
          void removeTask(taskId)
        }}
        onSetPlannedDate={(taskId, plannedDate) => {
          void setTaskPlannedDate(taskId, plannedDate)
        }}
        onSetStatus={(taskId, status) => {
          void setTaskStatus(taskId, status)
        }}
        onUpdate={updateTask}
      />
    )
  }

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Shared Today"
        actions={<TaskComposer initialPlannedDate={todayKey} />}
      />

      <div className={pageStyles.gridTwo}>
        {renderTaskSection(
          'Сегодня',
          todayTasks,
          'В общем workspace на сегодня пока нет задач.',
        )}
        {renderTaskSection(
          'Завтра',
          tomorrowTasks,
          'На завтра в общем workspace пока ничего нет.',
        )}
      </div>

      <div className={pageStyles.gridTwo}>
        {renderTaskSection(
          'Остальные задачи',
          otherTasks,
          'Все активные задачи уже разложены на сегодня или завтра.',
        )}
        {renderTaskSection(
          'Выполнено сегодня',
          doneTodayTasks,
          'Закрытые сегодня задачи общего workspace появятся здесь.',
          'success',
        )}
      </div>
    </section>
  )
}
