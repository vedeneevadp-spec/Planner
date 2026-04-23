import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

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
import { usePlanner, usePlannerApiClient } from '@/features/planner'
import { TaskComposer } from '@/features/task-create'
import { addDays, getDateKey } from '@/shared/lib/date'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

import {
  type EnergyMode,
  groupDailyTasks,
} from '../lib/resource-plan'
import { ResourcePlanPanel } from './ResourcePlanPanel'
import styles from './ResourcePlanPanel.module.css'

interface PlanDraft {
  energyMode: EnergyMode
  focusTaskIds: string[]
  supportTaskIds: string[]
  routineTaskIds: string[]
}

type PlanSection = 'focusTaskIds' | 'routineTaskIds' | 'supportTaskIds'

export function TodayPage() {
  const api = usePlannerApiClient()
  const queryClient = useQueryClient()
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
  const dailyPlanQuery = useQuery({
    enabled: api !== null,
    queryFn: ({ signal }) => api!.getDailyPlan(todayKey, signal),
    queryKey: ['daily-plan', todayKey],
  })
  const taskById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task])),
    [tasks],
  )
  const todayTasks = useMemo(
    () => selectTodayTasks(tasks, todayKey),
    [tasks, todayKey],
  )
  const fallbackGroups = useMemo(
    () => groupDailyTasks(todayTasks),
    [todayTasks],
  )
  const planDraft = useMemo<PlanDraft>(() => {
    const plan = dailyPlanQuery.data

    if (!plan) {
      return {
        energyMode: 'normal',
        focusTaskIds: fallbackGroups.focusTasks.map((task) => task.id),
        routineTaskIds: fallbackGroups.routineTasks.map((task) => task.id),
        supportTaskIds: fallbackGroups.supportTasks.map((task) => task.id),
      }
    }

    const hasSavedTasks =
      plan.focusTaskIds.length > 0 ||
      plan.supportTaskIds.length > 0 ||
      plan.routineTaskIds.length > 0

    return {
      energyMode: plan.energyMode,
      focusTaskIds: hasSavedTasks
        ? plan.focusTaskIds
        : fallbackGroups.focusTasks.map((task) => task.id),
      routineTaskIds: hasSavedTasks
        ? plan.routineTaskIds
        : fallbackGroups.routineTasks.map((task) => task.id),
      supportTaskIds: hasSavedTasks
        ? plan.supportTaskIds
        : fallbackGroups.supportTasks.map((task) => task.id),
    }
  }, [dailyPlanQuery.data, fallbackGroups])
  const focusTasks = resolvePlanTasks(planDraft.focusTaskIds, taskById)
  const supportTasks = resolvePlanTasks(planDraft.supportTaskIds, taskById)
  const routineTasks = resolvePlanTasks(planDraft.routineTaskIds, taskById)
  const plannedIds = new Set([
    ...planDraft.focusTaskIds,
    ...planDraft.supportTaskIds,
    ...planDraft.routineTaskIds,
  ])
  const backlogTasks = selectTodoTasks(tasks).filter(
    (task) => !plannedIds.has(task.id),
  )
  const [taskToAdd, setTaskToAdd] = useState('')
  const [targetSection, setTargetSection] = useState<PlanSection>('focusTaskIds')
  const tomorrowTasks = selectTomorrowTasks(tasks, tomorrowKey)
  const overdueTasks = selectOverdueTasks(tasks, todayKey)
  const doneTodayTasks = selectDoneTodayTasks(tasks, todayKey)
  const savePlanMutation = useMutation({
    mutationFn: (draft: PlanDraft) => api!.saveDailyPlan(todayKey, draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-plan', todayKey] })
    },
  })
  const autoBuildMutation = useMutation({
    mutationFn: () =>
      api!.autoBuildDailyPlan({
        date: todayKey,
        energyMode: planDraft.energyMode,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['daily-plan', todayKey] })
    },
  })

  function savePlan(nextDraft: PlanDraft) {
    if (!api) {
      return
    }

    savePlanMutation.mutate(nextDraft)
  }

  function updateEnergyMode(energyMode: EnergyMode) {
    savePlan({ ...planDraft, energyMode })
  }

  function removeFromPlan(taskId: string) {
    savePlan({
      ...planDraft,
      focusTaskIds: planDraft.focusTaskIds.filter((id) => id !== taskId),
      routineTaskIds: planDraft.routineTaskIds.filter((id) => id !== taskId),
      supportTaskIds: planDraft.supportTaskIds.filter((id) => id !== taskId),
    })
  }

  function addTaskToPlan() {
    if (!taskToAdd) {
      return
    }

    const cleanedDraft: PlanDraft = {
      ...planDraft,
      focusTaskIds: planDraft.focusTaskIds.filter((id) => id !== taskToAdd),
      routineTaskIds: planDraft.routineTaskIds.filter((id) => id !== taskToAdd),
      supportTaskIds: planDraft.supportTaskIds.filter((id) => id !== taskToAdd),
    }
    const nextDraft: PlanDraft = {
      ...cleanedDraft,
      [targetSection]: [...cleanedDraft[targetSection], taskToAdd],
    }

    void setTaskPlannedDate(taskToAdd, todayKey)
    savePlan(nextDraft)
    setTaskToAdd('')
  }

  function renderTaskSection(title: string, sectionTasks: Task[]) {
    return (
      <TaskSection
        title={title}
        tasks={sectionTasks}
        projects={projects}
        uploadedIcons={uploadedIcons}
        emptyMessage="Здесь пока пусто. Добавь задачу вручную или собери день автоматически."
        isTaskPending={isTaskPending}
        onRemove={(taskId) => {
          removeFromPlan(taskId)
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
        title="План дня по ресурсу"
        description="Выбери реальный режим дня, собери фокус и увидь перегруз до того, как он сорвет план."
      />

      <ResourcePlanPanel
        energyMode={planDraft.energyMode}
        tasks={[...focusTasks, ...supportTasks, ...routineTasks]}
        isTaskPending={isTaskPending}
        onAutoBuild={() => autoBuildMutation.mutate()}
        onEnergyModeChange={updateEnergyMode}
        onMoveTaskTomorrow={(taskId) => {
          removeFromPlan(taskId)
          void setTaskPlannedDate(taskId, tomorrowKey)
        }}
      />

      <div className={styles.loadCard}>
        <div className={styles.loadHeader}>
          <div>
            <span>Ручное добавление в план</span>
            <strong>focus / support / routine</strong>
          </div>
          <div className={styles.planAddControls}>
            <select value={taskToAdd} onChange={(event) => setTaskToAdd(event.target.value)}>
              <option value="">Выбери задачу</option>
              {backlogTasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.title}
                </option>
              ))}
            </select>
            <select
              value={targetSection}
              onChange={(event) => setTargetSection(event.target.value as PlanSection)}
            >
              <option value="focusTaskIds">Главное</option>
              <option value="supportTaskIds">Поддерживающее</option>
              <option value="routineTaskIds">Рутина</option>
            </select>
            <button type="button" disabled={!taskToAdd} onClick={addTaskToPlan}>
              Добавить
            </button>
          </div>
        </div>
      </div>

      <TaskComposer initialPlannedDate={todayKey} />

      <div className={pageStyles.gridTwo}>
        {renderTaskSection('Главное сегодня', focusTasks)}
        {renderTaskSection('Поддерживающее', supportTasks)}
      </div>

      <div className={pageStyles.gridTwo}>
        {renderTaskSection('Рутина', routineTasks)}
        <TaskSection
          title="Завтра"
          tasks={tomorrowTasks}
          projects={projects}
          uploadedIcons={uploadedIcons}
          emptyMessage="На завтра пока ничего нет. Удобно переносить лишнее без переписывания плана."
          isTaskPending={isTaskPending}
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
      </div>

      <TaskSection
        title="Требует решения"
        tasks={overdueTasks}
        projects={projects}
        uploadedIcons={uploadedIcons}
        emptyMessage="Просроченных задач нет."
        isTaskPending={isTaskPending}
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
        tone="warning"
      />

      <TaskSection
        title="Сделано сегодня"
        tasks={doneTodayTasks}
        projects={projects}
        uploadedIcons={uploadedIcons}
        emptyMessage="Когда начнёшь закрывать задачи, последние завершённые появятся здесь."
        isTaskPending={isTaskPending}
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
        tone="success"
      />
    </section>
  )
}

function resolvePlanTasks(taskIds: string[], taskById: Map<string, Task>): Task[] {
  return taskIds
    .map((taskId) => taskById.get(taskId))
    .filter((task): task is Task => task !== undefined)
}
