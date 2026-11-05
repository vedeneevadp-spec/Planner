import {
  addDateDays,
  type ChaosInboxItemRecord,
  type ChaosInboxKind,
  type ChaosInboxStatus,
  type CleaningListResponse,
  type CleaningTodayResponse,
  enumerateDateRange,
  getDateKeyInTimeZone,
  getIsoWeekStartDate,
  getTodayDate,
  isValidTimeZone,
  type SelfCareAnalyticsResponse,
  type SelfCareHistoryResponse,
  type SelfCarePlanResponse,
  type SelfCareTodayItem,
  type Task,
  type WorkspaceGroupRole,
  type WorkspaceKind,
  type WorkspaceRole,
} from '@planner/contracts'

import { isHttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import { buildCleaningTodayResponse } from '../cleaning/cleaning.shared.js'
import type { TaskContextPageFilters } from '../tasks/task.model.js'
import {
  compactArrayForAi,
  compactForAi,
  sortImportantFirst,
} from './ai-context.compact.js'
import {
  PLANNER_SEARCH_TYPES,
  resolveTodayContextInclude,
  resolveWeekContextInclude,
  type TodayContextInclude,
} from './ai-context.permissions.js'
import type {
  AiCalendarEvent,
  AiCleaningOverdueZoneGroup,
  AiCleaningTask,
  AiContextSourceCoverage,
  AiFlexibleGoalContext,
  AiFlexibleGoalSummary,
  AiHabitItem,
  AiLoadLevel,
  AiLoadReason,
  AiOverdueItemsByDomain,
  AiOverdueSummary,
  AiSelfCareDuplicate,
  AiSelfCareItem,
  AiShoppingItem,
  AiSourceCoverage,
  AiSuggestedMode,
  AiTaskGroup,
  AiTaskItem,
  FullWeekContext,
  GetOverloadContextParams,
  GetSelfCareContextParams,
  GetTodayContextParams,
  GetWeekContextParams,
  OverloadContext,
  PlannerSearchResult,
  SearchPlannerParams,
  SelfCareContext,
  TodayContext,
  WeekContext,
} from './ai-context.types.js'
import { getAiDateRangeError } from './ai-context.validation.js'

const DEFAULT_TIMEZONE = 'Europe/Astrakhan'
const AI_SOURCE_PAGE_SIZE = 100
const AI_SOURCE_MAX_ITEMS = 500

interface SessionSnapshotLike {
  actor: {
    email: string
  }
  actorUserId: string
  groupRole: WorkspaceGroupRole | null
  role: WorkspaceRole
  workspace: {
    kind: WorkspaceKind
    name: string
  }
  workspaceId: string
  workspaces: Array<{
    id: string
    kind: WorkspaceKind
    name: string
  }>
}

interface SessionServiceLike {
  resolveSession(input: {
    actorUserId: string | undefined
    auth: AuthenticatedRequestContext | null
    workspaceId: string | undefined
  }): Promise<SessionSnapshotLike>
}

interface TaskServiceLike {
  searchTasksCursor(
    context: AiServiceReadContext,
    filters: TaskContextPageFilters,
  ): Promise<{
    items: Task[]
    returnedCount: number
    totalCount: number
    truncated: boolean
    hasMore: boolean
    nextCursor: string | null
  }>
  getTaskReadModel(
    context: AiServiceReadContext,
    filters: {
      activeLimit: number
      dateFrom: string
      dateTo: string
      historyLimit: number
      rangeLimit: number
    },
  ): Promise<{
    items: Array<Task & { userId?: string; workspaceId?: string }>
    returnedCount: number
    totalCount: number
    truncated: boolean
  }>
}

interface ChaosInboxServiceLike {
  listItems(
    context: AiServiceReadContext,
    filters?: {
      kind?: ChaosInboxKind
      limit?: number
      page?: number
      status?: ChaosInboxStatus
    },
  ): Promise<{ items: ChaosInboxItemRecord[]; total: number }>
}

interface CleaningServiceLike {
  getToday(
    context: AiServiceReadContext,
    date: string,
  ): Promise<CleaningTodayResponse>
  listCleaning?(context: AiServiceReadContext): Promise<CleaningListResponse>
}

interface SelfCareServiceLike {
  getAnalytics?(
    context: AiServiceReadContext,
    from: string,
    to: string,
  ): Promise<SelfCareAnalyticsResponse>
  getDashboard(
    context: AiServiceReadContext,
    date: string,
  ): Promise<{
    flexibleGoals: SelfCareTodayItem[]
    overdueItems: SelfCareTodayItem[]
    planningHints: SelfCareTodayItem[]
    todayItems: SelfCareTodayItem[]
    upcomingImportant: SelfCareTodayItem[]
  }>
  getHistory(
    context: AiServiceReadContext,
    from: string,
    to: string,
  ): Promise<SelfCareHistoryResponse>
  getPlan(
    context: AiServiceReadContext,
    from: string,
    to: string,
  ): Promise<SelfCarePlanResponse>
}

interface AiServiceReadContext {
  actorUserId?: string | undefined
  auth: AuthenticatedRequestContext | null
  clientTimeZone?: string | undefined
  groupRole?: WorkspaceGroupRole | null | undefined
  role?: WorkspaceRole | undefined
  workspaceKind?: WorkspaceKind | undefined
  workspaceId: string
  workspaceName?: string | undefined
}

export interface AiContextServiceDependencies {
  chaosInboxService?: ChaosInboxServiceLike | undefined
  cleaningService?: CleaningServiceLike | undefined
  selfCareService?: SelfCareServiceLike | undefined
  sessionService: SessionServiceLike
  taskService: TaskServiceLike
}

interface LoadedContext {
  calendar: AiCalendarEvent[]
  cleaning: {
    completed: AiCleaningTask[]
    overdue: AiCleaningTask[]
    tasks: AiCleaningTask[]
    todayZone: string | null
  }
  habits: {
    completed: AiHabitItem[]
    missed: AiHabitItem[]
    planned: AiHabitItem[]
  }
  selfCare: {
    completed: AiSelfCareItem[]
    flexibleGoals: AiFlexibleGoalContext[]
    missed: AiSelfCareItem[]
    overdue: AiSelfCareItem[]
    planned: AiSelfCareItem[]
    remaining: AiSelfCareItem[]
    scheduled: AiSelfCareItem[]
    suggestedFocus: string | null
  }
  shopping: AiShoppingItem[]
  sourceCoverage: {
    calendar: AiSourceCoverage
    shopping: AiSourceCoverage
    tasks: AiSourceCoverage
    taskCompletions: AiSourceCoverage & { nextCursor: string | null }
  }
  tasks: {
    all: AiTaskItem[]
    completedToday: AiTaskItem[]
    completedTodayCount: number
    flexible: AiTaskItem[]
    important: AiTaskItem[]
    lowEnergy: AiTaskItem[]
    overdue: AiTaskItem[]
    today: AiTaskItem[]
  }
}

export class AiContextService {
  constructor(private readonly dependencies: AiContextServiceDependencies) {}

  async getTodayContext(params: GetTodayContextParams): Promise<TodayContext> {
    const timezone = resolveTimezone(params.timezone)
    const date = params.date ?? getTodayDate(timezone)
    validateDateRange(date, date)
    const include = resolveTodayContextInclude(params.include)
    const context = await this.resolvePersonalReadContext(
      params.userId,
      timezone,
    )
    const loaded = await this.loadDayContext(
      context,
      params.userId,
      date,
      include,
    )
    const result: TodayContext = {
      date,
      generatedAt: new Date().toISOString(),
      sourceCoverage: {
        ...(include.includes('calendar') || include.includes('stats')
          ? { calendar: loaded.sourceCoverage.calendar }
          : {}),
        ...(include.includes('tasks') || include.includes('stats')
          ? {
              tasks: loaded.sourceCoverage.tasks,
              taskCompletions: {
                ...loaded.sourceCoverage.taskCompletions,
                nextCursor: include.includes('tasks')
                  ? loaded.sourceCoverage.taskCompletions.nextCursor
                  : null,
              },
            }
          : {}),
        ...(include.includes('shopping') || include.includes('stats')
          ? { shopping: loaded.sourceCoverage.shopping }
          : {}),
      },
      timezone,
    }
    const shopping = markShoppingOverdue(loaded.shopping, date)
    const activeShopping = shopping.filter(isActiveShoppingItem)
    const completedShopping = shopping.filter(isCompletedShoppingItem)
    const overdueShopping = activeShopping.filter(
      (item) => item.status === 'overdue',
    )
    const overdueByDomain = {
      cleaning: loaded.cleaning.overdue.length,
      habits: loaded.habits.missed.length,
      selfCare: loaded.selfCare.overdue.length,
      shopping: overdueShopping.length,
      tasks: loaded.tasks.overdue.length,
    }

    const overdueSummary = buildOverdueSummary(overdueByDomain)
    result.overdue = { total: 0 }
    for (const domain of [
      'tasks',
      'shopping',
      'cleaning',
      'selfcare',
      'habits',
    ] as const) {
      if (include.includes(domain) || include.includes('stats')) {
        result.overdue[domain] = overdueSummary[domain]
        result.overdue.total += overdueSummary[domain]
      }
    }
    result.overdueItemsByDomain = {
      ...(include.includes('tasks')
        ? { tasks: prepareItems(loaded.tasks.overdue, date) }
        : {}),
      ...(include.includes('shopping')
        ? { shopping: prepareItems(overdueShopping) }
        : {}),
      ...(include.includes('cleaning')
        ? { cleaning: prepareItems(loaded.cleaning.overdue) }
        : {}),
      ...(include.includes('selfcare')
        ? { selfcare: prepareItems(loaded.selfCare.overdue) }
        : {}),
      ...(include.includes('habits')
        ? { habits: prepareItems(loaded.habits.missed) }
        : {}),
    }

    if (include.includes('tasks')) {
      result.tasks = {
        activeToday: prepareItems(loaded.tasks.today, date),
        activeTodayCount: loaded.tasks.today.length,
        completedToday: prepareItems(loaded.tasks.completedToday, date),
        completedTodayCount: loaded.tasks.completedTodayCount,
        flexible: prepareItems(loaded.tasks.flexible, date),
        flexibleCount: loaded.tasks.flexible.length,
        important: prepareItems(loaded.tasks.important, date),
        importantActiveToday: prepareItems(loaded.tasks.important, date),
        importantOverdue: prepareItems(
          loaded.tasks.overdue.filter((item) => item.priority === 'high'),
          date,
        ),
        lowEnergy: prepareItems(loaded.tasks.lowEnergy, date),
        overdue: prepareItems(loaded.tasks.overdue, date),
        overdueCount: loaded.tasks.overdue.length,
        today: prepareItems(loaded.tasks.today, date),
        totalCount: loaded.tasks.all.length,
      }
    }

    if (include.includes('calendar')) {
      result.calendar = {
        events: prepareItems(loaded.calendar),
        totalCount: loaded.sourceCoverage.calendar.totalCount,
      }
    }

    if (include.includes('shopping')) {
      const urgent = activeShopping.filter((item) => item.urgent)
      const normal = activeShopping.filter((item) => !item.urgent)

      result.shopping = {
        active: prepareItems(activeShopping),
        activeCount: activeShopping.length,
        completed: prepareItems(completedShopping),
        completedCount: completedShopping.length,
        normal: prepareItems(normal),
        totalCount: shopping.length,
        urgent: prepareItems(urgent),
        urgentActiveCount: urgent.length,
      }
    }

    if (include.includes('cleaning')) {
      result.cleaningOverdueByZone = groupCleaningOverdueByZone(
        loaded.cleaning.overdue,
      )
      result.cleaning = {
        completed: prepareItems(loaded.cleaning.completed),
        completedCount: loaded.cleaning.completed.length,
        overdue: prepareItems(loaded.cleaning.overdue),
        tasks: prepareItems(loaded.cleaning.tasks),
        todayZone: loaded.cleaning.todayZone,
      }
    }

    if (include.includes('selfcare')) {
      result.selfCareFlexibleGoals = buildFlexibleGoalSummary(
        loaded.selfCare.flexibleGoals,
      )
      result.selfCare = {
        completed: prepareItems(loaded.selfCare.completed),
        flexibleGoals: prepareItems(loaded.selfCare.flexibleGoals),
        missed: prepareItems(loaded.selfCare.missed),
        overdue: prepareItems(loaded.selfCare.overdue),
        planned: prepareItems(loaded.selfCare.planned),
        remaining: prepareItems(loaded.selfCare.remaining),
        scheduled: prepareItems(loaded.selfCare.scheduled),
        suggestedFocus: loaded.selfCare.suggestedFocus,
      }
    }

    if (include.includes('stats')) {
      result.stats = buildStats({
        activeCounts: {
          calendar: loaded.sourceCoverage.calendar.totalCount,
          cleaning: countActiveCleaningTasks(loaded.cleaning),
          habits: 0,
          selfCare: loaded.selfCare.remaining.length,
          shopping: activeShopping.length,
          tasks: loaded.tasks.all.length - loaded.tasks.flexible.length,
        },
        overdueByDomain,
      })
    }

    return compactForAi(result, { todayDate: date, includeListCoverage: true })
  }

  getWeekContext(
    params: Omit<GetWeekContextParams, 'include'> & { include?: undefined },
  ): Promise<FullWeekContext>
  getWeekContext(params: GetWeekContextParams): Promise<WeekContext>
  async getWeekContext(params: GetWeekContextParams): Promise<WeekContext> {
    const timezone = resolveTimezone(params.timezone)
    const [from, to] = resolveRange(params.from, params.to, timezone)
    const include = resolveWeekContextInclude(params.include)
    const needsStats = include.includes('stats')
    const context = await this.resolvePersonalReadContext(
      params.userId,
      timezone,
    )
    const taskLoad =
      needsStats || include.includes('tasks')
        ? await this.listTasks(
            context,
            params.userId,
            from,
            to,
            needsStats || include.includes('tasks'),
          )
        : {
            items: [],
            coverage: { returnedCount: 0, totalCount: 0, truncated: false },
            completions: {
              returnedCount: 0,
              totalCount: 0,
              truncated: false,
              nextCursor: null,
            },
          }
    const tasks = taskLoad.items
    const activeTasks = tasks.filter(isActiveTask)
    const weekTasks = activeTasks.filter((task) =>
      isTaskInRange(task, from, to, timezone),
    )
    const flexibleTasks = activeTasks.filter(isFlexibleTask)
    const completedRangeTasks = tasks
      .filter(isTaskCompleted)
      .filter((task) => isTaskInRange(task, from, to, timezone))
    const overdueAsOfDate = resolveOverdueAsOfDate(to, timezone)
    const overdueTasks = activeTasks.filter((task) =>
      isTaskOverdue(task, overdueAsOfDate),
    )
    const shoppingLoad =
      needsStats || include.includes('shopping')
        ? await this.listShopping(context, params.userId)
        : {
            items: [],
            coverage: { returnedCount: 0, totalCount: 0, truncated: false },
          }
    const shopping = markShoppingOverdue(shoppingLoad.items, overdueAsOfDate)
    const activeShopping = shopping.filter(isActiveShoppingItem)
    const completedShopping = shopping
      .filter(isCompletedShoppingItem)
      .filter((item) =>
        matchesDateRange(readShoppingDate(item, timezone), from, to),
      )
    const overdueShopping = activeShopping.filter(
      (item) => item.status === 'overdue',
    )
    const cleaning =
      needsStats || include.includes('cleaning')
        ? await this.getCleaningRange(context, from, to)
        : { completed: [], overdue: [], tasks: [], todayZone: null }
    const cleaningActive = countActiveCleaningTasks(cleaning)
    const cleaningCompleted = cleaning.completed
    const selfCare =
      needsStats || include.includes('selfcare')
        ? await this.getSelfCareRange(context, from, to, overdueAsOfDate)
        : {
            completed: [],
            flexibleGoals: [],
            missed: [],
            overdue: [],
            planned: [],
            remaining: [],
            scheduled: [],
          }
    const taskItems = weekTasks.map((task) =>
      mapTaskItem(task, overdueAsOfDate),
    )
    const completedTaskItems = completedRangeTasks.map((task) =>
      mapTaskItem(task, to),
    )
    const activeTaskGroups = groupTaskOccurrences(weekTasks)
    const overdueItems = overdueTasks.map((task) =>
      mapTaskItem(task, overdueAsOfDate),
    )
    const repeatedRoutineGroups = groupTaskOccurrences(
      weekTasks.filter(isRoutineOrRecurringTask),
    )
    const repeatedOrStuck = repeatedRoutineGroups.map(mapTaskGroupToTaskItem)
    const calendarLoad =
      needsStats || include.includes('calendar')
        ? await this.listCalendar(context, params.userId, from, to)
        : {
            items: [],
            coverage: { returnedCount: 0, totalCount: 0, truncated: false },
          }
    const calendarEvents = calendarLoad.items
    const stats = buildStats({
      activeCounts: {
        calendar: calendarLoad.coverage.totalCount,
        cleaning: cleaningActive,
        habits: 0,
        selfCare: selfCare.remaining.length,
        shopping: activeShopping.length,
        tasks: activeTaskGroups.length,
      },
      overdueByDomain: {
        cleaning: cleaning.overdue.length,
        habits: 0,
        selfCare: selfCare.overdue.length,
        shopping: overdueShopping.length,
        tasks: overdueItems.length,
      },
    })

    const result: WeekContext = {
      from,
      generatedAt: new Date().toISOString(),
      highlights: {},
      progress: {},
      remaining: {},
      sourceCoverage: {},
      summary: {},
      timezone,
      to,
    }

    if (include.includes('tasks')) {
      result.highlights = {
        completed: prepareItems(completedTaskItems, to),
        overdue: prepareItems(overdueItems, to),
        repeatedRoutineGroups: prepareItems(repeatedRoutineGroups, to),
        repeatedOrStuck: prepareItems(repeatedOrStuck, to),
        upcomingImportant: prepareItems(
          taskItems.filter((item) => item.priority === 'high'),
          to,
        ),
      }
      result.progress.tasksCompleted = {
        count: taskLoad.completions.totalCount,
        items: prepareItems(completedTaskItems, to),
      }
      result.remaining.tasksActive = prepareItems(taskItems, to)
      result.remaining.tasksFlexible = prepareItems(
        flexibleTasks.map((task) => mapTaskItem(task, overdueAsOfDate)),
        to,
      )
    }
    if (include.includes('calendar')) {
      result.calendar = {
        events: prepareItems(calendarEvents, to),
        totalCount: calendarLoad.coverage.totalCount,
      }
    }
    if (needsStats || include.includes('calendar'))
      result.sourceCoverage.calendar = calendarLoad.coverage
    if (include.includes('shopping')) {
      result.progress.shoppingCompleted = {
        count: completedShopping.length,
        items: prepareItems(completedShopping, to),
      }
      result.remaining.shoppingActive = prepareItems(activeShopping, to)
    }
    if (include.includes('cleaning')) {
      result.progress.cleaningCompleted = {
        count: cleaningCompleted.length,
        items: prepareItems(cleaningCompleted, to),
      }
      result.remaining.cleaningOverdue = prepareItems(cleaning.overdue, to)
      result.remaining.cleaningOverdueByZone = groupCleaningOverdueByZone(
        cleaning.overdue,
      )
    }
    if (include.includes('selfcare')) {
      result.progress.selfCareCompleted = {
        count: selfCare.completed.length,
        items: prepareItems(selfCare.completed, to),
      }
      result.progress.selfCareFlexibleGoals = buildFlexibleGoalSummary(
        selfCare.flexibleGoals,
      )
      result.remaining.selfCareFlexibleGoals = buildFlexibleGoalSummary(
        selfCare.flexibleGoals,
      )
      result.remaining.selfCareRemaining = prepareItems(selfCare.remaining, to)
      result.summary.selfCareFlexibleGoals = buildFlexibleGoalSummary(
        selfCare.flexibleGoals,
      )
    }
    if (needsStats || include.includes('tasks')) {
      Object.assign(result.summary, {
        completedTasks: taskLoad.completions.totalCount,
        overdueTasks: overdueItems.length,
        plannedTasks: activeTaskGroups.length,
        taskGroupsActive: activeTaskGroups.length,
        taskOccurrencesActive: weekTasks.length,
        tasksActive: activeTaskGroups.length,
        tasksFlexible: flexibleTasks.length,
      })
      result.sourceCoverage.tasks = taskLoad.coverage
      result.sourceCoverage.taskCompletions = {
        ...taskLoad.completions,
        nextCursor: include.includes('tasks')
          ? taskLoad.completions.nextCursor
          : null,
      }
    }
    if (needsStats || include.includes('shopping')) {
      Object.assign(result.summary, {
        shoppingActive: activeShopping.length,
        shoppingCompleted: completedShopping.length,
        shoppingItems: activeShopping.length,
        shoppingTotal: shopping.length,
        shoppingUrgentActive: activeShopping.filter((item) => item.urgent)
          .length,
      })
      result.sourceCoverage.shopping = shoppingLoad.coverage
    }
    if (needsStats || include.includes('cleaning')) {
      Object.assign(result.summary, {
        cleaningActive,
        cleaningOverdue: cleaning.overdue.length,
        cleaningOverdueCurrentBacklog: cleaning.overdue.length,
        cleaningScheduledThisPeriod: cleaning.tasks.length,
        cleaningTasks: cleaningActive,
      })
    }
    if (needsStats || include.includes('selfcare')) {
      Object.assign(result.summary, {
        selfCareCompleted: selfCare.completed.length,
        selfCareMissed: selfCare.missed.length,
        selfCareOverdue: selfCare.overdue.length,
        selfCareRemaining: selfCare.remaining.length,
        selfCareScheduled: selfCare.scheduled.length,
      })
    }
    if (needsStats) {
      result.bottlenecks = buildBottlenecks(stats.reasons, stats.overdueItems)
      result.possibleSimplifications = buildSimplifications(stats)
      result.summary.loadLevel = stats.loadLevel
    }

    return compactForAi(result, { todayDate: to, includeListCoverage: true })
  }

  async searchPlanner(
    params: SearchPlannerParams,
  ): Promise<PlannerSearchResult> {
    const query = params.query.trim()

    if (
      !query &&
      !(
        params.types?.length === 1 &&
        params.types[0] === 'tasks' &&
        params.status === 'done' &&
        params.from &&
        params.to
      )
    ) {
      throw new AiContextValidationError('query is required.')
    }

    const timezone = resolveTimezone(params.timezone)
    validateDateRange(params.from, params.to)
    const context = await this.resolvePersonalReadContext(
      params.userId,
      timezone,
    )
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 30)
    const types = params.types?.length
      ? params.types
      : [...PLANNER_SEARCH_TYPES]
    const from = params.from
    const to = params.to
    const searchAsOfDate = resolveOverdueAsOfDate(
      to ?? from ?? getTodayDate(timezone),
      timezone,
    )
    const normalizedQuery = query.toLowerCase()
    const results: PlannerSearchResult['items'] = []
    const sourceCoverage: AiContextSourceCoverage = {}
    const tasksOnly = types.length === 1 && types[0] === 'tasks'
    if (params.taskCursor && !tasksOnly) {
      throw new AiContextValidationError(
        'taskCursor requires types: ["tasks"].',
      )
    }
    let taskPagination: PlannerSearchResult['taskPagination']
    let additionalTaskMatches = 0
    let additionalCalendarMatches = 0

    if (types.includes('tasks')) {
      const page = await this.dependencies.taskService
        .searchTasksCursor(context, {
          asOfDate: searchAsOfDate,
          from,
          to,
          search: normalizedQuery,
          status: params.status ?? 'any',
          timezone,
          userId: params.userId,
          cursor: params.taskCursor,
          limit,
        })
        .catch((error: unknown) => {
          if (isHttpError(error) && error.code === 'invalid_task_cursor') {
            throw new AiContextValidationError(error.message)
          }
          throw error
        })
      sourceCoverage.tasks = {
        returnedCount: page.returnedCount,
        totalCount: page.totalCount,
        truncated: page.truncated,
      }
      additionalTaskMatches = page.totalCount - page.items.length
      results.push(
        ...page.items.map((task) => mapTaskItem(task, searchAsOfDate)),
      )
      if (tasksOnly)
        taskPagination = {
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          returnedCount: page.returnedCount,
          totalCount: page.totalCount,
        }
    }

    if (types.includes('calendar')) {
      const page = await this.dependencies.taskService.searchTasksCursor(
        context,
        {
          asOfDate: searchAsOfDate,
          calendarOnly: true,
          from,
          to,
          search: normalizedQuery,
          status: params.status ?? 'any',
          timezone,
          userId: params.userId,
          limit,
        },
      )
      sourceCoverage.calendar = {
        returnedCount: page.returnedCount,
        totalCount: page.totalCount,
        truncated: page.truncated,
      }
      additionalCalendarMatches = page.totalCount - page.items.length
      results.push(...page.items.map(mapTaskCalendarEvent))
    }

    if (types.includes('shopping')) {
      const shoppingLoad = await this.listShopping(context, params.userId)

      sourceCoverage.shopping = shoppingLoad.coverage
      results.push(
        ...markShoppingOverdue(shoppingLoad.items, searchAsOfDate)
          .filter((item) =>
            matchesDateRange(readShoppingDate(item, timezone), from, to),
          )
          .filter((item) => matchesSearch(item, normalizedQuery))
          .filter((item) => matchesSearchStatus(item.status, params.status)),
      )
    }

    if (types.includes('cleaning')) {
      const rangeFrom = params.from ?? getTodayDate(timezone)
      const rangeTo = params.to ?? rangeFrom
      const cleaning = await this.getCleaningRange(context, rangeFrom, rangeTo)

      results.push(
        ...dedupeCleaningItems([
          ...cleaning.tasks,
          ...cleaning.overdue,
          ...cleaning.completed,
        ])
          .filter((item) => matchesDateRange(item.date, from, to))
          .filter((item) => matchesSearch(item, normalizedQuery))
          .filter((item) => matchesSearchStatus(item.status, params.status)),
      )
    }

    if (types.includes('selfcare')) {
      const [rangeFrom, rangeTo] = resolveRange(from, to, timezone)
      const selfCare = await this.getSelfCareRange(
        context,
        rangeFrom,
        rangeTo,
        resolveOverdueAsOfDate(rangeTo, timezone),
      )

      const selfCareResults = [
        ...selfCare.completed,
        ...selfCare.overdue,
        ...selfCare.remaining,
      ]
        .filter((item) => matchesSearch(item, normalizedQuery))
        .filter((item) => matchesSearchStatus(item.status, params.status))

      results.push(...dedupeItems(selfCareResults))
    }

    const compacted = compactArrayForAi(results, {
      maxArrayItems: limit,
      mode: 'search',
      todayDate: to ?? from ?? getTodayDate(timezone),
    })
    for (const source of ['tasks', 'calendar'] as const) {
      const coverage = sourceCoverage[source]
      if (!coverage) continue
      coverage.returnedCount = compacted.items.filter(
        (item) => item.source === source,
      ).length
      coverage.truncated = coverage.returnedCount < coverage.totalCount
    }

    return {
      ...(taskPagination ? { taskPagination } : {}),
      items: compacted.items,
      query,
      returnedCount: compacted.returnedCount,
      sourceCoverage,
      totalCount:
        compacted.totalCount +
        additionalTaskMatches +
        additionalCalendarMatches,
    }
  }

  async getOverloadContext(
    params: GetOverloadContextParams,
  ): Promise<OverloadContext> {
    const timezone = resolveTimezone(params.timezone)
    const [from, to] = resolveRange(params.from, params.to, timezone)
    const context = await this.resolvePersonalReadContext(
      params.userId,
      timezone,
    )
    const taskLoad = await this.listTasks(context, params.userId, from, to)
    const tasks = taskLoad.items
    const activeTasks = tasks.filter(isActiveTask)
    const rangeTasks = activeTasks.filter((task) =>
      isTaskInRange(task, from, to, timezone),
    )
    const flexibleTasks = activeTasks.filter(isFlexibleTask)
    const activeTaskGroups = groupTaskOccurrences(rangeTasks)
    const overdueAsOfDate = resolveOverdueAsOfDate(to, timezone)
    const overdueTasks = activeTasks.filter((task) =>
      isTaskOverdue(task, overdueAsOfDate),
    )
    const shoppingLoad = await this.listShopping(context, params.userId)
    const shopping = markShoppingOverdue(shoppingLoad.items, overdueAsOfDate)
    const activeShopping = shopping.filter(isActiveShoppingItem)
    const completedShopping = shopping.filter(isCompletedShoppingItem)
    const overdueShopping = activeShopping.filter(
      (item) => item.status === 'overdue',
    )
    const cleaning = await this.getCleaningRange(context, from, to)
    const cleaningActive = countActiveCleaningTasks(cleaning)
    const selfCare = await this.getSelfCareRange(
      context,
      from,
      to,
      overdueAsOfDate,
    )
    const calendarLoad = await this.listCalendar(
      context,
      params.userId,
      from,
      to,
    )
    const tasksHighPriorityActive = rangeTasks.filter(isHighPriorityTask).length
    const completedHighPriorityTasks = (
      await this.dependencies.taskService.searchTasksCursor(context, {
        asOfDate: overdueAsOfDate,
        from,
        to,
        highPriorityOnly: true,
        status: 'done',
        timezone,
        userId: params.userId,
        limit: 1,
      })
    ).totalCount
    const overdueByDomain = {
      cleaning: cleaning.overdue.length,
      habits: 0,
      selfCare: selfCare.overdue.length,
      shopping: overdueShopping.length,
      tasks: overdueTasks.length,
    }
    const stats = buildStats({
      activeCounts: {
        calendar: calendarLoad.coverage.totalCount,
        cleaning: cleaningActive,
        habits: 0,
        selfCare: selfCare.remaining.length,
        shopping: activeShopping.length,
        tasks: activeTaskGroups.length,
      },
      overdueByDomain,
    })
    const loadScore = calculateLoadScore(stats)
    const structuredReasons = buildStructuredLoadReasons({
      calendarEvents: calendarLoad.coverage.totalCount,
      cleaningOverdue: cleaning.overdue.length,
      habitsMissed: 0,
      selfcareMissed: selfCare.missed.length,
      selfcareOverdue: selfCare.overdue.length,
      shoppingActive: activeShopping.length,
      tasksActive: activeTaskGroups.length,
      tasksHighPriorityActive,
    })
    const overdueItemsByDomain = buildOverdueItemsByDomain({
      cleaning: cleaning.overdue,
      habits: [],
      selfCare: selfCare.overdue,
      shopping: overdueShopping,
      tasks: overdueTasks.map((task) => mapTaskItem(task, overdueAsOfDate)),
      todayDate: to,
    })

    return compactForAi(
      {
        bottlenecks: buildOverloadBottlenecks({
          cleaningCount: cleaningActive,
          overdueCount: sumDomainCounts(overdueByDomain),
          selfCareMissed: selfCare.missed.length,
          selfCareOverdue: selfCare.overdue.length,
          shoppingCount: activeShopping.length,
          tasksHighPriority: tasksHighPriorityActive,
        }),
        counts: {
          activeItemsTotal: stats.activeCounts.total,
          calendarEvents: calendarLoad.coverage.totalCount,
          calendarEventsActive: calendarLoad.coverage.totalCount,
          cleaningActive,
          cleaningOverdue: cleaning.overdue.length,
          cleaningTasks: cleaningActive,
          habitsMissed: 0,
          overdueItemsTotal: stats.overdueByDomain.total,
          selfCareRemaining: selfCare.remaining.length,
          selfCareMissed: selfCare.missed.length,
          selfCareOverdue: selfCare.overdue.length,
          shoppingActive: activeShopping.length,
          shoppingCompleted: completedShopping.length,
          shoppingItems: activeShopping.length,
          shoppingOverdue: overdueShopping.length,
          tasksActive: activeTaskGroups.length,
          tasksHighPriority: tasksHighPriorityActive,
          tasksHighPriorityActive,
          tasksOverdue: overdueTasks.length,
          tasksTotal: activeTaskGroups.length,
        },
        flexibleTasks: {
          count: flexibleTasks.length,
          items: prepareItems(
            flexibleTasks.map((task) => mapTaskItem(task, overdueAsOfDate)),
            to,
          ),
        },
        from,
        generatedAt: new Date().toISOString(),
        load: {
          activeCounts: {
            calendarEvents: calendarLoad.coverage.totalCount,
            cleaningOverdue: cleaning.overdue.length,
            selfcareMissed: selfCare.missed.length,
            selfcareOverdue: selfCare.overdue.length,
            shoppingActive: activeShopping.length,
            tasksActive: activeTaskGroups.length,
            tasksHighPriorityActive,
          },
          activeScore: loadScore,
          ignoredCounts: {
            completedHighPriorityTasks,
            completedSelfcare: selfCare.completed.length,
            completedShopping: completedShopping.length,
            completedTasks: taskLoad.completions.totalCount,
            flexibleTasks: flexibleTasks.length,
          },
          level: stats.loadLevel,
          reasons: stats.reasons,
          score: loadScore,
          structuredReasons,
        },
        cleaningOverdueByZone: groupCleaningOverdueByZone(cleaning.overdue),
        overdue: buildOverdueSummary(overdueByDomain),
        overdueItemsByDomain,
        sourceCoverage: {
          calendar: calendarLoad.coverage,
          shopping: shoppingLoad.coverage,
          tasks: taskLoad.coverage,
          taskCompletions: taskLoad.completions,
        },
        suggestedFocus: buildSuggestedFocus(stats),
        timezone,
        to,
      } satisfies OverloadContext,
      { todayDate: to, includeListCoverage: true },
    )
  }

  async getSelfCareContext(
    params: GetSelfCareContextParams,
  ): Promise<SelfCareContext> {
    const timezone = resolveTimezone(params.timezone)
    const [from, to] = resolveRange(params.from, params.to, timezone)
    const context = await this.resolvePersonalReadContext(
      params.userId,
      timezone,
    )
    const selfCare = await this.getSelfCareRange(
      context,
      from,
      to,
      resolveOverdueAsOfDate(to, timezone),
    )
    const weakSpots = buildSelfCareWeakSpots(selfCare.missed)
    const potentialDuplicates = buildSelfCarePotentialDuplicates(
      selfCare.remaining,
    )

    return compactForAi(
      {
        completed: prepareItems(selfCare.completed),
        flexibleGoals: prepareItems(selfCare.flexibleGoals),
        from,
        generatedAt: new Date().toISOString(),
        missed: prepareItems(selfCare.missed),
        overdue: prepareItems(selfCare.overdue),
        planned: prepareItems(selfCare.planned),
        potentialDuplicates: prepareItems(potentialDuplicates),
        remaining: prepareItems(selfCare.remaining),
        scheduled: prepareItems(selfCare.scheduled),
        summary: {
          completedCount: selfCare.completed.length,
          flexibleGoals: buildFlexibleGoalSummary(selfCare.flexibleGoals),
          missedCount: selfCare.missed.length,
          overdueCount: selfCare.overdue.length,
          potentialDuplicateCount: potentialDuplicates.length,
          plannedCount: selfCare.planned.length,
          remainingCount: selfCare.remaining.length,
          scheduledCount: selfCare.scheduled.length,
          selfCareFlexibleGoals: buildFlexibleGoalSummary(
            selfCare.flexibleGoals,
          ),
          suggestedGentleFocus: weakSpots[0] ?? null,
          weakSpots,
        },
        timezone,
        to,
      } satisfies SelfCareContext,
      { todayDate: to, includeListCoverage: true },
    )
  }

  private async loadDayContext(
    context: AiServiceReadContext,
    userId: string,
    date: string,
    include: readonly TodayContextInclude[],
  ): Promise<LoadedContext> {
    const needsStats = include.includes('stats')
    const emptyCoverage = { returnedCount: 0, totalCount: 0, truncated: false }
    const [taskLoad, shoppingLoad, cleaning, selfCare, calendarLoad] =
      await Promise.all([
        needsStats || include.includes('tasks')
          ? this.listTasks(
              context,
              userId,
              date,
              date,
              needsStats || include.includes('tasks'),
            )
          : Promise.resolve({
              items: [],
              coverage: emptyCoverage,
              completions: { ...emptyCoverage, nextCursor: null },
            }),
        needsStats || include.includes('shopping')
          ? this.listShopping(context, userId)
          : Promise.resolve({ items: [], coverage: emptyCoverage }),
        needsStats || include.includes('cleaning')
          ? this.getCleaningToday(context, date)
          : Promise.resolve({
              completed: [],
              overdue: [],
              tasks: [],
              todayZone: null,
            }),
        needsStats || include.includes('selfcare')
          ? this.getSelfCareDay(context, date)
          : Promise.resolve({
              completed: [],
              flexibleGoals: [],
              missed: [],
              overdue: [],
              planned: [],
              remaining: [],
              scheduled: [],
              suggestedFocus: null,
            }),
        needsStats || include.includes('calendar')
          ? this.listCalendar(context, userId, date, date)
          : Promise.resolve({ items: [], coverage: emptyCoverage }),
      ])
    const tasks = taskLoad.items
    const shopping = shoppingLoad.items
    const activeTasks = tasks.filter(isActiveTask)
    const todayTasks = activeTasks.filter((task) => isTaskForDate(task, date))
    const flexibleTasks = activeTasks.filter(isFlexibleTask)
    const completedTodayTasks = tasks.filter(
      (task) =>
        isTaskCompleted(task) &&
        readTaskCompletionDate(
          task,
          context.clientTimeZone ?? DEFAULT_TIMEZONE,
        ) === date,
    )
    const overdueTasks = activeTasks.filter((task) => isTaskOverdue(task, date))
    const currentTasks = dedupeTaskItems([
      ...todayTasks,
      ...overdueTasks,
      ...flexibleTasks,
    ])

    return {
      calendar: calendarLoad.items,
      cleaning,
      habits: {
        completed: [],
        missed: [],
        planned: [],
      },
      selfCare,
      shopping,
      sourceCoverage: {
        calendar: calendarLoad.coverage,
        shopping: shoppingLoad.coverage,
        tasks: taskLoad.coverage,
        taskCompletions: taskLoad.completions,
      },
      tasks: {
        all: currentTasks.map((task) => mapTaskItem(task, date)),
        completedToday: completedTodayTasks.map((task) =>
          mapTaskItem(task, date),
        ),
        completedTodayCount: taskLoad.completions.totalCount,
        flexible: flexibleTasks.map((task) => mapTaskItem(task, date)),
        important: todayTasks
          .filter(isHighPriorityTask)
          .map((task) => mapTaskItem(task, date)),
        lowEnergy: todayTasks
          .filter(isLowEnergyTask)
          .map((task) => mapTaskItem(task, date)),
        overdue: overdueTasks.map((task) => mapTaskItem(task, date)),
        today: todayTasks.map((task) => mapTaskItem(task, date)),
      },
    }
  }

  private async resolvePersonalReadContext(
    userId: string,
    timezone: string,
  ): Promise<AiServiceReadContext> {
    const bootstrapAuth = createSyntheticAuthContext(userId)
    const baseSession = await this.dependencies.sessionService.resolveSession({
      actorUserId: undefined,
      auth: bootstrapAuth,
      workspaceId: undefined,
    })
    const auth = createSyntheticAuthContext(userId, baseSession.actor.email)
    const personalWorkspace =
      baseSession.workspaces.find(
        (workspace) => workspace.kind === 'personal',
      ) ??
      (baseSession.workspace.kind === 'personal'
        ? {
            id: baseSession.workspaceId,
            kind: baseSession.workspace.kind,
            name: baseSession.workspace.name,
          }
        : null)

    if (!personalWorkspace) {
      throw new AiContextValidationError(
        'Personal workspace was not found for this user.',
      )
    }

    const session =
      personalWorkspace.id === baseSession.workspaceId
        ? baseSession
        : await this.dependencies.sessionService.resolveSession({
            actorUserId: undefined,
            auth,
            workspaceId: personalWorkspace.id,
          })

    return {
      actorUserId: userId,
      auth,
      clientTimeZone: timezone,
      groupRole: session.groupRole,
      role: session.role,
      workspaceKind: session.workspace.kind,
      workspaceId: session.workspaceId,
      workspaceName: session.workspace.name,
    }
  }

  private async listCalendar(
    context: AiServiceReadContext,
    userId: string,
    from: string,
    to: string,
  ): Promise<{ items: AiCalendarEvent[]; coverage: AiSourceCoverage }> {
    const timezone = context.clientTimeZone ?? DEFAULT_TIMEZONE
    const result = await this.dependencies.taskService.searchTasksCursor(
      context,
      {
        asOfDate: resolveOverdueAsOfDate(to, timezone),
        calendarOnly: true,
        from,
        to,
        search: '',
        status: 'active',
        timezone,
        userId,
        limit: 50,
      },
    )
    return {
      items: result.items.map(mapTaskCalendarEvent),
      coverage: {
        returnedCount: result.returnedCount,
        totalCount: result.totalCount,
        truncated: result.truncated,
      },
    }
  }

  private async listTasks(
    context: AiServiceReadContext,
    userId: string,
    from?: string,
    to?: string,
    includeCompletions = true,
  ): Promise<{
    coverage: AiSourceCoverage
    completions: AiSourceCoverage & { nextCursor: string | null }
    items: Array<Task & { userId?: string; workspaceId?: string }>
  }> {
    const fallbackDate = getTodayDate(
      context.clientTimeZone ?? DEFAULT_TIMEZONE,
    )
    const dateFrom = from ?? to ?? fallbackDate
    const dateTo = to ?? from ?? fallbackDate
    const [result, completed] = await Promise.all([
      this.dependencies.taskService.getTaskReadModel(context, {
        activeLimit: AI_SOURCE_MAX_ITEMS,
        dateFrom,
        dateTo,
        historyLimit: 250,
        rangeLimit: AI_SOURCE_MAX_ITEMS,
      }),
      includeCompletions
        ? this.dependencies.taskService.searchTasksCursor(context, {
            from: dateFrom,
            to: dateTo,
            asOfDate: resolveOverdueAsOfDate(
              dateTo,
              context.clientTimeZone ?? DEFAULT_TIMEZONE,
            ),
            timezone: context.clientTimeZone ?? DEFAULT_TIMEZONE,
            status: 'done',
            search: '',
            userId,
            limit: 50,
          })
        : Promise.resolve({
            items: [],
            returnedCount: 0,
            totalCount: 0,
            truncated: false,
            nextCursor: null,
          }),
    ])
    const items = dedupeTaskItems([
      ...result.items.filter((task) => !isTaskCompleted(task)),
      ...completed.items,
    ]).filter((task) => belongsToUser(task, userId))

    return {
      coverage: {
        returnedCount: items.length,
        totalCount: result.totalCount,
        truncated: result.truncated || items.length < result.returnedCount,
      },
      completions: {
        returnedCount: completed.returnedCount,
        totalCount: completed.totalCount,
        truncated: completed.truncated,
        nextCursor: completed.nextCursor,
      },
      items,
    }
  }

  private async listShopping(
    context: AiServiceReadContext,
    userId: string,
  ): Promise<{ coverage: AiSourceCoverage; items: AiShoppingItem[] }> {
    if (!this.dependencies.chaosInboxService) {
      return {
        coverage: { returnedCount: 0, totalCount: 0, truncated: false },
        items: [],
      }
    }

    const sourceItems = new Map<string, ChaosInboxItemRecord>()
    let page = 1
    let totalCount = 0

    while (sourceItems.size < AI_SOURCE_MAX_ITEMS) {
      const result = await this.dependencies.chaosInboxService.listItems(
        context,
        {
          kind: 'shopping',
          limit: AI_SOURCE_PAGE_SIZE,
          page,
        },
      )
      const sizeBeforePage = sourceItems.size

      totalCount = Math.max(totalCount, result.total)

      for (const item of result.items) {
        sourceItems.set(item.id, item)
      }

      if (
        result.items.length < AI_SOURCE_PAGE_SIZE ||
        sourceItems.size >= totalCount ||
        sourceItems.size === sizeBeforePage
      ) {
        break
      }

      page += 1
    }

    const userItems = [...sourceItems.values()]
      .filter((item) => item.kind === 'shopping')
      .filter((item) => item.userId === userId)
    const items = userItems.map((item) => ({
      activatedAt: item.activatedAt,
      addedAt: item.createdAt,
      category: item.shoppingCategory,
      completedAt: item.completedAt,
      dueDate: item.dueDate,
      source: 'shopping' as const,
      status:
        item.status === 'archived' || item.status === 'converted'
          ? 'done'
          : 'todo',
      title: item.text,
      urgent: item.priority === 'high' || item.isFavorite,
    }))

    return {
      coverage: {
        returnedCount: items.length,
        totalCount,
        truncated:
          sourceItems.size < totalCount || userItems.length < sourceItems.size,
      },
      items,
    }
  }

  private async getCleaningToday(
    context: AiServiceReadContext,
    date: string,
  ): Promise<LoadedContext['cleaning']> {
    if (!this.dependencies.cleaningService) {
      return { completed: [], overdue: [], tasks: [], todayZone: null }
    }

    const snapshot = await this.loadCleaningSnapshot(context)
    const result = snapshot
      ? buildCleaningTodayResponse({ ...snapshot, date })
      : await this.dependencies.cleaningService.getToday(context, date)

    return mapCleaningContext(result, snapshot, date, date)
  }

  private async getCleaningRange(
    context: AiServiceReadContext,
    from: string,
    to: string,
  ): Promise<LoadedContext['cleaning']> {
    if (!this.dependencies.cleaningService) {
      return { completed: [], overdue: [], tasks: [], todayZone: null }
    }

    const dates = enumerateDateRange(from, to)
    const snapshot = await this.loadCleaningSnapshot(context)
    const results = snapshot
      ? dates.map((date) =>
          mapCleaningContext(
            buildCleaningTodayResponse({ ...snapshot, date }),
            snapshot,
            date,
            date,
          ),
        )
      : await Promise.all(
          dates.map((date) => this.getCleaningToday(context, date)),
        )

    return {
      completed: snapshot
        ? mapCompletedCleaningTasks(snapshot, from, to)
        : dedupeCleaningItems(results.flatMap((result) => result.completed)),
      overdue: dedupeCleaningItems(results.flatMap((result) => result.overdue)),
      tasks: dedupeCleaningItems(results.flatMap((result) => result.tasks)),
      todayZone: results[0]?.todayZone ?? null,
    }
  }

  private loadCleaningSnapshot(
    context: AiServiceReadContext,
  ): Promise<CleaningListResponse | null> {
    return (
      this.dependencies.cleaningService?.listCleaning?.(context) ??
      Promise.resolve(null)
    )
  }

  private async getSelfCareDay(
    context: AiServiceReadContext,
    date: string,
  ): Promise<LoadedContext['selfCare']> {
    if (!this.dependencies.selfCareService) {
      return {
        completed: [],
        flexibleGoals: [],
        missed: [],
        overdue: [],
        planned: [],
        remaining: [],
        scheduled: [],
        suggestedFocus: null,
      }
    }

    const [dashboard, history] = await Promise.all([
      this.dependencies.selfCareService.getDashboard(context, date),
      this.dependencies.selfCareService.getHistory(context, date, date),
    ])
    const todayItems = dashboard.todayItems.filter(
      isRegularSelfCareTodayItemVisibleForAi,
    )
    const overdueItems = dashboard.overdueItems.filter(
      isRegularSelfCareTodayItemVisibleForAi,
    )
    const flexibleGoals = mapFlexibleGoalContexts(dashboard.flexibleGoals, date)
    const planned = normalizeSelfCareItemsForAi(
      todayItems
        .filter(isSelfCareTodayItemActivelyPlanned)
        .map((item) => mapSelfCareTodayItem(item, 'planned')),
    )
    const completed = mapCompletedSelfCareHistory(
      history,
      context.clientTimeZone ?? DEFAULT_TIMEZONE,
    )
    const missed = normalizeSelfCareItemsForAi(
      [...todayItems, ...overdueItems]
        .filter(isSelfCareTodayItemMissed)
        .map((item) => mapSelfCareTodayItem(item, 'missed')),
    )
    const overdue = normalizeSelfCareItemsForAi(
      overdueItems
        .filter((item) => isSelfCareTodayItemOverdue(item, date))
        .map((item) => mapSelfCareTodayItem(item, 'overdue')),
    )
    const remaining = normalizeSelfCareItemsForAi(
      todayItems
        .filter((item) => isSelfCareTodayItemRemaining(item, date))
        .map((item) => mapSelfCareTodayItem(item, 'planned')),
    )
    const suggestedFocusItem = [
      ...dashboard.upcomingImportant,
      ...dashboard.planningHints,
    ].find(isSelfCareTodayItemVisibleForAi)

    return {
      completed,
      flexibleGoals,
      missed,
      overdue,
      planned,
      remaining,
      scheduled: planned,
      suggestedFocus: suggestedFocusItem?.item.title ?? null,
    }
  }

  private async getSelfCareRange(
    context: AiServiceReadContext,
    from: string,
    to: string,
    overdueAsOfDate: string,
  ): Promise<Omit<LoadedContext['selfCare'], 'suggestedFocus'>> {
    if (!this.dependencies.selfCareService) {
      return {
        completed: [],
        flexibleGoals: [],
        missed: [],
        overdue: [],
        planned: [],
        remaining: [],
        scheduled: [],
      }
    }

    const [plan, history] = await Promise.all([
      this.dependencies.selfCareService.getPlan(context, from, to),
      this.dependencies.selfCareService.getHistory(context, from, to),
    ])
    const analytics = this.dependencies.selfCareService.getAnalytics
      ? await this.dependencies.selfCareService.getAnalytics(context, from, to)
      : null
    const flexibleGoals = mapFlexibleGoalContexts(
      analytics?.flexibleGoals ?? [],
      to,
    )
    const planned = filterSelfCareItemsForAi(
      plan.occurrences
        .filter(isSelfCareTodayItemActivelyPlanned)
        .map((item) => mapSelfCareTodayItem(item, 'planned')),
    )
    const missed = filterSelfCareItemsForAi(
      plan.occurrences
        .filter(isSelfCareTodayItemMissed)
        .map((item) => mapSelfCareTodayItem(item, 'missed')),
    )
    const overdue = filterSelfCareItemsForAi(
      plan.occurrences
        .filter((item) => isSelfCareTodayItemOverdue(item, overdueAsOfDate))
        .map((item) => mapSelfCareTodayItem(item, 'overdue')),
    )
    const remaining = filterSelfCareItemsForAi(
      plan.occurrences
        .filter((item) => isSelfCareTodayItemRemaining(item, overdueAsOfDate))
        .map((item) => mapSelfCareTodayItem(item, 'planned')),
    )
    const completed = mapCompletedSelfCareHistory(
      history,
      context.clientTimeZone ?? DEFAULT_TIMEZONE,
    )

    return {
      completed,
      flexibleGoals,
      missed,
      overdue,
      planned,
      remaining,
      scheduled: planned,
    }
  }
}

