import type { SelfCareTodayItem } from '@planner/contracts'
import {
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  getNextHabitEntryProgressValue,
  type HabitTodayListItem,
  isHabitEntryComplete,
} from '@/entities/habit'
import {
  selectArchivedTasks,
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
import { useSelfCareDashboard } from '@/features/self-care'
import {
  usePlannerSession,
  useUpdateUserPreferences,
  useWorkspaceUsers,
} from '@/features/session'
import { TaskComposer, type TaskComposerDraft } from '@/features/task-create'
import { addDays, getDateKey } from '@/shared/lib/date'
import { IconMark, type UploadedIconAsset } from '@/shared/ui/Icon'
import pageStyles from '@/shared/ui/Page'

import type { EnergyMode } from '../lib/resource-plan'
import { ResourcePlanPanel } from './ResourcePlanPanel'
import styles from './TodayPage.module.css'

type TaskSectionTone = 'default' | 'warning' | 'success'
type TodayTaskView = 'cards' | 'list'

const TASK_VIEW_SEARCH_PARAM = 'taskView'
const HIDDEN_SELF_CARE_OCCURRENCE_STATUSES: ReadonlySet<
  NonNullable<SelfCareTodayItem['occurrence']>['status']
> = new Set(['cancelled', 'done', 'missed', 'moved', 'partial', 'skipped'])

interface TaskSectionOptions {
  defaultCollapsed?: boolean
  extraItemCount?: number
  extraItems?: ReactNode
  tone?: TaskSectionTone
}

function isRoutineTask(task: Task): boolean {
  return Boolean(task.routine)
}

function hasTaskSectionItems(
  sectionTasks: Task[],
  extraItemCount = 0,
): boolean {
  return sectionTasks.length + extraItemCount > 0
}

interface TaskSectionDefaultCollapseStateInput {
  activeHabitItemCount: number
  completedHabitItemCount: number
  doneTodayTasks: Task[]
  mainTodayTasks: Task[]
  otherTasks: Task[]
  overdueTasks: Task[]
  routineTasks: Task[]
  tomorrowTasks: Task[]
}

function getTaskSectionDefaultCollapseState({
  activeHabitItemCount,
  completedHabitItemCount,
  doneTodayTasks,
  mainTodayTasks,
  otherTasks,
  overdueTasks,
  routineTasks,
  tomorrowTasks,
}: TaskSectionDefaultCollapseStateInput) {
  const hasTodayTaskSection = hasTaskSectionItems(mainTodayTasks)
  const hasRoutineTaskSection = hasTaskSectionItems(
    routineTasks,
    activeHabitItemCount,
  )
  const hasOverdueTaskSection = hasTaskSectionItems(overdueTasks)
  const beforeTomorrow =
    hasTodayTaskSection || hasRoutineTaskSection || hasOverdueTaskSection
  const hasTomorrowTaskSection = hasTaskSectionItems(tomorrowTasks)
  const beforeOther = beforeTomorrow || hasTomorrowTaskSection
  const hasOtherTaskSection = hasTaskSectionItems(otherTasks)
  const beforeDoneToday = beforeOther || hasOtherTaskSection
  const hasDoneTodayTaskSection = hasTaskSectionItems(
    doneTodayTasks,
    completedHabitItemCount,
  )
  const beforeDoneHistory = beforeDoneToday || hasDoneTodayTaskSection

  return {
    doneHistory: beforeDoneHistory,
    doneToday: beforeDoneToday,
    other: beforeOther,
    tomorrow: beforeTomorrow,
  }
}

function renderTaskSectionGroup(
  sections: Array<ReactElement | null>,
  taskView: TodayTaskView,
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

  return (
    <div
      className={
        taskView === 'list' ? styles.taskSectionListGroup : pageStyles.gridTwo
      }
    >
      {visibleSections}
    </div>
  )
}

function getTodayTaskView(searchParams: URLSearchParams): TodayTaskView {
  return searchParams.get(TASK_VIEW_SEARCH_PARAM) === 'list' ? 'list' : 'cards'
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

function isVisibleSelfCareMainTask(entry: SelfCareTodayItem): boolean {
  if (entry.item.isArchived || !entry.item.isActive || entry.completion) {
    return false
  }

  if (
    entry.occurrence &&
    HIDDEN_SELF_CARE_OCCURRENCE_STATUSES.has(entry.occurrence.status)
  ) {
    return false
  }

  return true
}

function getSelfCareTaskKey(entry: SelfCareTodayItem): string {
  return `self-care-${entry.occurrence?.id ?? entry.item.id}`
}

function getMigratedSelfCareHabitIds(
  entries: readonly SelfCareTodayItem[],
): ReadonlySet<string> {
  const habitIds = entries
    .map((entry) => entry.item.migratedFromHabitId)
    .filter((habitId): habitId is string => Boolean(habitId))

  return new Set(habitIds)
}

function getSelfCareTaskTime(entry: SelfCareTodayItem): string | null {
  const sourceTime =
    entry.occurrence?.dueAt ??
    entry.appointment?.startsAt ??
    entry.scheduleRule?.preferredTime ??
    null

  if (!sourceTime) {
    return null
  }

  const isoTime = /T(\d{2}:\d{2})/.exec(sourceTime)?.[1]
  const plainTime = /^(\d{2}:\d{2})/.exec(sourceTime)?.[1]

  return isoTime ?? plainTime ?? null
}

function formatSelfCareTaskMeta(entry: SelfCareTodayItem): string {
  const time = getSelfCareTaskTime(entry)

  return time ? `Забота · ${time}` : 'Забота'
}

function SelfCareTodayTaskCard({
  entry,
  uploadedIcons,
  variant,
}: {
  entry: SelfCareTodayItem
  uploadedIcons: UploadedIconAsset[]
  variant: 'card' | 'compact'
}) {
  const icon = entry.item.icon?.trim()

  return (
    <Link
      className={`${styles.selfCareTaskCard} ${
        variant === 'compact' ? styles.selfCareTaskCardCompact : ''
      }`}
      to="/self-care"
      aria-label={`Открыть заботу: ${entry.item.title}`}
    >
      <span className={styles.selfCareTaskIcon} aria-hidden="true">
        {icon ? (
          <IconMark
            className={styles.selfCareTaskIconMark}
            value={icon}
            uploadedIcons={uploadedIcons}
          />
        ) : (
          '✓'
        )}
      </span>
      <span className={styles.selfCareTaskBody}>
        <span className={styles.selfCareTaskTitle}>{entry.item.title}</span>
        <span className={styles.selfCareTaskMeta}>
          {formatSelfCareTaskMeta(entry)}
        </span>
      </span>
    </Link>
  )
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
  const sessionQuery = usePlannerSession()
  const [searchParams] = useSearchParams()
  const updateUserPreferencesMutation = useUpdateUserPreferences()
  const {
    tasks,
    copyTaskToPersonal,
    spheres,
    isTaskPending,
    moveTaskToPersonal,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const persistedEnergyMode =
    sessionQuery.data?.userPreferences.energyMode ?? 'normal'
  const [energyMode, setEnergyMode] = useState<EnergyMode>(persistedEnergyMode)
  const todayKey = getDateKey(new Date())
  const widgetTaskComposerDraft = useWidgetTaskComposerDraft(todayKey)
  const todayHabitRoutine = useTodayHabitRoutine(todayKey)
  const selfCareDashboardQuery = useSelfCareDashboard(todayKey, {
    enabled: sessionQuery.data?.workspace.kind === 'personal',
  })
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const taskView = getTodayTaskView(searchParams)
  const taskCardVariant = taskView === 'list' ? 'compact' : 'card'

  useEffect(() => {
    setEnergyMode(persistedEnergyMode)
  }, [persistedEnergyMode])

  function selectEnergyMode(nextEnergyMode: EnergyMode) {
    setEnergyMode(nextEnergyMode)

    if (
      sessionQuery.data &&
      nextEnergyMode !== sessionQuery.data.userPreferences.energyMode
    ) {
      updateUserPreferencesMutation.mutate({
        energyMode: nextEnergyMode,
      })
    }
  }

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
  const archivedTasks = useMemo(() => selectArchivedTasks(tasks), [tasks])
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
  const showSelfCareMainTasks =
    selfCareDashboardQuery.data?.settings.showSelfCareInMainTasks === true
  const selfCareRoutineEntries =
    showSelfCareMainTasks && selfCareDashboardQuery.data
      ? selfCareDashboardQuery.data.todayItems.filter(isVisibleSelfCareMainTask)
      : []
  const selfCareOverdueEntries =
    showSelfCareMainTasks && selfCareDashboardQuery.data
      ? selfCareDashboardQuery.data.overdueItems.filter(
          isVisibleSelfCareMainTask,
        )
      : []
  const migratedSelfCareHabitIds = useMemo(
    () =>
      showSelfCareMainTasks && selfCareDashboardQuery.data
        ? getMigratedSelfCareHabitIds([
            ...selfCareDashboardQuery.data.todayItems,
            ...selfCareDashboardQuery.data.overdueItems,
            ...selfCareDashboardQuery.data.flexibleGoals,
          ])
        : new Set<string>(),
    [selfCareDashboardQuery.data, showSelfCareMainTasks],
  )
  const activeHabitItems = useMemo(
    () =>
      todayHabitRoutine.activeHabitItems.filter(
        (item) => !migratedSelfCareHabitIds.has(item.habit.id),
      ),
    [migratedSelfCareHabitIds, todayHabitRoutine.activeHabitItems],
  )
  const completedHabitItems = useMemo(
    () =>
      todayHabitRoutine.completedHabitItems.filter(
        (item) => !migratedSelfCareHabitIds.has(item.habit.id),
      ),
    [migratedSelfCareHabitIds, todayHabitRoutine.completedHabitItems],
  )
  const defaultCollapsedSections = getTaskSectionDefaultCollapseState({
    activeHabitItemCount:
      activeHabitItems.length + selfCareRoutineEntries.length,
    completedHabitItemCount: completedHabitItems.length,
    doneTodayTasks,
    mainTodayTasks,
    otherTasks,
    overdueTasks,
    routineTasks,
    tomorrowTasks,
  })
  const routineHabitCards = activeHabitItems.map((item) => (
    <HabitRoutineTaskCard
      key={item.habit.id}
      item={item}
      isPending={todayHabitRoutine.isHabitPending}
      uploadedIcons={uploadedIcons}
      variant={taskCardVariant}
      onComplete={todayHabitRoutine.completeHabit}
      onUndo={todayHabitRoutine.undoHabit}
    />
  ))
  const completedHabitCards = completedHabitItems.map((item) => (
    <HabitRoutineTaskCard
      key={item.habit.id}
      item={item}
      isPending={todayHabitRoutine.isHabitPending}
      tone="success"
      uploadedIcons={uploadedIcons}
      variant={taskCardVariant}
      onComplete={todayHabitRoutine.completeHabit}
      onUndo={todayHabitRoutine.undoHabit}
    />
  ))
  const selfCareRoutineTaskCards = selfCareRoutineEntries.map((entry) => (
    <SelfCareTodayTaskCard
      key={getSelfCareTaskKey(entry)}
      entry={entry}
      uploadedIcons={uploadedIcons}
      variant={taskCardVariant}
    />
  ))
  const selfCareOverdueTaskCards = selfCareOverdueEntries.map((entry) => (
    <SelfCareTodayTaskCard
      key={`overdue-${getSelfCareTaskKey(entry)}`}
      entry={entry}
      uploadedIcons={uploadedIcons}
      variant={taskCardVariant}
    />
  ))

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
        spheres={spheres}
        uploadedIcons={uploadedIcons}
        emptyMessage={emptyMessage}
        isTaskPending={isTaskPending}
        defaultCollapsed={options.defaultCollapsed}
        extraItemCount={options.extraItemCount}
        extraItems={options.extraItems}
        taskCardVariant={taskCardVariant}
        tone={options.tone ?? 'default'}
        onRemove={(taskId) => {
          void removeTask(taskId)
        }}
        onCopyToPersonal={(taskId) => {
          void copyTaskToPersonal(taskId)
        }}
        onMoveToPersonal={(taskId) => {
          void moveTaskToPersonal(taskId)
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
      <TaskComposer
        desktopOpenButtonHidden
        initialPlannedDate={todayKey}
        openDraft={widgetTaskComposerDraft}
      />

      <div className={styles.taskScroll}>
        <div className={styles.taskScrollInner}>
          <ResourcePlanPanel
            energyMode={energyMode}
            isTaskPending={isTaskPending}
            tasks={resourceTasks}
            onEnergyModeChange={selectEnergyMode}
            onMoveTaskTomorrow={(taskId) => {
              void setTaskPlannedDate(taskId, tomorrowKey)
            }}
          />

          {renderTaskSectionGroup(
            [
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
                  extraItemCount:
                    activeHabitItems.length + selfCareRoutineTaskCards.length,
                  extraItems: [
                    ...routineHabitCards,
                    ...selfCareRoutineTaskCards,
                  ],
                },
              ),
            ],
            taskView,
          )}

          {buildTaskSection(
            'overdue',
            'Требуют внимания',
            overdueTasks,
            'Просроченных задач сейчас нет.',
            {
              extraItemCount: selfCareOverdueTaskCards.length,
              extraItems: selfCareOverdueTaskCards,
              tone: 'warning',
            },
          )}

          {renderTaskSectionGroup(
            [
              buildTaskSection(
                'tomorrow',
                'Завтра',
                tomorrowTasks,
                'На завтра пока ничего нет.',
                { defaultCollapsed: defaultCollapsedSections.tomorrow },
              ),
              buildTaskSection(
                'other',
                'Остальные задачи',
                otherTasks,
                'Все активные задачи уже разложены на сегодня, просрочку или завтра.',
                { defaultCollapsed: defaultCollapsedSections.other },
              ),
            ],
            taskView,
          )}

          {buildTaskSection(
            'done-today',
            'Выполнено сегодня',
            doneTodayTasks,
            'Когда начнёшь закрывать задачи, последние завершённые появятся здесь.',
            {
              defaultCollapsed: defaultCollapsedSections.doneToday,
              extraItemCount: completedHabitItems.length,
              extraItems: completedHabitCards,
              tone: 'success',
            },
          )}

          {buildTaskSection(
            'done-history',
            'История задач',
            doneHistoryTasks,
            'Выполненные раньше задачи появятся здесь.',
            {
              defaultCollapsed: defaultCollapsedSections.doneHistory,
              tone: 'success',
            },
          )}

          {buildTaskSection(
            'archive',
            'Архив',
            archivedTasks,
            'Задачи, отложенные без планирования, появятся здесь.',
            { defaultCollapsed: true },
          )}
        </div>
      </div>
    </section>
  )
}

function SharedTodayPage() {
  const { data: session } = usePlannerSession()
  const [searchParams] = useSearchParams()
  const {
    tasks,
    copyTaskToPersonal,
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
  const todayKey = getDateKey(new Date())
  const widgetTaskComposerDraft = useWidgetTaskComposerDraft(todayKey)
  const todayHabitRoutine = useTodayHabitRoutine(todayKey)
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const taskView = getTodayTaskView(searchParams)
  const taskCardVariant = taskView === 'list' ? 'compact' : 'card'
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
  const archivedTasks = useMemo(() => selectArchivedTasks(tasks), [tasks])
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
  const defaultCollapsedSections = getTaskSectionDefaultCollapseState({
    activeHabitItemCount: todayHabitRoutine.activeHabitItems.length,
    completedHabitItemCount: todayHabitRoutine.completedHabitItems.length,
    doneTodayTasks,
    mainTodayTasks,
    otherTasks,
    overdueTasks,
    routineTasks,
    tomorrowTasks,
  })
  const routineHabitCards = todayHabitRoutine.activeHabitItems.map((item) => (
    <HabitRoutineTaskCard
      key={item.habit.id}
      item={item}
      isPending={todayHabitRoutine.isHabitPending}
      uploadedIcons={uploadedIcons}
      variant={taskCardVariant}
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
        variant={taskCardVariant}
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
        spheres={spheres}
        uploadedIcons={uploadedIcons}
        workspaceUsers={workspaceUsers}
        emptyMessage={emptyMessage}
        isTaskPending={isTaskPending}
        defaultCollapsed={options.defaultCollapsed}
        extraItemCount={options.extraItemCount}
        extraItems={options.extraItems}
        taskCardVariant={taskCardVariant}
        tone={options.tone ?? 'default'}
        onRemove={(taskId) => {
          void removeTask(taskId)
        }}
        onCopyToPersonal={(taskId) => {
          void copyTaskToPersonal(taskId)
        }}
        onMoveToPersonal={(taskId) => {
          void moveTaskToPersonal(taskId)
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
      <TaskComposer
        desktopOpenButtonHidden
        initialPlannedDate={todayKey}
        openDraft={widgetTaskComposerDraft}
      />

      <div className={styles.taskScroll}>
        <div className={styles.taskScrollInner}>
          {renderTaskSectionGroup(
            [
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
            ],
            taskView,
          )}

          {buildTaskSection(
            'overdue',
            'Требуют внимания',
            overdueTasks,
            'Просроченных задач сейчас нет.',
            { tone: 'warning' },
          )}

          {renderTaskSectionGroup(
            [
              buildTaskSection(
                'tomorrow',
                'Завтра',
                tomorrowTasks,
                'На завтра в общем workspace пока ничего нет.',
                { defaultCollapsed: defaultCollapsedSections.tomorrow },
              ),
              buildTaskSection(
                'other',
                'Остальные задачи',
                otherTasks,
                'Все активные задачи уже разложены на сегодня, просрочку или завтра.',
                { defaultCollapsed: defaultCollapsedSections.other },
              ),
            ],
            taskView,
          )}

          {buildTaskSection(
            'done-today',
            'Выполнено сегодня',
            doneTodayTasks,
            'Закрытые сегодня задачи общего workspace появятся здесь.',
            {
              defaultCollapsed: defaultCollapsedSections.doneToday,
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
            {
              defaultCollapsed: defaultCollapsedSections.doneHistory,
              tone: 'success',
            },
          )}

          {buildTaskSection(
            'archive',
            'Архив',
            archivedTasks,
            'Архивированные задачи общего workspace появятся здесь.',
            { defaultCollapsed: true },
          )}
        </div>
      </div>
    </section>
  )
}
