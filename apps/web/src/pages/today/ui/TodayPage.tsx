import {
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
  TaskSection,
} from '@/entities/task'
import { usePlanner } from '@/features/planner'
import { TaskComposer } from '@/features/task-create'
import { getDateKey } from '@/shared/lib/date'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

export function TodayPage() {
  const {
    tasks,
    projects,
    isTaskPending,
    removeTask,
    setTaskPlannedDate,
    setTaskStatus,
  } = usePlanner()
  const todayKey = getDateKey(new Date())
  const todayTasks = selectTodayTasks(tasks, todayKey)
  const overdueTasks = selectOverdueTasks(tasks, todayKey)
  const doneTodayTasks = selectDoneTodayTasks(tasks, todayKey)

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Focus"
        title="Today"
        description="Экран для задач, которые действительно должны случиться сегодня. Просрочку держим рядом, чтобы она не растворялась."
      />

      <TaskComposer initialPlannedDate={todayKey} />

      <div className={pageStyles.gridTwo}>
        <TaskSection
          title="Фокус дня"
          tasks={todayTasks}
          projects={projects}
          emptyMessage="Пока нет задач на сегодня. Добавь 1-3 конкретных шага и не перегружай день."
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
        />
        <TaskSection
          title="Требует решения"
          tasks={overdueTasks}
          projects={projects}
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
          tone="warning"
        />
      </div>

      <TaskSection
        title="Сделано сегодня"
        tasks={doneTodayTasks}
        projects={projects}
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
        tone="success"
      />
    </section>
  )
}
