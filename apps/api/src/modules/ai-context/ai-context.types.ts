import type {
  PlannerSearchType,
  TodayContextInclude,
} from './ai-context.permissions.js'

export type AiLoadLevel = 'critical' | 'high' | 'low' | 'normal'
export type AiLoadReasonSeverity = 'critical' | 'high' | 'low' | 'medium'
export type AiSuggestedMode = 'light' | 'minimum' | 'normal'

export interface AiTaskItem {
  area?: string | null
  dueDate?: string | null
  importance?: 'important' | 'not_important' | (string & {}) | null
  obligation?: 'desired' | 'optional' | 'required' | (string & {}) | null
  priority?: 'high' | 'low' | 'normal' | (string & {}) | null
  resource?: number | null
  resourceImpact?: 'drain' | 'neutral' | 'restore' | 'unknown'
  resourceMagnitude?: number | null
  snippet?: string | null
  source: 'tasks'
  status: 'cancelled' | 'done' | 'overdue' | 'todo' | (string & {})
  tags?: string[]
  title: string
  urgency?: 'not_urgent' | 'urgent' | (string & {}) | null
}

export interface AiTaskGroup {
  count: number
  dates: string[]
  source: 'tasks'
  title: string
}

export interface AiCalendarEvent {
  end?: string | null
  location?: string | null
  source: 'calendar'
  start: string
  title: string
}

export interface AiShoppingItem {
  activatedAt?: string | null
  addedAt?: string | null
  category?: string | null
  completedAt?: string | null
  dueDate?: string | null
  source: 'shopping'
  status: 'done' | 'overdue' | 'todo' | (string & {})
  title: string
  urgent?: boolean
}

export interface AiCleaningTask {
  date?: string | null
  source: 'cleaning'
  status: 'done' | 'overdue' | 'todo' | (string & {})
  title: string
  zone?: string | null
}

export interface AiCleaningOverdueZoneGroup {
  count: number
  items: AiCleaningTask[]
  zone: string
}

export interface AiSelfCareItem {
  category?: string | null
  date?: string | null
  source: 'selfcare'
  status: 'done' | 'missed' | 'overdue' | 'planned' | (string & {})
  title: string
  type?: string | null
}

export interface AiFlexibleGoalContext {
  category?: string | null
  date: string
  doneCount: number
  expectedRepeats: true
  id: string
  remainingCount: number
  source: 'selfcare'
  status: 'done' | 'in_progress' | 'planned'
  targetCount: number
  title: string
  type: 'flexible_goal'
  unit?: string | null
}

export interface AiFlexibleGoalSummary {
  completedGoals: number
  inProgressGoals: number
  items: AiFlexibleGoalContext[]
  totalGoals: number
}

export interface AiHabitItem {
  date?: string | null
  source: 'habits'
  status: 'done' | 'missed' | 'planned' | (string & {})
  streak?: number | null
  title: string
}

export interface AiOverdueSummary {
  cleaning: number
  habits: number
  selfcare: number
  shopping: number
  tasks: number
  total: number
}

export interface AiOverdueItemsByDomain {
  cleaning: AiCleaningTask[]
  habits: AiHabitItem[]
  selfcare: AiSelfCareItem[]
  shopping: AiShoppingItem[]
  tasks: AiTaskItem[]
}

export interface AiLoadReason {
  code: string
  count: number
  domain: 'calendar' | 'cleaning' | 'habits' | 'selfcare' | 'shopping' | 'tasks'
  severity: AiLoadReasonSeverity
}

export interface GetTodayContextParams {
  date?: string | undefined
  include?: TodayContextInclude[] | undefined
  timezone?: string | undefined
  userId: string
}

