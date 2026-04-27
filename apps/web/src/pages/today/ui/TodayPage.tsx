import { type ReactElement, useEffect, useMemo, useState } from 'react'

import {
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
  selectTodoTasks,
  selectTomorrowTasks,
  type Task,
  TaskSection,
} from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { usePlannerSession, useWorkspaceUsers } from '@/features/session'
import { TaskComposer } from '@/features/task-create'
import { addDays, getDateKey } from '@/shared/lib/date'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import type { EnergyMode } from '../lib/resource-plan'
import { ResourcePlanPanel } from './ResourcePlanPanel'
import styles from './TodayPage.module.css'

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

function renderTaskSectionGroup(
  sections: Array<ReactElement | null>,
): ReactElement | null {
  const visibleSections = sections.filter(
    (section): section is ReactElement => section !== null,
  )

  if (visibleSections.length === 0) {
    return null
  }

  if (visibleSections.length === 1) {
    return visibleSections[0] ?? null
  }

  return <div className={pageStyles.gridTwo}>{visibleSections}</div>
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
  const overdueTasks = useMemo(
    () => selectOverdueTasks(tasks, todayKey),
    [tasks, todayKey],
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
        ...overdueTasks.map((task) => task.id),
        ...tomorrowTasks.map((task) => task.id),
      ]),
    [mainTodayTasks, overdueTasks, routineTasks, tomorrowTasks],
  )
  const otherTasks = useMemo(
    () => selectTodoTasks(tasks).filter((task) => !visibleTaskIds.has(task.id)),
    [tasks, visibleTaskIds],
  )
  const resourceTasks = useMemo(
    () => [...todayTasks, ...doneTodayTasks],
    [doneTodayTasks, todayTasks],
  )

  function buildTaskSection(
    key: string,
    title: string,
    sectionTasks: Task[],
    emptyMessage: string,
    tone: 'default' | 'warning' | 'success' = 'default',
  ): ReactElement | null {
    if (sectionTasks.length === 0) {
      return null
    }

    return (
      <TaskSection
        key={key}
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
    <section className={`${pageStyles.page} ${styles.todayPage}`}>
      <div className={styles.fixedTop}>
        <PageHeader
          kicker="Focus"
          actions={<TaskComposer initialPlannedDate={todayKey} />}
        />
      </div>

      <div className={styles.taskScroll}>
        <div className={styles.taskScrollInner}>
          <ResourcePlanPanel
            energyMode={energyMode}
            isTaskPending={isTaskPending}
            tasks={resourceTasks}
            onEnergyModeChange={setEnergyMode}
            onMoveTaskTomorrow={(taskId) => {
              void setTaskPlannedDate(taskId, tomorrowKey)
            }}
          />

          {renderTaskSectionGroup([
            buildTaskSection(
              'today',
              'Сегодня',
              mainTodayTasks,
              'На сегодня пока нет задач.',
            ),
            buildTaskSection(
              'routine',
              'Рутина',
              routineTasks,
              'Рутинных задач на сегодня пока нет.',
            ),
          ])}

          {buildTaskSection(
            'overdue',
            'Требуют внимания',
            overdueTasks,
            'Просроченных задач сейчас нет.',
            'warning',
          )}

          {renderTaskSectionGroup([
            buildTaskSection(
              'tomorrow',
              'Завтра',
              tomorrowTasks,
              'На завтра пока ничего нет.',
            ),
            buildTaskSection(
              'other',
              'Остальные задачи',
              otherTasks,
              'Все активные задачи уже разложены на сегодня, просрочку или завтра.',
            ),
          ])}

          {buildTaskSection(
            'done-today',
            'Выполнено сегодня',
            doneTodayTasks,
            'Когда начнёшь закрывать задачи, последние завершённые появятся здесь.',
            'success',
          )}
        </div>
      </div>
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
  const workspaceUsersQuery = useWorkspaceUsers()
  const workspaceUsers = workspaceUsersQuery.data?.users ?? []
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const todayTasks = useMemo(
    () => selectTodayTasks(tasks, todayKey),
    [tasks, todayKey],
  )
  const overdueTasks = useMemo(
    () => selectOverdueTasks(tasks, todayKey),
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
        ...overdueTasks.map((task) => task.id),
        ...tomorrowTasks.map((task) => task.id),
      ]),
    [overdueTasks, todayTasks, tomorrowTasks],
  )
  const otherTasks = useMemo(
    () => selectTodoTasks(tasks).filter((task) => !visibleTaskIds.has(task.id)),
    [tasks, visibleTaskIds],
  )

  function buildTaskSection(
    key: string,
    title: string,
    sectionTasks: Task[],
    emptyMessage: string,
    tone: 'default' | 'warning' | 'success' = 'default',
  ): ReactElement | null {
    if (sectionTasks.length === 0) {
      return null
    }

    return (
      <TaskSection
        key={key}
        title={title}
        tasks={sectionTasks}
        isSharedWorkspace
        projects={projects}
        uploadedIcons={uploadedIcons}
        workspaceUsers={workspaceUsers}
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
    <section className={`${pageStyles.page} ${styles.todayPage}`}>
      <div className={styles.fixedTop}>
        <PageHeader
          kicker="Shared Today"
          title="Сегодня"
          actions={<TaskComposer initialPlannedDate={todayKey} />}
        />
      </div>

      <div className={styles.taskScroll}>
        <div className={styles.taskScrollInner}>
          {buildTaskSection(
            'today',
            'Сегодня',
            todayTasks,
            'В общем workspace на сегодня пока нет задач.',
          )}

          {buildTaskSection(
            'overdue',
            'Требуют внимания',
            overdueTasks,
            'Просроченных задач сейчас нет.',
            'warning',
          )}

          {renderTaskSectionGroup([
            buildTaskSection(
              'tomorrow',
              'Завтра',
              tomorrowTasks,
              'На завтра в общем workspace пока ничего нет.',
            ),
            buildTaskSection(
              'other',
              'Остальные задачи',
              otherTasks,
              'Все активные задачи уже разложены на сегодня, просрочку или завтра.',
            ),
          ])}

          {buildTaskSection(
            'done-today',
            'Выполнено сегодня',
            doneTodayTasks,
            'Закрытые сегодня задачи общего workspace появятся здесь.',
            'success',
          )}
        </div>
      </div>
    </section>
  )
}