export class AiContextValidationError extends Error {
  readonly code = 'VALIDATION_ERROR'

  constructor(message: string) {
    super(message)
    this.name = 'AiContextValidationError'
  }
}

function mapTaskItem(
  task: Task & { userId?: string },
  today: string,
): AiTaskItem {
  return {
    area: task.project || task.sphereId || null,
    completedAt: task.completedAt,
    dueDate: task.dueDate,
    plannedDate: task.plannedDate,
    importance: task.importance,
    isFlexible: isFlexibleTask(task),
    obligation: task.necessity,
    priority:
      task.importance === 'important' || task.urgency === 'urgent'
        ? 'high'
        : isLowEnergyTask(task)
          ? 'low'
          : 'normal',
    resource: task.resource,
    resourceImpact: readTaskResourceImpact(task.resource),
    resourceMagnitude:
      typeof task.resource === 'number' ? Math.abs(task.resource) : null,
    snippet: buildTaskSnippet(task),
    source: 'tasks',
    status: isTaskOverdue(task, today)
      ? 'overdue'
      : task.status === 'archived'
        ? 'cancelled'
        : task.status,
    tags: task.project ? [task.project] : [],
    title: task.title,
    urgency: task.urgency,
  }
}

function readTaskResourceImpact(
  resource: Task['resource'],
): NonNullable<AiTaskItem['resourceImpact']> {
  if (typeof resource !== 'number') {
    return 'unknown'
  }

  if (resource < 0) {
    return 'drain'
  }

  if (resource > 0) {
    return 'restore'
  }

  return 'neutral'
}

