import { isActiveTaskStatus, type Task } from '@/entities/task'
import { buildRecurringGhostTasks } from '@/entities/task'
import { addDateDays } from '@/shared/time/time.service'

import { analyzeDailyLoad, type EnergyMode } from './resource-plan'

export function buildRescheduleOptions(
  tasks: Task[],
  task: Task,
  mode: EnergyMode,
  today: string,
  complete: boolean,
) {
  const start = addDateDays(today, 1)
  const end = addDateDays(today, 7)
  const withRepeats = (items: Task[]) => [
    ...items,
    ...buildRecurringGhostTasks(items, start, end, today),
  ]
  const beforeTasks = withRepeats(tasks)
  const options = Array.from({ length: 7 }, (_, index) => {
    const date = addDateDays(start, index)
    const movedTasks = tasks
      .filter((item) => item.id !== task.id)
      .concat({ ...task, plannedDate: date })
    const before = analyzeDailyLoad(
      beforeTasks.filter(
        (item) => item.plannedDate === date && isActiveTaskStatus(item.status),
      ),
      mode,
      complete,
    )
    const after = analyzeDailyLoad(
      withRepeats(movedTasks).filter(
        (item) => item.plannedDate === date && isActiveTaskStatus(item.status),
      ),
      mode,
      complete,
    )
    const allowed = !task.dueDate || date <= task.dueDate
    return { date, before, after, allowed }
  })
  const recommended =
    options.find(
      (option) =>
        option.allowed &&
        option.after.isComplete &&
        option.after.assessedState === 'calm',
    ) ??
    options.find(
      (option) =>
        option.allowed &&
        option.after.isComplete &&
        option.after.assessedState !== 'overload',
    )
  return { options, recommendedDate: recommended?.date ?? null }
}
