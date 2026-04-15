import { usePlanner } from '@/app/providers/usePlanner'
import {
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
} from '@/entities/task/model/planner'
import { TaskSection } from '@/entities/task/ui/TaskSection'
import { TaskComposer } from '@/features/task-create/ui/TaskComposer'
import { getDateKey } from '@/shared/lib/date/date'
import pageStyles from '@/shared/ui/Page/Page.module.css'
import { PageHeader } from '@/shared/ui/PageHeader/PageHeader'

export function TodayPage() {
  const { tasks } = usePlanner()
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
          emptyMessage="Пока нет задач на сегодня. Добавь 1-3 конкретных шага и не перегружай день."
        />
        <TaskSection
          title="Требует решения"
          tasks={overdueTasks}
          emptyMessage="Просроченных задач нет."
          tone="warning"
        />
      </div>

      <TaskSection
        title="Сделано сегодня"
        tasks={doneTodayTasks}
        emptyMessage="Когда начнёшь закрывать задачи, последние завершённые появятся здесь."
        tone="success"
      />
    </section>
  )
}
