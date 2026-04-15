import { usePlanner } from '@/app/providers/usePlanner'
import { selectInboxTasks } from '@/entities/task/model/planner'
import { TaskSection } from '@/entities/task/ui/TaskSection'
import { TaskComposer } from '@/features/task-create/ui/TaskComposer'
import pageStyles from '@/shared/ui/Page/Page.module.css'
import { PageHeader } from '@/shared/ui/PageHeader/PageHeader'

export function InboxPage() {
  const { tasks } = usePlanner()
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
      />
    </section>
  )
}