function mapTaskCalendarEvent(task: Task): AiCalendarEvent {
  return {
    end:
      task.plannedDate && task.plannedEndTime
        ? `${task.plannedDate}T${task.plannedEndTime}:00`
        : null,
    location: null,
    source: 'calendar',
    start:
      task.plannedDate && task.plannedStartTime
        ? `${task.plannedDate}T${task.plannedStartTime}:00`
        : (task.plannedDate ?? task.dueDate ?? task.createdAt),
    title: task.title,
  }
}

function mapCleaningTask(
  item: CleaningTodayResponse['items'][number],
): AiCleaningTask {
  return {
    date: item.state.nextDueAt,
    source: 'cleaning',
    status: item.isOverdue ? 'overdue' : item.isDue ? 'todo' : 'done',
    title: item.task.title,
    zone: item.zone?.title ?? null,
  }
}

function mapCleaningContext(
  result: CleaningTodayResponse,
  snapshot: CleaningListResponse | null,
  from: string,
  to: string,
): LoadedContext['cleaning'] {
  return {
    completed: snapshot ? mapCompletedCleaningTasks(snapshot, from, to) : [],
    overdue: result.accumulatedItems.map(mapCleaningTask),
    tasks: [...result.items, ...(result.generalItems ?? [])].map(
      mapCleaningTask,
    ),
    todayZone:
      result.zones.find((zone) => zone.dayOfWeek === result.dayOfWeek)?.title ??
      null,
  }
}

