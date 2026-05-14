import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  getNextHabitEntryProgressValue,
  type HabitTodayListItem,
  isHabitEntryComplete,
} from '@/entities/habit'
import {
  selectDoneBeforeTodayTasks,
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
  selectTodoTasks,
  selectTomorrowTasks,
  type Task,
  TaskSection,
} from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import {
  HabitRoutineTaskCard,
  useHabitsToday,
  useRemoveHabitEntry,
  useUpsertHabitEntry,
} from '@/features/habits'
import { usePlanner } from '@/features/planner'
import { usePlannerSession, useWorkspaceUsers } from '@/features/session'
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
import { addDays, getDateKey } from '@/shared/lib/date'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import type { EnergyMode } from '../lib/resource-plan'
import { ResourcePlanPanel } from './ResourcePlanPanel'
import styles from './TodayPage.module.css'

const ENERGY_MODE_STORAGE_KEY = 'planner.today.energyMode'

type TaskSectionTone = 'default' | 'warning' | 'success'

interface TaskSectionOptions {
  defaultCollapsed?: boolean
  extraItemCount?: number
  extraItems?: ReactNode
  tone?: TaskSectionTone
}

function isRoutineTask(task: Task): boolean {
  return Boolean(task.routine)
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

function useWidgetTaskComposerDraft(
  todayKey: string,
): TaskComposerDraft | null {
  const [searchParams, setSearchParams] = useSearchParams()
  const createTaskRequestId = searchParams.get('createTask')

  useEffect(() => {
    if (!createTaskRequestId) {
      return
    }

    const nextSearchParams = new URLSearchParams(searchParams)
    nextSearchParams.delete('createTask')
    setSearchParams(nextSearchParams, { replace: true })
  }, [createTaskRequestId, searchParams, setSearchParams])

  return useMemo(
    () =>
      createTaskRequestId
        ? {
            plannedDate: todayKey,
            requestId: createTaskRequestId,
          }
        : null,
    [createTaskRequestId, todayKey],
  )
}

function useTodayHabitRoutine(todayKey: string) {
  const habitsTodayQuery = useHabitsToday(todayKey)
  const upsertHabitEntry = useUpsertHabitEntry()
  const removeHabitEntry = useRemoveHabitEntry()
  const habitItems = useMemo(
    () => habitsTodayQuery.data?.items ?? [],
    [habitsTodayQuery.data?.items],
  )
  const activeHabitItems = useMemo(
    () =>
      habitItems.filter(
        (item) =>
          item.entry?.status !== 'skipped' &&
          !isHabitEntryComplete(item.habit, item.entry),
      ),
    [habitItems],
  )
  const completedHabitItems = useMemo(
    () =>
      habitItems.filter((item) => isHabitEntryComplete(item.habit, item.entry)),
    [habitItems],
  )
  const isHabitPending =
    upsertHabitEntry.isPending || removeHabitEntry.isPending
  const completeHabit = useCallback(
    (item: HabitTodayListItem) => {
      upsertHabitEntry.mutate({
        date: todayKey,
        habitId: item.habit.id,
        input: {
          date: todayKey,
          expectedVersion: item.entry?.version,
          note: item.entry?.note ?? '',
          status: 'done',
          value: getNextHabitEntryProgressValue(item.habit, item.entry),
        },
      })
    },
    [todayKey, upsertHabitEntry],
  )
  const undoHabit = useCallback(
    (item: HabitTodayListItem) => {
      removeHabitEntry.mutate({
        date: todayKey,
        habitId: item.habit.id,
        input: item.entry ? { expectedVersion: item.entry.version } : {},
      })
    },
    [removeHabitEntry, todayKey],
  )

  return {
    activeHabitItems,
    completedHabitItems,
    completeHabit,
    isHabitPending,
    undoHabit,
  }
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
  const widgetTaskComposerDraft = useWidgetTaskComposerDraft(todayKey)
  const todayHabitRoutine = useTodayHabitRoutine(todayKey)
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
  const doneHistoryTasks = useMemo(
    () => selectDoneBeforeTodayTasks(tasks, todayKey),
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
  const routineHabitCards = todayHabitRoutine.activeHabitItems.map((item) => (
    <HabitRoutineTaskCard
      key={item.habit.id}
      item={item}
      isPending={todayHabitRoutine.isHabitPending}
      uploadedIcons={uploadedIcons}
      onComplete={todayHabitRoutine.completeHabit}
      onUndo={todayHabitRoutine.undoHabit}
    />
  ))
  const completedHabitCards = todayHabitRoutine.completedHabitItems.map(
    (item) => (
      <HabitRoutineTaskCard
        key={item.habit.id}
        item={item}
        isPending={todayHabitRoutine.isHabitPending}
        tone="success"
        uploadedIcons={uploadedIcons}
        onComplete={todayHabitRoutine.completeHabit}
        onUndo={todayHabitRoutine.undoHabit}
      />
    ),
  )

  function buildTaskSection(
    key: string,
    title: string,
    sectionTasks: Task[],
    emptyMessage: string,
    options: TaskSectionOptions = {},
  ): ReactElement | null {
    if (sectionTasks.length === 0) {
      if ((options.extraItemCount ?? 0) === 0) {
        return null
      }
    }

    if (sectionTasks.length === 0 && !options.extraItems) {
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
        defaultCollapsed={options.defaultCollapsed}
        extraItemCount={options.extraItemCount}
        extraItems={options.extraItems}
        tone={options.tone ?? 'default'}
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
          actions={
            <TaskComposer
              initialPlannedDate={todayKey}
              openDraft={widgetTaskComposerDraft}
            />
          }
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
              {
                extraItemCount: todayHabitRoutine.activeHabitItems.length,
                extraItems: routineHabitCards,
              },
            ),
          ])}

          {buildTaskSection(
            'overdue',
            'Требуют внимания',
            overdueTasks,
            'Просроченных задач сейчас нет.',
            { tone: 'warning' },
          )}

          {renderTaskSectionGroup([
            buildTaskSection(
              'tomorrow',
              'Завтра',
              tomorrowTasks,
              'На завтра пока ничего нет.',
              { defaultCollapsed: true },
            ),
            buildTaskSection(
              'other',
              'Остальные задачи',
              otherTasks,
              'Все активные задачи уже разложены на сегодня, просрочку или завтра.',
              { defaultCollapsed: true },
            ),
          ])}

          {buildTaskSection(
            'done-today',
            'Выполнено сегодня',
            doneTodayTasks,
            'Когда начнёшь закрывать задачи, последние завершённые появятся здесь.',
            {
              defaultCollapsed: true,
              extraItemCount: todayHabitRoutine.completedHabitItems.length,
              extraItems: completedHabitCards,
              tone: 'success',
            },
          )}

          {buildTaskSection(
            'done-history',
            'История задач',
            doneHistoryTasks,
            'Выполненные раньше задачи появятся здесь.',
            { defaultCollapsed: true, tone: 'success' },
          )}
        </div>
      </div>
    </section>
  )
}

