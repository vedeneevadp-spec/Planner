import type { ReactElement, ReactNode } from 'react'

import type { Task } from '@/entities/task'
import { TaskSection, type TaskSectionProps } from '@/entities/task/ui'
import type { TodayTaskView } from '@/shared/lib/today-task-view'
import pageStyles from '@/shared/ui/Page'

import {
  getTodaySectionDefaultCollapseState,
  type TodayTaskModel,
} from '../lib/today-task-model'
import styles from './TodayPage.module.css'

type TaskSectionTone = NonNullable<TaskSectionProps['tone']>

interface TodayTaskSectionOptions {
  defaultCollapsed?: boolean
  extraItemCount?: number
  extraItems?: ReactNode
  tone?: TaskSectionTone
}

interface TodayTaskSectionExtra {
  itemCount: number
  items: ReactNode
}

export interface TodayTaskSectionExtras {
  overdue?: TodayTaskSectionExtra
  routine?: TodayTaskSectionExtra
  tomorrow?: TodayTaskSectionExtra
}

interface TodayPersonalWorkspaceContext {
  kind: 'personal'
}

interface TodaySharedWorkspaceContext {
  currentActorUserId: TaskSectionProps['currentActorUserId']
  kind: 'shared'
  sharedWorkspaceGroupRole: TaskSectionProps['sharedWorkspaceGroupRole']
  sharedWorkspaceRole: TaskSectionProps['sharedWorkspaceRole']
  workspaceUsers: NonNullable<TaskSectionProps['workspaceUsers']>
}

export type TodayWorkspaceContext =
  TodayPersonalWorkspaceContext | TodaySharedWorkspaceContext

type AsyncTaskIdHandler = (taskId: string) => Promise<unknown>

export interface TodayTaskActions {
  copyTaskToPersonal: AsyncTaskIdHandler
  createNextTaskStage: NonNullable<TaskSectionProps['onCreateNextStage']>
  detachTaskFromChain: AsyncTaskIdHandler
  isTaskPending: TaskSectionProps['isTaskPending']
  moveTaskToPersonal: AsyncTaskIdHandler
  removeTask: AsyncTaskIdHandler
  setTaskPlannedDate: (
    taskId: string,
    plannedDate: string | null,
  ) => Promise<unknown>
  setTaskStatus: (
    taskId: string,
    status: Parameters<TaskSectionProps['onSetStatus']>[1],
  ) => Promise<unknown>
  updateTask: TaskSectionProps['onUpdate']
}

interface TodayTaskSectionsProps {
  actions: TodayTaskActions
  closedTaskPagination?: ReactNode
  extras?: TodayTaskSectionExtras
  model: TodayTaskModel
  spheres: NonNullable<TaskSectionProps['spheres']>
  taskView: TodayTaskView
  tasks: Task[]
  todayKey: string
  tomorrowKey: string
  uploadedIcons: NonNullable<TaskSectionProps['uploadedIcons']>
  workspace: TodayWorkspaceContext
}

const EMPTY_COPY = {
  personal: {
    archive: 'Задачи, отложенные без планирования, появятся здесь.',
    doneHistory: 'Выполненные раньше задачи появятся здесь.',
    doneToday:
      'Когда начнёшь закрывать задачи, последние завершённые появятся здесь.',
    other:
      'Все активные задачи уже разложены на сегодня, просрочку или завтра.',
    overdue: 'Просроченных задач сейчас нет.',
    routine: 'Рутинных задач на сегодня пока нет.',
    today: 'На сегодня пока нет задач.',
    tomorrow: 'На завтра пока ничего нет.',
  },
  shared: {
    archive: 'Архивированные задачи общего workspace появятся здесь.',
    doneHistory: 'Закрытые раньше задачи общего workspace появятся здесь.',
    doneToday: 'Закрытые сегодня задачи общего workspace появятся здесь.',
    other:
      'Все активные задачи уже разложены на сегодня, просрочку или завтра.',
    overdue: 'Просроченных задач сейчас нет.',
    routine: 'Рутинных задач на сегодня пока нет.',
    today: 'В общем workspace на сегодня пока нет задач.',
    tomorrow: 'На завтра в общем workspace пока ничего нет.',
  },
} as const

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

interface RenderTaskSectionInput {
  actions: TodayTaskActions
  emptyMessage: string
  key: string
  options?: TodayTaskSectionOptions
  sectionTasks: Task[]
  spheres: NonNullable<TaskSectionProps['spheres']>
  taskView: TodayTaskView
  tasks: Task[]
  title: string
  todayKey: string
  tomorrowKey: string
  uploadedIcons: NonNullable<TaskSectionProps['uploadedIcons']>
  workspace: TodayWorkspaceContext
}