export interface TodayContext {
  calendar?: {
    events: AiCalendarEvent[]
    totalCount: number
  }
  cleaning?: {
    overdue: AiCleaningTask[]
    tasks: AiCleaningTask[]
    todayZone?: string | null
  }
  cleaningOverdueByZone?: AiCleaningOverdueZoneGroup[]
  date: string
  generatedAt: string
  habits?: {
    completed: AiHabitItem[]
    missed: AiHabitItem[]
    planned: AiHabitItem[]
  }
  overdue?: AiOverdueSummary
  overdueItemsByDomain?: AiOverdueItemsByDomain
  selfCare?: {
    completed: AiSelfCareItem[]
    flexibleGoals: AiFlexibleGoalContext[]
    missed: AiSelfCareItem[]
    overdue: AiSelfCareItem[]
    planned: AiSelfCareItem[]
    remaining: AiSelfCareItem[]
    scheduled: AiSelfCareItem[]
    suggestedFocus?: string | null
  }
  selfCareFlexibleGoals?: AiFlexibleGoalSummary
  shopping?: {
    active: AiShoppingItem[]
    activeCount: number
    completed: AiShoppingItem[]
    completedCount: number
    normal: AiShoppingItem[]
    totalCount: number
    urgent: AiShoppingItem[]
    urgentActiveCount: number
  }
  stats?: {
    activeCounts: {
      calendar: number
      cleaning: number
      habits: number
      selfCare: number
      shopping: number
      tasks: number
      total: number
    }
    loadLevel: AiLoadLevel
    overdueByDomain: {
      cleaning: number
      habits: number
      selfCare: number
      shopping: number
      tasks: number
      total: number
    }
    overdueItems: number
    reasons: string[]
    suggestedMode: AiSuggestedMode
    totalPlannedItems: number
  }
  tasks?: {
    activeToday: AiTaskItem[]
    activeTodayCount: number
    completedToday: AiTaskItem[]
    completedTodayCount: number
    important: AiTaskItem[]
    importantActiveToday: AiTaskItem[]
    importantOverdue: AiTaskItem[]
    lowEnergy: AiTaskItem[]
    overdue: AiTaskItem[]
    overdueCount: number
    today: AiTaskItem[]
    totalCount: number
  }
  timezone: string
}

export interface GetWeekContextParams {
  from?: string | undefined
  include?: string[] | undefined
  timezone?: string | undefined
  to?: string | undefined
  userId: string
}

export interface WeekContext {
  bottlenecks: string[]
  from: string
  generatedAt: string
  highlights: {
    completed: AiTaskItem[]
    overdue: AiTaskItem[]
    repeatedRoutineGroups?: AiTaskGroup[]
    repeatedOrStuck: AiTaskItem[]
    upcomingImportant: AiTaskItem[]
  }
  possibleSimplifications: string[]
  progress: {
    cleaningCompleted: {
      count: number
      items: AiCleaningTask[]
    }
    selfCareCompleted: {
      count: number
      items: AiSelfCareItem[]
    }
    selfCareFlexibleGoals: AiFlexibleGoalSummary
    shoppingCompleted: {
      count: number
      items: AiShoppingItem[]
    }
    tasksCompleted: {
      count: number
      items: AiTaskItem[]
    }
  }
  remaining: {
    cleaningOverdue: AiCleaningTask[]
    cleaningOverdueByZone: AiCleaningOverdueZoneGroup[]
    selfCareFlexibleGoals: AiFlexibleGoalSummary
    selfCareRemaining: AiSelfCareItem[]
    shoppingActive: AiShoppingItem[]
    tasksActive: AiTaskItem[]
  }
  summary: {
    cleaningActive: number
    cleaningOverdueCurrentBacklog: number
    cleaningScheduledThisPeriod: number
    cleaningTasks: number
    cleaningOverdue: number
    completedTasks: number
    loadLevel: AiLoadLevel
    movedTasks?: number
    overdueTasks: number
    plannedTasks: number
    selfCareRemaining: number
    selfCareScheduled: number
    selfCareCompleted: number
    selfCareFlexibleGoals: AiFlexibleGoalSummary
    selfCareMissed: number
    selfCareOverdue: number
    shoppingActive: number
    shoppingCompleted: number
    shoppingItems: number
    shoppingTotal: number
    shoppingUrgentActive: number
    taskGroupsActive: number
    taskOccurrencesActive: number
    tasksActive: number
  }
  timezone: string
  to: string
}