function SharedTodayPage() {
  const { data: session } = usePlannerSession()
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
  const widgetTaskComposerDraft = useWidgetTaskComposerDraft(todayKey)
  const todayHabitRoutine = useTodayHabitRoutine(todayKey)
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const todayTasks = useMemo(
    () => selectTodayTasks(tasks, todayKey),
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
  const doneTodayTasks = useMemo(
    () => selectDoneTodayTasks(tasks, todayKey),
    [tasks, todayKey],
  )
  const doneHistoryTasks = useMemo(
    () => selectDoneBeforeTodayTasks(tasks, todayKey),
    [tasks, todayKey],
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
  const routineHabitCards = todayHabitRoutine.activeHabitItems.map((item) => (
    <HabitRoutineTaskCard
      key={item.habit.id}
      item={item}
      isPending={todayHabitRoutine.isHabitPending}
      uploadedIcons={uploadedIcons}
      onComplete={todayHabitRoutine.completeHabit}
      onUndo={todayHabitRoutine.undoHabit}
    />
  ))
  const completedHabitCards = todayHabitRoutine.completedHabitItems.map(
    (item) => (
      <HabitRoutineTaskCard
        key={item.habit.id}
        item={item}
        isPending={todayHabitRoutine.isHabitPending}
        tone="success"
        uploadedIcons={uploadedIcons}
        onComplete={todayHabitRoutine.completeHabit}
        onUndo={todayHabitRoutine.undoHabit}
      />
    ),
  )

  function buildTaskSection(
    key: string,
    title: string,
    sectionTasks: Task[],
    emptyMessage: string,
    options: TaskSectionOptions = {},
  ): ReactElement | null {
    if (sectionTasks.length === 0) {
      if ((options.extraItemCount ?? 0) === 0) {
        return null
      }
    }

    if (sectionTasks.length === 0 && !options.extraItems) {
      return null
    }

    return (
      <TaskSection
        key={key}
        title={title}
        tasks={sectionTasks}
        currentActorUserId={session?.actorUserId}
        isSharedWorkspace
        sharedWorkspaceGroupRole={session?.groupRole}
        sharedWorkspaceRole={session?.role}
        projects={projects}
        uploadedIcons={uploadedIcons}
        workspaceUsers={workspaceUsers}
        emptyMessage={emptyMessage}
        isTaskPending={isTaskPending}
        defaultCollapsed={options.defaultCollapsed}
        extraItemCount={options.extraItemCount}
        extraItems={options.extraItems}
        tone={options.tone ?? 'default'}
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
          actions={
            <TaskComposer
              initialPlannedDate={todayKey}
              openDraft={widgetTaskComposerDraft}
            />
          }
        />
      </div>

      <div className={styles.taskScroll}>
        <div className={styles.taskScrollInner}>
          {renderTaskSectionGroup([
            buildTaskSection(
              'today',
              'Сегодня',
              mainTodayTasks,
              'В общем workspace на сегодня пока нет задач.',
            ),
            buildTaskSection(
              'routine',
              'Рутина',
              routineTasks,
              'Рутинных задач на сегодня пока нет.',
              {
                extraItemCount: todayHabitRoutine.activeHabitItems.length,
                extraItems: routineHabitCards,
              },
            ),
          ])}

          {buildTaskSection(
            'overdue',
            'Требуют внимания',
            overdueTasks,
            'Просроченных задач сейчас нет.',
            { tone: 'warning' },
          )}

          {renderTaskSectionGroup([
            buildTaskSection(
              'tomorrow',
              'Завтра',
              tomorrowTasks,
              'На завтра в общем workspace пока ничего нет.',
              { defaultCollapsed: true },
            ),
            buildTaskSection(
              'other',
              'Остальные задачи',
              otherTasks,
              'Все активные задачи уже разложены на сегодня, просрочку или завтра.',
              { defaultCollapsed: true },
            ),
          ])}

          {buildTaskSection(
            'done-today',
            'Выполнено сегодня',
            doneTodayTasks,
            'Закрытые сегодня задачи общего workspace появятся здесь.',
            {
              defaultCollapsed: true,
              extraItemCount: todayHabitRoutine.completedHabitItems.length,
              extraItems: completedHabitCards,
              tone: 'success',
            },
          )}

          {buildTaskSection(
            'done-history',
            'История задач',
            doneHistoryTasks,
            'Закрытые раньше задачи общего workspace появятся здесь.',
            { defaultCollapsed: true, tone: 'success' },
          )}
        </div>
      </div>
    </section>
  )
}