function mapCompletedCleaningTasks(
  snapshot: CleaningListResponse,
  from: string,
  to: string,
): AiCleaningTask[] {
  const taskById = new Map(snapshot.tasks.map((task) => [task.id, task]))
  const zoneById = new Map(snapshot.zones.map((zone) => [zone.id, zone]))

  return dedupeCleaningItems(
    snapshot.history.flatMap((historyItem): AiCleaningTask[] => {
      if (
        historyItem.action !== 'completed' ||
        !matchesDateRange(historyItem.date, from, to)
      ) {
        return []
      }

      const task = taskById.get(historyItem.taskId)

      if (!task) {
        return []
      }

      const zoneId = historyItem.zoneId ?? task.zoneId
      const zone = zoneId ? zoneById.get(zoneId) : undefined

      return [
        {
          completedAt: historyItem.createdAt,
          date: historyItem.date,
          source: 'cleaning',
          status: 'done',
          title: task.title,
          zone: zone?.title ?? null,
        },
      ]
    }),
  )
}

function mapCompletedSelfCareHistory(
  history: SelfCareHistoryResponse,
  timezone: string,
): AiSelfCareItem[] {
  const itemsById = new Map(history.items.map((item) => [item.id, item]))

  return filterSelfCareItemsForAi(
    history.completions
      .filter((completion) => completion.status === 'done')
      .map((completion) => {
        const item = itemsById.get(completion.itemId)

        return {
          category: item?.category ?? null,
          date: getDateKeyInTimeZone(completion.completedAt, timezone),
          plannedDate: completion.scheduledFor,
          source: 'selfcare' as const,
          status: 'done',
          title: item?.title ?? 'Self-care item',
          type: item?.type ?? null,
        }
      }),
  )
}