function renderTaskSection({
  actions,
  emptyMessage,
  key,
  options = {},
  sectionTasks,
  spheres,
  taskView,
  tasks,
  title,
  todayKey,
  tomorrowKey,
  uploadedIcons,
  workspace,
}: RenderTaskSectionInput): ReactElement | null {
  if (sectionTasks.length === 0 && (options.extraItemCount ?? 0) === 0) {
    return null
  }

  if (sectionTasks.length === 0 && !options.extraItems) {
    return null
  }

  const sharedProps =
    workspace.kind === 'shared'
      ? {
          currentActorUserId: workspace.currentActorUserId,
          isSharedWorkspace: true,
          sharedWorkspaceGroupRole: workspace.sharedWorkspaceGroupRole,
          sharedWorkspaceRole: workspace.sharedWorkspaceRole,
          workspaceUsers: workspace.workspaceUsers,
        }
      : {}

  return (
    <TaskSection
      key={key}
      title={title}
      tasks={sectionTasks}
      allTasks={tasks}
      {...sharedProps}
      spheres={spheres}
      uploadedIcons={uploadedIcons}
      emptyMessage={emptyMessage}
      isTaskPending={actions.isTaskPending}
      defaultCollapsed={options.defaultCollapsed}
      extraItemCount={options.extraItemCount}
      extraItems={options.extraItems}
      taskCardVariant={taskView === 'list' ? 'compact' : 'card'}
      todayKey={todayKey}
      tomorrowKey={tomorrowKey}
      tone={options.tone ?? 'default'}
      onRemove={(taskId) => {
        void actions.removeTask(taskId)
      }}
      onCreateNextStage={actions.createNextTaskStage}
      onCopyToPersonal={(taskId) => {
        void actions.copyTaskToPersonal(taskId)
      }}
      onDetachFromChain={(taskId) => {
        void actions.detachTaskFromChain(taskId)
      }}
      onMoveToPersonal={(taskId) => {
        void actions.moveTaskToPersonal(taskId)
      }}
      onSetPlannedDate={(taskId, plannedDate) => {
        void actions.setTaskPlannedDate(taskId, plannedDate)
      }}
      onSetStatus={(taskId, status) => {
        void actions.setTaskStatus(taskId, status)
      }}
      onUpdate={actions.updateTask}
    />
  )
}

export function TodayTaskSections({
  actions,
  closedTaskPagination,
  extras = {},
  model,
  spheres,
  taskView,
  tasks,
  todayKey,
  tomorrowKey,
  uploadedIcons,
  workspace,
}: TodayTaskSectionsProps) {
  const copy = EMPTY_COPY[workspace.kind]
  const defaultCollapsedSections = getTodaySectionDefaultCollapseState({
    doneTodayTasks: model.doneTodayTasks,
    mainTodayTasks: model.mainTodayTasks,
    otherTasks: model.otherTasks,
    overdueTasks: model.overdueTasks,
    routineExtraItemCount: extras.routine?.itemCount ?? 0,
    routineTasks: model.routineTasks,
    tomorrowExtraItemCount: extras.tomorrow?.itemCount ?? 0,
    tomorrowTasks: model.tomorrowTasks,
  })
  const common = {
    actions,
    spheres,
    taskView,
    tasks,
    todayKey,
    tomorrowKey,
    uploadedIcons,
    workspace,
  }

  return (
    <>
      {renderTaskSectionGroup(
        [
          renderTaskSection({
            ...common,
            emptyMessage: copy.today,
            key: 'today',
            sectionTasks: model.mainTodayTasks,
            title: 'Сегодня',
          }),
          renderTaskSection({
            ...common,
            emptyMessage: copy.routine,
            key: 'routine',
            options: {
              extraItemCount: extras.routine?.itemCount ?? 0,
              extraItems: extras.routine?.items,
            },
            sectionTasks: model.routineTasks,
            title: 'Рутина',
          }),
        ],
        taskView,
      )}

      {renderTaskSection({
        ...common,
        emptyMessage: copy.overdue,
        key: 'overdue',
        options: {
          extraItemCount: extras.overdue?.itemCount ?? 0,
          extraItems: extras.overdue?.items,
          tone: 'warning',
        },
        sectionTasks: model.overdueTasks,
        title: 'Требуют внимания',
      })}

      {renderTaskSectionGroup(
        [
          renderTaskSection({
            ...common,
            emptyMessage: copy.tomorrow,
            key: 'tomorrow',
            options: {
              defaultCollapsed: defaultCollapsedSections.tomorrow,
              extraItemCount: extras.tomorrow?.itemCount ?? 0,
              extraItems: extras.tomorrow?.items,
            },
            sectionTasks: model.tomorrowTasks,
            title: 'Завтра',
          }),
          renderTaskSection({
            ...common,
            emptyMessage: copy.other,
            key: 'other',
            options: {
              defaultCollapsed: defaultCollapsedSections.other,
            },
            sectionTasks: model.otherTasks,
            title: 'Остальные задачи',
          }),
        ],
        taskView,
      )}

      {renderTaskSection({
        ...common,
        emptyMessage: copy.doneToday,
        key: 'done-today',
        options: {
          defaultCollapsed: defaultCollapsedSections.doneToday,
          tone: 'success',
        },
        sectionTasks: model.doneTodayTasks,
        title: 'Выполнено сегодня',
      })}

      {renderTaskSection({
        ...common,
        emptyMessage: copy.doneHistory,
        key: 'done-history',
        options: {
          defaultCollapsed: defaultCollapsedSections.doneHistory,
          tone: 'success',
        },
        sectionTasks: model.doneHistoryTasks,
        title: 'История задач',
      })}

      {renderTaskSection({
        ...common,
        emptyMessage: copy.archive,
        key: 'archive',
        options: { defaultCollapsed: true },
        sectionTasks: model.archivedTasks,
        title: 'Архив',
      })}

      {closedTaskPagination}
    </>
  )
}
