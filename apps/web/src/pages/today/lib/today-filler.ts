import type { Sphere } from '@/entities/sphere'
import type { Task } from '@/entities/task'
import { formatTime } from '@/shared/lib/date'

import type { TodayTaskModel } from './today-task-model'

/**
 * Short phrases for the card that fills the empty space under the shorter
 * column. Written for the app's tone rather than quoted, so they need no
 * attribution and stay gentle about unfinished work.
 */
export const TODAY_FILLER_PHRASES = [
  'Одно дело за раз — тоже план.',
  'Перерыв — тоже пункт в списке.',
  'Не успеть всё — нормально. Успеть важное — достаточно.',
  'Хаос не враг, если у него есть список.',
  'Маленький шаг сегодня лучше идеального завтра.',
  'Начни с того, что займёт пять минут.',
  'Сделанное наполовину — уже не ноль.',
  'Список — подсказка, а не приговор.',
  'Отдых тоже двигает дела вперёд.',
  'Сегодня можно и не героически.',
  'Вычеркнуть одно — уже хороший день.',
  'Дела подождут, пока ты пьёшь чай.',
] as const

export type TodayFillerSummaryItem =
  | { kind: 'done'; count: number }
  | { kind: 'next'; time: string; title: string }
  | { kind: 'sphere'; count: number; name: string }

/**
 * Picks a phrase for the day so it stays put across reloads and changes at
 * midnight. `slot` lets two cards on the page show different phrases.
 */
export function getTodayFillerPhrase(todayKey: string, slot = 0): string {
  let hash = 0

  for (const char of todayKey) {
    hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003
  }

  const index = (hash + slot) % TODAY_FILLER_PHRASES.length

  return TODAY_FILLER_PHRASES[index] ?? TODAY_FILLER_PHRASES[0]
}

export function buildTodayFillerSummary({
  model,
  nowTime,
  spheres,
}: {
  model: Pick<
    TodayTaskModel,
    'doneTodayTasks' | 'mainTodayTasks' | 'routineTasks'
  >
  /** Current wall-clock time in the planner time zone, `HH:MM`. */
  nowTime: string
  spheres: Pick<Sphere, 'id' | 'name'>[]
}): TodayFillerSummaryItem[] {
  const items: TodayFillerSummaryItem[] = []
  const plannedTasks = [...model.mainTodayTasks, ...model.routineTasks]

  if (model.doneTodayTasks.length > 0) {
    items.push({ count: model.doneTodayTasks.length, kind: 'done' })
  }

  const nextTask = getNextTimedTask(plannedTasks, nowTime)

  if (nextTask?.plannedStartTime) {
    items.push({
      kind: 'next',
      time: formatTime(nextTask.plannedStartTime),
      title: nextTask.title,
    })
  }

  const topSphere = getTopSphere(model.mainTodayTasks, spheres)

  if (topSphere) {
    items.push({ kind: 'sphere', ...topSphere })
  }

  return items
}

function getNextTimedTask(tasks: Task[], nowTime: string): Task | null {
  return (
    tasks
      .filter(
        (task) =>
          task.plannedStartTime !== null &&
          formatTime(task.plannedStartTime) >= nowTime,
      )
      .sort((left, right) =>
        formatTime(left.plannedStartTime ?? '').localeCompare(
          formatTime(right.plannedStartTime ?? ''),
        ),
      )[0] ?? null
  )
}

function getTopSphere(
  tasks: Task[],
  spheres: Pick<Sphere, 'id' | 'name'>[],
): { count: number; name: string } | null {
  const counts = new Map<string, number>()

  for (const task of tasks) {
    // Only real spheres: legacy free-text projects include placeholders
    // like «Без сферы» that make no sense as "the busiest sphere".
    const name =
      spheres.find((sphere) => sphere.id === task.sphereId)?.name.trim() ?? ''

    if (name) {
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }

  let top: { count: number; name: string } | null = null

  for (const [name, count] of counts) {
    if (!top || count > top.count) {
      top = { count, name }
    }
  }

  // A single task does not make a "busiest sphere" worth mentioning.
  return top && top.count >= 2 ? top : null
}
