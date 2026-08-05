import {
  selectArchivedTasks,
  selectDoneBeforeTodayTasks,
  selectDoneTodayTasks,
  selectOverdueTasks,
  selectTodayTasks,
  selectTodoTasks,
  selectTomorrowTasks,
  type Task,
} from '@/entities/task'

export interface BuildTodayTaskModelInput {
  plannerTimeZone: string
  tasks: Task[]
  todayKey: string
  tomorrowKey: string
}

export interface TodayTaskModel {
  archivedTasks: Task[]
  doneHistoryTasks: Task[]
  doneTodayTasks: Task[]
  mainTodayTasks: Task[]
  otherTasks: Task[]
  overdueTasks: Task[]
  resourceTasks: Task[]
  routineTasks: Task[]
  tomorrowTasks: Task[]
}

export interface TodaySectionDefaultCollapseState {
  doneHistory: boolean
  doneToday: boolean
  other: boolean
  tomorrow: boolean
}

export interface TodaySectionDefaultCollapseStateInput {
  doneTodayExtraItemCount?: number
  doneTodayTasks: Task[]
  mainTodayTasks: Task[]
  otherTasks: Task[]
  overdueTasks: Task[]
  routineExtraItemCount?: number
  routineTasks: Task[]
  tomorrowExtraItemCount?: number
  tomorrowTasks: Task[]
}

function hasSectionItems(tasks: Task[], extraItemCount = 0): boolean {
  return tasks.length + extraItemCount > 0
}

function isRoutineTask(task: Task): boolean {
  return Boolean(task.routine)
}

export function buildTodayTaskModel({
  plannerTimeZone,
  tasks,
  todayKey,
  tomorrowKey,
}: BuildTodayTaskModelInput): TodayTaskModel {
  const todayTasks = selectTodayTasks(tasks, todayKey)
  const doneTodayTasks = selectDoneTodayTasks(tasks, todayKey, plannerTimeZone)
  const doneHistoryTasks = selectDoneBeforeTodayTasks(
    tasks,
    todayKey,
    plannerTimeZone,
  )
  const archivedTasks = selectArchivedTasks(tasks)
  const routineTasks = todayTasks.filter(isRoutineTask)
  const mainTodayTasks = todayTasks.filter((task) => !isRoutineTask(task))
  const overdueTasks = selectOverdueTasks(tasks, todayKey)
  const tomorrowTasks = selectTomorrowTasks(tasks, tomorrowKey)
  const visibleTaskIds = new Set([
    ...mainTodayTasks.map((task) => task.id),
    ...routineTasks.map((task) => task.id),
    ...overdueTasks.map((task) => task.id),
    ...tomorrowTasks.map((task) => task.id),
  ])
  const otherTasks = selectTodoTasks(tasks).filter(
    (task) => !visibleTaskIds.has(task.id),
  )

  return {
    archivedTasks,
    doneHistoryTasks,
    doneTodayTasks,
    mainTodayTasks,
    otherTasks,
    overdueTasks,
    resourceTasks: [...todayTasks, ...doneTodayTasks],
    routineTasks,
    tomorrowTasks,
  }
}

export function getTodaySectionDefaultCollapseState({
  doneTodayExtraItemCount = 0,
  doneTodayTasks,
  mainTodayTasks,
  otherTasks,
  overdueTasks,
  routineExtraItemCount = 0,
  routineTasks,
  tomorrowExtraItemCount = 0,
  tomorrowTasks,
}: TodaySectionDefaultCollapseStateInput): TodaySectionDefaultCollapseState {
  const hasTodaySection = hasSectionItems(mainTodayTasks)
  const hasRoutineSection = hasSectionItems(routineTasks, routineExtraItemCount)
  const hasOverdueSection = hasSectionItems(overdueTasks)
  const beforeTomorrow =
    hasTodaySection || hasRoutineSection || hasOverdueSection
  const hasTomorrowSection = hasSectionItems(
    tomorrowTasks,
    tomorrowExtraItemCount,
  )
  const beforeOther = beforeTomorrow || hasTomorrowSection
  const hasOtherSection = hasSectionItems(otherTasks)
  const beforeDoneToday = beforeOther || hasOtherSection
  const hasDoneTodaySection = hasSectionItems(
    doneTodayTasks,
    doneTodayExtraItemCount,
  )
  const beforeDoneHistory = beforeDoneToday || hasDoneTodaySection

  return {
    doneHistory: beforeDoneHistory,
    doneToday: beforeDoneToday,
    other: beforeOther,
    tomorrow: beforeTomorrow,
  }
}