function mapSelfCareTodayItem(
  item: SelfCareTodayItem,
  status: AiSelfCareItem['status'],
): AiSelfCareItem {
  return {
    category: item.item.category,
    date:
      item.occurrence?.scheduledFor ?? item.completion?.scheduledFor ?? null,
    source: 'selfcare',
    status,
    title: item.item.title,
    type: item.item.type,
  }
}

function isSelfCareTodayItemVisibleForAi(item: SelfCareTodayItem): boolean {
  return (
    item.item.type !== 'habit' &&
    !item.item.migratedFromHabitId &&
    item.item.isActive &&
    !item.item.isArchived &&
    item.item.deletedAt === null
  )
}

function isRegularSelfCareTodayItemVisibleForAi(
  item: SelfCareTodayItem,
): boolean {
  return (
    isSelfCareTodayItemVisibleForAi(item) && item.item.type !== 'flexible_goal'
  )
}

function isAiSelfCareItemVisibleForAi(item: AiSelfCareItem): boolean {
  return item.type !== 'habit' && item.type !== 'flexible_goal'
}

function normalizeSelfCareItemsForAi(
  items: AiSelfCareItem[],
): AiSelfCareItem[] {
  return dedupeAiItems(filterSelfCareItemsForAi(items))
}

function filterSelfCareItemsForAi(items: AiSelfCareItem[]): AiSelfCareItem[] {
  return items.filter(isAiSelfCareItemVisibleForAi)
}

