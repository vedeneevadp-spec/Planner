import {
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
  selectTomorrowTasks,
  TaskSection,
} from '@/entities/task'
import { useUploadedIconAssets } from '@/features/emoji-library'
import { usePlanner } from '@/features/planner'
import { TaskComposer } from '@/features/task-create'
import { addDays, getDateKey } from '@/shared/lib/date'
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
    updateTask,
  } = usePlanner()
  const { uploadedIcons } = useUploadedIconAssets()
  const todayKey = getDateKey(new Date())
  const tomorrowKey = getDateKey(addDays(new Date(), 1))
  const todayTasks = selectTodayTasks(tasks, todayKey)
  const tomorrowTasks = selectTomorrowTasks(tasks, tomorrowKey)
  const overdueTasks = selectOverdueTasks(tasks, todayKey)
  const doneTodayTasks = selectDoneTodayTasks(tasks, todayKey)

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Focus"
        title="Today"
        description="Экран для задач на сегодня и завтра. Вечером можно сразу собрать следующий день, не уходя в таймлайн."
      />

      <TaskComposer initialPlannedDate={todayKey} />

      <div className={pageStyles.gridTwo}>
        <TaskSection
          title="Фокус дня"
          tasks={todayTasks}
          projects={projects}
          uploadedIcons={uploadedIcons}
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
          onUpdate={updateTask}
        />
        <TaskSection
          title="Завтра"
          tasks={tomorrowTasks}
          projects={projects}
          uploadedIcons={uploadedIcons}
          emptyMessage="На завтра пока ничего нет. Удобно набросать задачи вечером и утром только уточнить время."
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
