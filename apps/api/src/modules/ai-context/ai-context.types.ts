import type {
  PlannerSearchType,
  TodayContextInclude,
} from './ai-context.permissions.js'

export type AiLoadLevel = 'critical' | 'high' | 'low' | 'normal'
export type AiSuggestedMode = 'light' | 'minimum' | 'normal'

export interface AiTaskItem {
  area?: string | null
  dueDate?: string | null
  priority?: 'high' | 'low' | 'normal' | (string & {}) | null
  snippet?: string | null
  source: 'tasks'
  status: 'cancelled' | 'done' | 'overdue' | 'todo' | (string & {})
  tags?: string[]
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
  category?: string | null
  source: 'shopping'
  status: 'done' | 'todo' | (string & {})
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

export interface AiSelfCareItem {
  date?: string | null
  source: 'selfcare'
  status: 'done' | 'missed' | 'planned' | (string & {})
  title: string
  type?: string | null
}

export interface AiHabitItem {
  date?: string | null
  source: 'habits'
  status: 'done' | 'missed' | 'planned' | (string & {})
  streak?: number | null
  title: string
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
  date: string
  generatedAt: string
  habits?: {
    completed: AiHabitItem[]
    missed: AiHabitItem[]
    planned: AiHabitItem[]
  }
  selfCare?: {
    completed: AiSelfCareItem[]
    missed: AiSelfCareItem[]
    planned: AiSelfCareItem[]
    suggestedFocus?: string | null
  }
  shopping?: {
    normal: AiShoppingItem[]
    totalCount: number
    urgent: AiShoppingItem[]
  }
  stats?: {
    loadLevel: AiLoadLevel
    overdueItems: number
    reasons: string[]
    suggestedMode: AiSuggestedMode
    totalPlannedItems: number
  }
  tasks?: {
    important: AiTaskItem[]
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
    repeatedOrStuck: AiTaskItem[]
    upcomingImportant: AiTaskItem[]
  }
  possibleSimplifications: string[]
  summary: {
    cleaningTasks: number
    completedTasks: number
    loadLevel: AiLoadLevel
    movedTasks?: number
    overdueTasks: number
    plannedTasks: number
    selfCareCompleted: number
    selfCareMissed: number
    shoppingItems: number
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
    calendarEvents: number
    cleaningTasks: number
    selfCareMissed: number
    shoppingItems: number
    tasksHighPriority: number
    tasksOverdue: number
    tasksTotal: number
  }
  from: string
  generatedAt: string
  load: {
    level: AiLoadLevel
    reasons: string[]
    score: number
  }
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
  from: string
  generatedAt: string
  missed: AiSelfCareItem[]
  planned: AiSelfCareItem[]
  summary: {
    completedCount: number
    missedCount: number
    plannedCount: number
    suggestedGentleFocus: string | null
    weakSpots: string[]
  }
  timezone: string
  to: string
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