function mapFlexibleGoalContexts(
  entries: SelfCareTodayItem[],
  date: string,
): AiFlexibleGoalContext[] {
  const goals = entries
    .filter(isSelfCareTodayItemVisibleForAi)
    .filter((entry) => entry.item.type === 'flexible_goal')
    .map((entry) => mapFlexibleGoalContext(entry, date))
    .filter((item): item is AiFlexibleGoalContext => item !== null)

  return dedupeFlexibleGoalContexts(goals)
}

function mapFlexibleGoalContext(
  entry: SelfCareTodayItem,
  date: string,
): AiFlexibleGoalContext | null {
  const progress = entry.flexibleProgress

  if (!progress) {
    return null
  }

  const targetCount = progress.targetCount
  const doneCount = progress.completedCount
  const remainingCount = progress.remainingCount

  return {
    category: entry.item.category,
    date,
    doneCount,
    expectedRepeats: true,
    id: `flexible-goal:${entry.item.id}:${progress.periodStart}:${progress.periodEnd}`,
    remainingCount,
    source: 'selfcare',
    status:
      doneCount >= targetCount
        ? 'done'
        : doneCount > 0
          ? 'in_progress'
          : 'planned',
    targetCount,
    title: entry.item.title,
    type: 'flexible_goal',
    unit: readFlexibleGoalUnit(entry),
  }
}

