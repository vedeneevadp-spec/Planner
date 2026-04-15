import { selectInboxTasks, TaskSection } from '@/entities/task'
import { usePlanner } from '@/features/planner'
import { TaskComposer } from '@/features/task-create'
import pageStyles from '@/shared/ui/Page'
import { PageHeader } from '@/shared/ui/PageHeader'

export function InboxPage() {
  const { tasks, removeTask, setTaskPlannedDate, setTaskStatus } = usePlanner()
  const inboxTasks = selectInboxTasks(tasks)

  return (
    <section className={pageStyles.page}>
      <PageHeader
        kicker="Capture"
        title="Inbox"
        description="Сюда складывается всё сырое и несформированное. Разбирай inbox, когда планируешь день или неделю."
      />

      <TaskComposer initialPlannedDate={null} />

      <TaskSection
        title="Без даты"
        tasks={inboxTasks}
        emptyMessage="Inbox пуст. Это нормально: значит, ты либо всё распланировал, либо пока ничего не захватывал."
        onRemove={removeTask}
        onSetPlannedDate={setTaskPlannedDate}
        onSetStatus={setTaskStatus}
      />
    </section>
  )
}
