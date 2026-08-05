import type {
  SelfCareDashboardResponse,
  SelfCareTodayItem,
} from '@planner/contracts'

import { getTimeInTimeZone } from '@/shared/time/time.service'

const HIDDEN_OCCURRENCE_STATUSES: ReadonlySet<
  NonNullable<SelfCareTodayItem['occurrence']>['status']
> = new Set(['cancelled', 'done', 'missed', 'moved', 'partial', 'skipped'])

export interface BuildTodaySelfCareModelInput {
  todayDashboard: SelfCareDashboardResponse | undefined
  tomorrowDashboard: SelfCareDashboardResponse | undefined
}

export interface TodaySelfCareModel {
  overdueEntries: SelfCareTodayItem[]
  routineEntries: SelfCareTodayItem[]
  showSelfCareMainTasks: boolean
  tomorrowEntries: SelfCareTodayItem[]
}

export function isVisibleSelfCareMainTask(entry: SelfCareTodayItem): boolean {
  if (entry.item.isArchived || !entry.item.isActive || entry.completion) {
    return false
  }

  if (
    entry.item.type === 'course' &&
    (entry.courseDetails?.isCompleted ||
      entry.courseDetails?.isPaused ||
      (entry.occurrence &&
        entry.scheduleRule?.repeatKind === 'course' &&
        entry.scheduleRule.startDate &&
        entry.occurrence.scheduledFor < entry.scheduleRule.startDate))
  ) {
    return false
  }

  if (
    entry.occurrence &&
    HIDDEN_OCCURRENCE_STATUSES.has(entry.occurrence.status)
  ) {
    return false
  }

  if (
    entry.flexibleProgress &&
    entry.flexibleProgress.completedCount >= entry.flexibleProgress.targetCount
  ) {
    return false
  }

  return true
}

export function isSelfCareDailyFlexibleGoal(entry: SelfCareTodayItem): boolean {
  const rule = entry.scheduleRule

  if (!rule) {
    return false
  }

  return (
    rule.flexiblePeriod === 'day' &&
    (entry.item.type === 'flexible_goal' || rule.repeatKind === 'flexible_goal')
  )
}

export function getSelfCareMainTaskEntries(
  dashboard: SelfCareDashboardResponse,
): SelfCareTodayItem[] {
  return [
    ...dashboard.todayItems,
    ...dashboard.flexibleGoals.filter(isSelfCareDailyFlexibleGoal),
  ].filter(isVisibleSelfCareMainTask)
}

export function buildTodaySelfCareModel({
  todayDashboard,
  tomorrowDashboard,
}: BuildTodaySelfCareModelInput): TodaySelfCareModel {
  const showSelfCareMainTasks =
    todayDashboard?.settings.showSelfCareInMainTasks ??
    tomorrowDashboard?.settings.showSelfCareInMainTasks ??
    false

  return {
    overdueEntries:
      showSelfCareMainTasks && todayDashboard
        ? todayDashboard.overdueItems.filter(isVisibleSelfCareMainTask)
        : [],
    routineEntries:
      showSelfCareMainTasks && todayDashboard
        ? getSelfCareMainTaskEntries(todayDashboard)
        : [],
    showSelfCareMainTasks,
    tomorrowEntries:
      showSelfCareMainTasks && tomorrowDashboard
        ? getSelfCareMainTaskEntries(tomorrowDashboard)
        : [],
  }
}

export function getSelfCareTaskKey(entry: SelfCareTodayItem): string {
  return `self-care-${entry.occurrence?.id ?? entry.item.id}`
}

export function getSelfCareTaskTime(
  entry: SelfCareTodayItem,
  plannerTimeZone: string,
): string | null {
  const sourceTime =
    entry.occurrence?.dueAt ??
    entry.appointment?.startsAt ??
    entry.scheduleRule?.preferredTime ??
    null

  if (!sourceTime) {
    return null
  }

  if (sourceTime.includes('T')) {
    try {
      return getTimeInTimeZone(
        sourceTime,
        entry.occurrence?.reminderTimeZone ??
          entry.scheduleRule?.timezone ??
          plannerTimeZone,
      )
    } catch {
      // Preserve the legacy fallback for malformed date-time strings.
    }
  }

  const plainTime = /^(\d{2}:\d{2})/.exec(sourceTime)?.[1]
  const isoTime = /T(\d{2}:\d{2})/.exec(sourceTime)?.[1]

  return plainTime ?? isoTime ?? null
}

export function formatSelfCareTaskMeta(
  entry: SelfCareTodayItem,
  plannerTimeZone: string,
): string {
  const time = getSelfCareTaskTime(entry, plannerTimeZone)

  return time ? `Забота · ${time}` : 'Забота'
}