function dedupeFlexibleGoalContexts(
  goals: AiFlexibleGoalContext[],
): AiFlexibleGoalContext[] {
  const byId = new Map<string, AiFlexibleGoalContext>()

  for (const goal of goals) {
    const existing = byId.get(goal.id)

    if (!existing || goal.doneCount > existing.doneCount) {
      byId.set(goal.id, goal)
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      readFlexibleGoalStatusScore(right.status) -
        readFlexibleGoalStatusScore(left.status) ||
      left.title.localeCompare(right.title),
  )
}

function buildFlexibleGoalSummary(
  goals: AiFlexibleGoalContext[],
): AiFlexibleGoalSummary {
  return {
    completedGoals: goals.filter((goal) => goal.status === 'done').length,
    inProgressGoals: goals.filter((goal) => goal.status === 'in_progress')
      .length,
    items: prepareItems(goals),
    totalGoals: goals.length,
  }
}

function readFlexibleGoalStatusScore(
  status: AiFlexibleGoalContext['status'],
): number {
  if (status === 'in_progress') {
    return 2
  }

  if (status === 'planned') {
    return 1
  }

  return 0
}

function readFlexibleGoalUnit(entry: SelfCareTodayItem): string | null {
  return (
    entry.lastMeasurement?.measurementUnit ?? entry.measurement?.unit ?? null
  )
}

function isSelfCareTodayItemCompleted(item: SelfCareTodayItem): boolean {
  return (
    item.completion?.status === 'done' ||
    item.occurrence?.status === 'done' ||
    Boolean(item.occurrence?.completedAt)
  )
}

function isSelfCareTodayItemOverdue(
  item: SelfCareTodayItem,
  asOfDate: string,
): boolean {
  if (isSelfCareTodayItemCompleted(item) || isSelfCareTodayItemMissed(item)) {
    return false
  }

  const status = item.occurrence?.status ?? item.completion?.status ?? null

  return Boolean(
    (status === 'scheduled' || status === 'partial') &&
    item.occurrence?.scheduledFor &&
    item.occurrence.scheduledFor < asOfDate,
  )
}

function isSelfCareTodayItemMissed(item: SelfCareTodayItem): boolean {
  const status = item.occurrence?.status ?? item.completion?.status ?? null

  return status === 'missed' || status === 'skipped'
}

function isSelfCareTodayItemActivelyPlanned(item: SelfCareTodayItem): boolean {
  if (isSelfCareTodayItemCompleted(item)) {
    return false
  }

  const status = item.occurrence?.status ?? item.completion?.status ?? null

  return (
    status !== 'cancelled' &&
    status !== 'missed' &&
    status !== 'moved' &&
    status !== 'skipped'
  )
}

function isSelfCareTodayItemRemaining(
  item: SelfCareTodayItem,
  asOfDate: string,
): boolean {
  if (!isSelfCareTodayItemActivelyPlanned(item)) {
    return false
  }

  return !isSelfCareTodayItemOverdue(item, asOfDate)
}

function buildTaskSnippet(task: Task): string | null {
  const parts = [
    task.note ? task.note : null,
    task.recurrence?.isActive ? 'recurring' : null,
    task.routine ? 'routine' : null,
  ].filter(Boolean)

  return parts.length ? parts.join(' ') : null
}

function isActiveTask(task: Task): boolean {
  return task.status !== 'done' && task.status !== 'archived'
}

function isTaskCompleted(task: Task): boolean {
  return task.status === 'done'
}

function isActiveShoppingItem(item: AiShoppingItem): boolean {
  return !isCompletedShoppingItem(item)
}

function isCompletedShoppingItem(item: AiShoppingItem): boolean {
  return item.status === 'done'
}

function readShoppingDate(
  item: AiShoppingItem,
  timezone: string,
): string | null {
  if (isCompletedShoppingItem(item)) {
    return item.completedAt
      ? getDateKeyInTimeZone(item.completedAt, timezone)
      : null
  }

  return item.dueDate ?? null
}

function markShoppingOverdue(
  items: AiShoppingItem[],
  asOfDate: string,
): AiShoppingItem[] {
  return items.map((item) =>
    isActiveShoppingItem(item) && item.dueDate && item.dueDate < asOfDate
      ? { ...item, status: 'overdue' }
      : item,
  )
}

function isActiveCleaningTask(item: AiCleaningTask): boolean {
  return item.status !== 'done'
}

function countActiveCleaningTasks(
  cleaning: Pick<LoadedContext['cleaning'], 'overdue' | 'tasks'>,
): number {
  return dedupeCleaningItems([
    ...cleaning.tasks.filter(isActiveCleaningTask),
    ...cleaning.overdue,
  ]).length
}

function isRoutineOrRecurringTask(task: Task): boolean {
  return Boolean(task.routine || task.recurrence?.isActive)
}

function groupTaskOccurrences(tasks: Task[]): AiTaskGroup[] {
  const groups = new Map<
    string,
    { dates: Set<string>; title: string; count: number }
  >()

  for (const task of tasks) {
    const key = readTaskGroupKey(task)
    const group = groups.get(key) ?? {
      count: 0,
      dates: new Set<string>(),
      title: task.title,
    }
    const date = readTaskDate(task)

    group.count += 1

    if (date) {
      group.dates.add(date)
    }

    groups.set(key, group)
  }

  return [...groups.values()]
    .map((group) => ({
      count: group.count,
      dates: [...group.dates].sort(),
      source: 'tasks' as const,
      title: group.title,
    }))
    .sort((left, right) => right.count - left.count)
}

function readTaskGroupKey(task: Task): string {
  if (task.routine?.seriesId) {
    return `routine:${task.routine.seriesId}`
  }

  if (task.recurrence?.seriesId) {
    return `recurrence:${task.recurrence.seriesId}`
  }

  return `task:${task.id}`
}

function mapTaskGroupToTaskItem(group: AiTaskGroup): AiTaskItem {
  return {
    area: null,
    dueDate: null,
    plannedDate: group.dates[0] ?? null,
    completedAt: null,
    importance: 'not_important',
    obligation: 'desired',
    priority: 'normal',
    resource: null,
    resourceImpact: 'unknown',
    resourceMagnitude: null,
    snippet: `${group.count} grouped occurrence${group.count === 1 ? '' : 's'}`,
    source: 'tasks',
    status: 'todo',
    tags: ['grouped-routine'],
    title: group.title,
    urgency: 'not_urgent',
  }
}

function dedupeTaskItems<T extends Task>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const item of items) {
    if (seen.has(item.id)) {
      continue
    }

    seen.add(item.id)
    result.push(item)
  }

  return result
}

function dedupeAiItems<
  T extends {
    date?: string | null
    source: string
    status?: string
    title: string
  },
>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const item of items) {
    const key = `${item.source}:${item.title}:${item.date ?? ''}:${
      item.status ?? ''
    }`

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(item)
  }

  return result
}

function buildSelfCarePotentialDuplicates(
  items: AiSelfCareItem[],
): AiSelfCareDuplicate[] {
  const groups = new Map<
    string,
    {
      dates: Set<string>
      statuses: Set<string>
      title: string
      type: string | null
      count: number
    }
  >()

  for (const item of items) {
    const key = `${normalizeTitle(item.title)}:${item.type ?? ''}:${
      item.date ?? ''
    }`
    const group = groups.get(key) ?? {
      count: 0,
      dates: new Set<string>(),
      statuses: new Set<string>(),
      title: item.title,
      type: item.type ?? null,
    }

    group.count += 1
    group.statuses.add(item.status)

    if (item.date) {
      group.dates.add(item.date)
    }

    groups.set(key, group)
  }

  return [...groups.values()]
    .filter((group) => group.count > 1)
    .map((group) => ({
      count: group.count,
      dates: [...group.dates].sort(),
      statuses: [...group.statuses].sort(),
      title: group.title,
      type: group.type,
    }))
    .sort((left, right) => right.count - left.count)
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ')
}

function sumDomainCounts(input: {
  cleaning: number
  habits: number
  selfCare: number
  shopping: number
  tasks: number
}): number {
  return (
    input.cleaning +
    input.habits +
    input.selfCare +
    input.shopping +
    input.tasks
  )
}

function buildOverdueSummary(input: {
  cleaning: number
  habits: number
  selfCare: number
  shopping: number
  tasks: number
}): AiOverdueSummary {
  return {
    cleaning: input.cleaning,
    habits: input.habits,
    selfcare: input.selfCare,
    shopping: input.shopping,
    tasks: input.tasks,
    total: sumDomainCounts(input),
  }
}

function buildOverdueItemsByDomain(input: {
  cleaning: AiCleaningTask[]
  habits: AiHabitItem[]
  selfCare: AiSelfCareItem[]
  shopping: AiShoppingItem[]
  tasks: AiTaskItem[]
  todayDate: string
}): AiOverdueItemsByDomain {
  return {
    cleaning: prepareItems(input.cleaning),
    habits: prepareItems(input.habits),
    selfcare: prepareItems(input.selfCare),
    shopping: prepareItems(input.shopping),
    tasks: prepareItems(input.tasks, input.todayDate),
  }
}