export interface SearchPlannerParams {
  from?: string | undefined
  limit?: number | undefined
  query: string
  status?: 'any' | 'done' | 'overdue' | 'todo' | undefined
  to?: string | undefined
  types?: PlannerSearchType[] | undefined
  userId: string
}

export interface PlannerSearchResult {
  items: Array<
    | AiCalendarEvent
    | AiCleaningTask
    | AiHabitItem
    | AiSelfCareItem
    | AiShoppingItem
    | AiTaskItem
  >
  query: string
  returnedCount: number
  totalCount: number
}

export interface GetOverloadContextParams {
  from?: string | undefined
  timezone?: string | undefined
  to?: string | undefined
  userId: string
}

export interface OverloadContext {
  bottlenecks: Array<{
    reason: string
    relatedItemsCount: number
    title: string
  }>
  counts: {
    activeItemsTotal: number
    calendarEvents: number
    calendarEventsActive: number
    cleaningActive: number
    cleaningOverdue: number
    cleaningTasks: number
    habitsMissed: number
    overdueItemsTotal: number
    selfCareRemaining: number
    selfCareMissed: number
    selfCareOverdue: number
    shoppingActive: number
    shoppingCompleted: number
    shoppingItems: number
    shoppingOverdue: number
    tasksActive: number
    tasksHighPriority: number
    tasksHighPriorityActive: number
    tasksOverdue: number
    tasksTotal: number
  }
  from: string
  generatedAt: string
  load: {
    activeCounts: {
      calendarEvents: number
      cleaningOverdue: number
      selfcareOverdue: number
      selfcareMissed: number
      shoppingActive: number
      tasksActive: number
      tasksHighPriorityActive: number
    }
    activeScore: number
    ignoredCounts: {
      completedHighPriorityTasks: number
      completedSelfcare: number
      completedShopping: number
      completedTasks: number
    }
    level: AiLoadLevel
    reasons: string[]
    score: number
    structuredReasons: AiLoadReason[]
  }
  cleaningOverdueByZone?: AiCleaningOverdueZoneGroup[]
  overdue?: AiOverdueSummary
  overdueItemsByDomain?: AiOverdueItemsByDomain
  suggestedFocus: string[]
  timezone: string
  to: string
}

export interface GetSelfCareContextParams {
  from?: string | undefined
  timezone?: string | undefined
  to?: string | undefined
  userId: string
}

export interface SelfCareContext {
  completed: AiSelfCareItem[]
  flexibleGoals: AiFlexibleGoalContext[]
  from: string
  generatedAt: string
  missed: AiSelfCareItem[]
  overdue: AiSelfCareItem[]
  planned: AiSelfCareItem[]
  potentialDuplicates: AiSelfCareDuplicate[]
  remaining: AiSelfCareItem[]
  scheduled: AiSelfCareItem[]
  summary: {
    completedCount: number
    flexibleGoals: AiFlexibleGoalSummary
    missedCount: number
    overdueCount: number
    potentialDuplicateCount: number
    plannedCount: number
    remainingCount: number
    scheduledCount: number
    selfCareFlexibleGoals: AiFlexibleGoalSummary
    suggestedGentleFocus: string | null
    weakSpots: string[]
  }
  timezone: string
  to: string
}

export interface AiSelfCareDuplicate {
  count: number
  dates: string[]
  statuses: string[]
  title: string
  type?: string | null
}

export interface AiContextReadContext {
  actorUserId?: string
  auth: {
    accessToken: string
    claims: {
      payload: Record<string, unknown>
      role: 'authenticated'
      sub: string
    }
  } | null
  clientTimeZone?: string
  groupRole?: string | null
  role?: string
  workspaceKind?: string
  workspaceId: string
  workspaceName?: string
}
