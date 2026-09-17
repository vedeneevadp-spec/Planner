import { getTaskResource, isActiveTaskStatus, type Task } from '@/entities/task'

export type EnergyMode = 'maximum' | 'minimum' | 'normal'
export type LoadState = 'calm' | 'edge' | 'overload' | 'unknown'

export interface EnergyModeConfig {
  description: string
  focusLimit: number
  label: string
  supportLimit: string
  resourceLimit: number
}

export interface DailyLoadAnalysis {
  assessedState: Exclude<LoadState, 'unknown'>
  assessedTaskCount: number
  isComplete: boolean
  resourceLimit: number
  overloadScore: number
  state: LoadState
  totalResource: number
  totalTaskCount: number
  unassessedTaskCount: number
}

export interface DailyTaskGroups {
  focusTasks: Task[]
  routineTasks: Task[]
  supportTasks: Task[]
}

export const ENERGY_MODE_CONFIGS: Record<EnergyMode, EnergyModeConfig> = {
  minimum: {
    description: 'День усталости: оставь только необходимое.',
    resourceLimit: 4,
    focusLimit: 1,
    label: 'Минимум',
    supportLimit: 'до 2 поддерживающих',
  },
  normal: {
    description: 'Обычный темп без героизма.',
    resourceLimit: 8,
    focusLimit: 3,
    label: 'Норм',
    supportLimit: '3-5 поддерживающих',
  },
  maximum: {
    description: 'Редкий день высокой энергии.',
    resourceLimit: 12,
    focusLimit: 5,
    label: 'Максимум',
    supportLimit: 'можно заглянуть в backlog',
  },
}

const ROUTINE_KEYWORDS = [
  'быт',
  'готов',
  'детсад',
  'ежеднев',
  'забрать',
  'корм',
  'оплат',
  'покуп',
  'прогул',
  'рутин',
  'уборк',
  'школ',
]

export function analyzeDailyLoad(
  tasks: Task[],
  energyMode: EnergyMode,
  isTaskDataComplete = true,
): DailyLoadAnalysis {
  const resourceLimit = ENERGY_MODE_CONFIGS[energyMode].resourceLimit
  const assessedTasks = tasks.filter(
    (task) =>
      typeof task.resource === 'number' && Number.isFinite(task.resource),
  )
  const assessedTaskCount = assessedTasks.length
  const totalTaskCount = tasks.length
  const unassessedTaskCount = totalTaskCount - assessedTaskCount
  const isComplete = isTaskDataComplete && unassessedTaskCount === 0
  const totalResource = Math.max(
    0,
    assessedTasks.reduce((sum, task) => sum - getTaskResource(task), 0),
  )
  const overloadScore = Math.round((totalResource / resourceLimit) * 100)
  const assessedState: DailyLoadAnalysis['assessedState'] =
    overloadScore > 100 ? 'overload' : overloadScore >= 80 ? 'edge' : 'calm'

  return {
    assessedState,
    assessedTaskCount,
    isComplete,
    resourceLimit,
    overloadScore,
    state: isComplete ? assessedState : 'unknown',
    totalResource,
    totalTaskCount,
    unassessedTaskCount,
  }
}

export function isRoutineTask(
  task: Pick<Task, 'project' | 'title' | 'urgency'>,
): boolean {
  if (task.urgency === 'urgent') {
    return true
  }

  const haystack = `${task.project} ${task.title}`.toLowerCase()

  return ROUTINE_KEYWORDS.some((keyword) => haystack.includes(keyword))
}

export function groupDailyTasks(tasks: Task[]): DailyTaskGroups {
  return tasks.reduce<DailyTaskGroups>(
    (groups, task) => {
      if (isRoutineTask(task)) {
        groups.routineTasks.push(task)
        return groups
      }

      if (task.importance === 'important') {
        groups.focusTasks.push(task)
        return groups
      }

      groups.supportTasks.push(task)
      return groups
    },
    {
      focusTasks: [],
      routineTasks: [],
      supportTasks: [],
    },
  )
}

export function getUnloadCandidates(tasks: Task[], limit = 3): Task[] {
  return [...tasks]
    .filter(
      (task) => isActiveTaskStatus(task.status) && getTaskResource(task) < 0,
    )
    .sort((left, right) => {
      if (left.importance !== right.importance) {
        return left.importance === 'important' ? 1 : -1
      }

      const resourceDelta =
        Math.abs(getTaskResource(right)) - Math.abs(getTaskResource(left))

      if (resourceDelta !== 0) {
        return resourceDelta
      }

      return left.createdAt < right.createdAt ? -1 : 1
    })
    .slice(0, limit)
}

export function getLoadStateLabel(state: LoadState): string {
  if (state === 'unknown') {
    return 'неполная оценка'
  }

  if (state === 'overload') {
    return 'перегруз'
  }

  if (state === 'edge') {
    return 'на грани'
  }

  return 'спокойно'
}