function groupCleaningOverdueByZone(
  items: AiCleaningTask[],
): AiCleaningOverdueZoneGroup[] {
  const groups = new Map<string, AiCleaningTask[]>()

  for (const item of items) {
    const zone = item.zone?.trim() || 'Без зоны'
    const groupItems = groups.get(zone) ?? []

    groupItems.push(item)
    groups.set(zone, groupItems)
  }

  return prepareItems(
    [...groups.entries()]
      .map(([zone, groupItems]) => ({
        count: groupItems.length,
        items: prepareItems(groupItems),
        zone,
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.zone.localeCompare(right.zone),
      ),
  )
}

function buildStats(input: {
  activeCounts: {
    calendar: number
    cleaning: number
    habits: number
    selfCare: number
    shopping: number
    tasks: number
  }
  overdueByDomain: {
    cleaning: number
    habits: number
    selfCare: number
    shopping: number
    tasks: number
  }
}): NonNullable<TodayContext['stats']> {
  const activeCounts = {
    ...input.activeCounts,
    total:
      input.activeCounts.cleaning +
      input.activeCounts.habits +
      input.activeCounts.selfCare +
      input.activeCounts.shopping +
      input.activeCounts.tasks,
  }
  const overdueByDomain = {
    ...input.overdueByDomain,
    total: sumDomainCounts(input.overdueByDomain),
  }
  const totalPlannedItems =
    activeCounts.tasks +
    activeCounts.shopping +
    activeCounts.cleaning +
    activeCounts.selfCare +
    activeCounts.habits
  const reasons: string[] = []

  if (activeCounts.tasks >= 8) {
    reasons.push('Many active tasks')
  }

  if (activeCounts.calendar >= 4) {
    reasons.push('Several timed calendar blocks')
  }

  if (overdueByDomain.total > 0) {
    reasons.push('Overdue items need attention')
  }

  if (overdueByDomain.selfCare > 0 || overdueByDomain.habits > 0) {
    reasons.push('Self-care or habits have overdue items')
  }

  const score =
    activeCounts.tasks * 2 +
    activeCounts.calendar * 3 +
    activeCounts.shopping +
    activeCounts.cleaning * 2 +
    activeCounts.selfCare +
    activeCounts.habits +
    overdueByDomain.total * 4
  const loadLevel: AiLoadLevel =
    score >= 40
      ? 'critical'
      : score >= 28
        ? 'high'
        : score >= 12
          ? 'normal'
          : 'low'
  const suggestedMode: AiSuggestedMode =
    loadLevel === 'critical'
      ? 'minimum'
      : loadLevel === 'high'
        ? 'light'
        : 'normal'

  return {
    activeCounts,
    loadLevel,
    overdueByDomain,
    overdueItems: overdueByDomain.total,
    reasons,
    suggestedMode,
    totalPlannedItems,
  }
}

function calculateLoadScore(stats: NonNullable<TodayContext['stats']>): number {
  if (!stats) {
    return 0
  }

  const base =
    (stats.totalPlannedItems + stats.activeCounts.calendar) * 2 +
    stats.overdueItems * 5 +
    stats.reasons.length * 3

  return Math.min(100, base)
}

function buildStructuredLoadReasons(input: {
  calendarEvents: number
  cleaningOverdue: number
  habitsMissed: number
  selfcareMissed: number
  selfcareOverdue: number
  shoppingActive: number
  tasksActive: number
  tasksHighPriorityActive: number
}): AiLoadReason[] {
  const reasons: AiLoadReason[] = []

  if (input.cleaningOverdue > 0) {
    reasons.push({
      code: 'cleaning_overdue_high',
      count: input.cleaningOverdue,
      domain: 'cleaning',
      severity:
        input.cleaningOverdue >= 20
          ? 'critical'
          : input.cleaningOverdue >= 5
            ? 'high'
            : 'medium',
    })
  }

  if (input.calendarEvents >= 4) {
    reasons.push({
      code: 'calendar_blocks_many',
      count: input.calendarEvents,
      domain: 'calendar',
      severity: input.calendarEvents >= 8 ? 'high' : 'medium',
    })
  }

  if (input.selfcareOverdue > 0) {
    reasons.push({
      code: 'selfcare_overdue',
      count: input.selfcareOverdue,
      domain: 'selfcare',
      severity: input.selfcareOverdue >= 3 ? 'high' : 'medium',
    })
  }

  if (input.selfcareMissed > 0) {
    reasons.push({
      code: 'selfcare_missed',
      count: input.selfcareMissed,
      domain: 'selfcare',
      severity: input.selfcareMissed >= 3 ? 'high' : 'medium',
    })
  }

  if (input.habitsMissed > 0) {
    reasons.push({
      code: 'habits_missed',
      count: input.habitsMissed,
      domain: 'habits',
      severity: input.habitsMissed >= 3 ? 'high' : 'medium',
    })
  }

  if (input.tasksHighPriorityActive > 0) {
    reasons.push({
      code: 'tasks_high_priority_active',
      count: input.tasksHighPriorityActive,
      domain: 'tasks',
      severity: input.tasksHighPriorityActive >= 3 ? 'high' : 'medium',
    })
  }

  if (input.tasksActive >= 5) {
    reasons.push({
      code: 'tasks_active_many',
      count: input.tasksActive,
      domain: 'tasks',
      severity: input.tasksActive >= 10 ? 'high' : 'medium',
    })
  }

  if (input.shoppingActive > 0) {
    reasons.push({
      code: 'shopping_active',
      count: input.shoppingActive,
      domain: 'shopping',
      severity: input.shoppingActive >= 5 ? 'medium' : 'low',
    })
  }

  return reasons
}

function buildBottlenecks(reasons: string[], overdueCount: number): string[] {
  return [
    ...reasons,
    ...(overdueCount > 0
      ? [`${overdueCount} overdue item${overdueCount === 1 ? '' : 's'}`]
      : []),
  ]
}

function buildSimplifications(
  stats: NonNullable<TodayContext['stats']>,
): string[] {
  if (stats.loadLevel === 'low') {
    return []
  }

  return [
    'Move non-urgent tasks out of the current period',
    'Keep only one high-priority focus block',
    ...(stats.overdueItems > 0
      ? ['Handle overdue items before adding new work']
      : []),
  ]
}

function buildOverloadBottlenecks(input: {
  cleaningCount: number
  overdueCount: number
  selfCareMissed: number
  selfCareOverdue: number
  shoppingCount: number
  tasksHighPriority: number
}): OverloadContext['bottlenecks'] {
  return [
    {
      reason: 'High-priority tasks increase planning pressure.',
      relatedItemsCount: input.tasksHighPriority,
      title: 'High-priority tasks',
    },
    {
      reason: 'Overdue items compete with current plans.',
      relatedItemsCount: input.overdueCount,
      title: 'Overdue backlog',
    },
    {
      reason: 'Household routines add fixed load.',
      relatedItemsCount: input.cleaningCount + input.shoppingCount,
      title: 'Household load',
    },
    {
      reason: 'Overdue self-care is an overload signal.',
      relatedItemsCount: input.selfCareOverdue,
      title: 'Self-care overdue',
    },
    {
      reason: 'Missed self-care is an overload signal.',
      relatedItemsCount: input.selfCareMissed,
      title: 'Self-care misses',
    },
  ].filter((item) => item.relatedItemsCount > 0)
}

function buildSuggestedFocus(
  stats: NonNullable<TodayContext['stats']>,
): string[] {
  if (stats.loadLevel === 'critical') {
    return ['Minimum viable day', 'Overdue essentials', 'Recovery time']
  }

  if (stats.loadLevel === 'high') {
    return ['Top priority tasks', 'Light household maintenance']
  }

  return ['Normal planning']
}

function buildSelfCareWeakSpots(missed: AiSelfCareItem[]): string[] {
  const grouped = new Map<string, number>()

  for (const item of missed) {
    const key = item.type ?? 'selfcare'
    grouped.set(key, (grouped.get(key) ?? 0) + 1)
  }

  return [...grouped.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => `${type}: ${count} missed`)
    .slice(0, 5)
}

function belongsToUser(
  task: Task & { userId?: string },
  userId: string,
): boolean {
  if (task.userId) {
    return task.userId === userId
  }

  if (task.assigneeUserId && task.assigneeUserId !== userId) {
    return false
  }

  if (task.authorUserId && task.authorUserId !== userId) {
    return false
  }

  return true
}

function isTaskForDate(task: Task, date: string): boolean {
  return task.plannedDate === date || task.dueDate === date
}

function isFlexibleTask(task: Task): boolean {
  return !task.plannedDate && !task.dueDate
}

function isTaskInRange(
  task: Task,
  from: string,
  to: string,
  timezone: string,
): boolean {
  if (isTaskCompleted(task)) {
    return matchesDateRange(readTaskCompletionDate(task, timezone), from, to)
  }

  return (
    matchesDateRange(task.plannedDate, from, to) ||
    matchesDateRange(task.dueDate, from, to)
  )
}

function readTaskDate(task: Task, timezone = DEFAULT_TIMEZONE): string | null {
  return isTaskCompleted(task)
    ? readTaskCompletionDate(task, timezone)
    : (task.plannedDate ?? task.dueDate)
}

function readTaskCompletionDate(task: Task, timezone: string): string | null {
  return task.completedAt
    ? getDateKeyInTimeZone(task.completedAt, timezone)
    : null
}

function isTaskOverdue(task: Task, today: string): boolean {
  if (task.status === 'done' || task.status === 'archived') {
    return false
  }

  const date = task.dueDate ?? task.plannedDate

  return Boolean(date && date < today)
}

function isHighPriorityTask(task: Task): boolean {
  return task.importance === 'important' || task.urgency === 'urgent'
}

function isLowEnergyTask(task: Task): boolean {
  return task.resource !== null && task.resource >= -1
}

function matchesSearch(item: unknown, query: string): boolean {
  return JSON.stringify(item).toLowerCase().includes(query)
}

function matchesSearchStatus(
  status: string,
  filter: SearchPlannerParams['status'],
): boolean {
  if (!filter || filter === 'any') {
    return true
  }

  if (filter === 'todo') {
    return (
      status === 'todo' ||
      status === 'planned' ||
      status === 'in_progress' ||
      status === 'ready_for_review'
    )
  }

  return status === filter
}

function matchesDateRange(
  date: string | null | undefined,
  from?: string,
  to?: string,
): boolean {
  if (!date) {
    return !from && !to
  }

  if (from && date < from) {
    return false
  }

  if (to && date > to) {
    return false
  }

  return true
}

function resolveRange(
  from: string | undefined,
  to: string | undefined,
  timezone: string,
): [string, string] {
  validateDateRange(from, to)
  if (from && to) {
    return [from, to]
  }

  const today = getTodayDate(timezone)

  if (from && !to) {
    return [from, addDateDays(from, 6)]
  }

  if (!from && to) {
    return [addDateDays(to, -6), to]
  }

  return getWeekRange(today)
}

function resolveOverdueAsOfDate(to: string, timezone: string): string {
  const today = getTodayDate(timezone)
  const periodEndExclusive = addDateDays(to, 1)

  return periodEndExclusive < today ? periodEndExclusive : today
}

function getWeekRange(date: string): [string, string] {
  const monday = getIsoWeekStartDate(date)
  const sunday = addDateDays(monday, 6)

  return [monday, sunday]
}

function resolveTimezone(timezone?: string): string {
  if (timezone !== undefined && !isValidTimeZone(timezone.trim())) {
    throw new AiContextValidationError(
      'timezone must be a valid IANA time zone.',
    )
  }
  const candidate =
    timezone?.trim() ||
    process.env.HAOTIKA_DEFAULT_TIMEZONE?.trim() ||
    DEFAULT_TIMEZONE

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(
      new Date(0),
    )

    return candidate
  } catch {
    return DEFAULT_TIMEZONE
  }
}

function validateDateRange(from?: string, to?: string): void {
  const message = getAiDateRangeError(from, to)
  if (message) throw new AiContextValidationError(message)
}

function prepareItems<T>(items: readonly T[], todayDate?: string): T[] {
  return sortImportantFirst(items, todayDate)
}

function dedupeItems<
  T extends { date?: string | null; source: string; title: string },
>(items: T[]): T[] {
  const seen = new Set<string>()
  const result: T[] = []

  for (const item of items) {
    const key = `${item.source}:${item.title}:${item.date ?? ''}`

    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

function dedupeCleaningItems(items: AiCleaningTask[]): AiCleaningTask[] {
  const seen = new Set<string>()
  const result: AiCleaningTask[] = []

  for (const item of items) {
    const key = `${item.title}:${item.zone ?? ''}:${item.date ?? ''}:${
      item.status
    }`

    if (!seen.has(key)) {
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

function createSyntheticAuthContext(
  userId: string,
  email?: string | null,
): AuthenticatedRequestContext {
  return {
    accessToken: 'mcp-context',
    claims: {
      payload: {
        ...(email ? { email } : {}),
        role: 'authenticated',
        sub: userId,
      },
      ...(email ? { email } : {}),
      role: 'authenticated',
      sub: userId,
    },
  }
}
