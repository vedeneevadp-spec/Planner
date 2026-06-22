import type {
  ChaosInboxItemRecord,
  ChaosInboxKind,
  ChaosInboxStatus,
  CleaningTodayResponse,
  SelfCareAnalyticsResponse,
  SelfCareHistoryResponse,
  SelfCarePlanResponse,
  SelfCareTodayItem,
  Task,
  TaskStatus,
  WorkspaceGroupRole,
  WorkspaceKind,
  WorkspaceRole,
} from '@planner/contracts'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import { compactArrayForAi, compactForAi } from './ai-context.compact.js'
import {
  PLANNER_SEARCH_TYPES,
  TODAY_CONTEXT_INCLUDE_KEYS,
} from './ai-context.permissions.js'
import type {
  AiCalendarEvent,
  AiCleaningOverdueZoneGroup,
  AiCleaningTask,
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
  AiSuggestedMode,
  AiTaskGroup,
  AiTaskItem,
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

const DEFAULT_TIMEZONE = 'Europe/Astrakhan'
const DAY_MS = 24 * 60 * 60 * 1000

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
  listTasks(
    context: AiServiceReadContext,
    filters?: { limit?: number; plannedDate?: string; status?: TaskStatus },
  ): Promise<Array<Task & { userId?: string; workspaceId?: string }>>
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
    planned: AiSelfCareItem[]
    remaining: AiSelfCareItem[]
    scheduled: AiSelfCareItem[]
    suggestedFocus: string | null
  }
  shopping: AiShoppingItem[]
  tasks: {
    all: AiTaskItem[]
    completedToday: AiTaskItem[]
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
    const date = params.date ?? getDateKey(new Date(), timezone)
    const include = params.include?.length
      ? params.include
      : [...TODAY_CONTEXT_INCLUDE_KEYS]
    const context = await this.resolvePersonalReadContext(
      params.userId,
      timezone,
    )
    const loaded = await this.loadDayContext(context, params.userId, date)
    const result: TodayContext = {
      date,
      generatedAt: new Date().toISOString(),
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
      selfCare: loaded.selfCare.missed.length,
      shopping: overdueShopping.length,
      tasks: loaded.tasks.overdue.length,
    }

    result.cleaningOverdueByZone = groupCleaningOverdueByZone(
      loaded.cleaning.overdue,
    )
    result.overdue = buildOverdueSummary(overdueByDomain)
    result.overdueItemsByDomain = buildOverdueItemsByDomain({
      cleaning: loaded.cleaning.overdue,
      habits: loaded.habits.missed,
      selfCare: loaded.selfCare.missed,
      shopping: overdueShopping,
      tasks: loaded.tasks.overdue,
    })
    result.selfCareFlexibleGoals = buildFlexibleGoalSummary(
      loaded.selfCare.flexibleGoals,
    )

    if (include.includes('tasks')) {
      result.tasks = {
        activeToday: limitItems(loaded.tasks.today),
        activeTodayCount: loaded.tasks.today.length,
        completedToday: limitItems(loaded.tasks.completedToday),
        completedTodayCount: loaded.tasks.completedToday.length,
        important: limitItems(loaded.tasks.important),
        importantActiveToday: limitItems(loaded.tasks.important),
        importantOverdue: limitItems(
          loaded.tasks.overdue.filter((item) => item.priority === 'high'),
        ),
        lowEnergy: limitItems(loaded.tasks.lowEnergy),
        overdue: limitItems(loaded.tasks.overdue),
        overdueCount: loaded.tasks.overdue.length,
        today: limitItems(loaded.tasks.today),
        totalCount: loaded.tasks.all.length,
      }
    }

    if (include.includes('calendar')) {
      result.calendar = {
        events: limitItems(loaded.calendar),
        totalCount: loaded.calendar.length,
      }
    }

    if (include.includes('shopping')) {
      const urgent = activeShopping.filter((item) => item.urgent)
      const normal = activeShopping.filter((item) => !item.urgent)

      result.shopping = {
        active: limitItems(activeShopping),
        activeCount: activeShopping.length,
        completed: limitItems(completedShopping),
        completedCount: completedShopping.length,
        normal: limitItems(normal),
        totalCount: shopping.length,
        urgent: limitItems(urgent),
        urgentActiveCount: urgent.length,
      }
    }

    if (include.includes('cleaning')) {
      result.cleaning = {
        overdue: limitItems(loaded.cleaning.overdue),
        tasks: limitItems(loaded.cleaning.tasks),
        todayZone: loaded.cleaning.todayZone,
      }
    }

    if (include.includes('selfcare')) {
      result.selfCare = {
        completed: limitItems(loaded.selfCare.completed),
        flexibleGoals: limitItems(loaded.selfCare.flexibleGoals),
        missed: limitItems(loaded.selfCare.missed),
        planned: limitItems(loaded.selfCare.planned),
        remaining: limitItems(loaded.selfCare.remaining),
        scheduled: limitItems(loaded.selfCare.scheduled),
        suggestedFocus: loaded.selfCare.suggestedFocus,
      }
    }

    if (include.includes('stats')) {
      result.stats = buildStats({
        activeCounts: {
          calendar: loaded.calendar.length,
          cleaning: countActiveCleaningTasks(loaded.cleaning),
          habits: 0,
          selfCare: loaded.selfCare.remaining.length,
          shopping: activeShopping.length,
          tasks: loaded.tasks.today.length + loaded.tasks.overdue.length,
        },
        overdueByDomain,
      })
    }

    return compactForAi(result)
  }

  async getWeekContext(params: GetWeekContextParams): Promise<WeekContext> {
    const timezone = resolveTimezone(params.timezone)
    const [from, to] = resolveRange(params.from, params.to, timezone)
    const context = await this.resolvePersonalReadContext(
      params.userId,
      timezone,
    )
    const tasks = await this.listTasks(context, params.userId)
    const activeTasks = tasks.filter(isActiveTask)
    const weekTasks = activeTasks.filter((task) =>
      isTaskInRange(task, from, to),
    )
    const completedRangeTasks = tasks
      .filter(isTaskCompleted)
      .filter((task) => isTaskInRange(task, from, to))
    const overdueTasks = activeTasks.filter((task) => isTaskOverdue(task, to))
    const shopping = markShoppingOverdue(
      await this.listShopping(context, params.userId),
      to,
    )
    const activeShopping = shopping.filter(isActiveShoppingItem)
    const completedShopping = shopping.filter(isCompletedShoppingItem)
    const overdueShopping = activeShopping.filter(
      (item) => item.status === 'overdue',
    )
    const cleaning = await this.getCleaningRange(context, from, to)
    const cleaningActive = countActiveCleaningTasks(cleaning)
    const cleaningCompleted = cleaning.tasks.filter(
      (item) => item.status === 'done',
    )
    const selfCare = await this.getSelfCareRange(context, from, to)
    const taskItems = weekTasks.map((task) => mapTaskItem(task, from))
    const completedTaskItems = completedRangeTasks.map((task) =>
      mapTaskItem(task, to),
    )
    const activeTaskGroups = groupTaskOccurrences(weekTasks)
    const overdueItems = overdueTasks.map((task) => mapTaskItem(task, to))
    const repeatedRoutineGroups = groupTaskOccurrences(
      weekTasks.filter(isRoutineOrRecurringTask),
    )
    const repeatedOrStuck = repeatedRoutineGroups.map(mapTaskGroupToTaskItem)
    const stats = buildStats({
      activeCounts: {
        calendar: weekTasks.filter((task) => task.plannedStartTime).length,
        cleaning: cleaningActive,
        habits: 0,
        selfCare: selfCare.remaining.length,
        shopping: activeShopping.length,
        tasks: activeTaskGroups.length,
      },
      overdueByDomain: {
        cleaning: cleaning.overdue.length,
        habits: 0,
        selfCare: selfCare.missed.length,
        shopping: overdueShopping.length,
        tasks: overdueItems.length,
      },
    })

    return compactForAi({
      bottlenecks: buildBottlenecks(stats.reasons, stats.overdueItems),
      from,
      generatedAt: new Date().toISOString(),
      highlights: {
        completed: limitItems(completedTaskItems),
        overdue: limitItems(overdueItems),
        repeatedRoutineGroups: limitItems(repeatedRoutineGroups),
        repeatedOrStuck: limitItems(repeatedOrStuck),
        upcomingImportant: limitItems(
          taskItems.filter((item) => item.priority === 'high'),
        ),
      },
      possibleSimplifications: buildSimplifications(stats),
      progress: {
        cleaningCompleted: {
          count: cleaningCompleted.length,
          items: limitItems(cleaningCompleted),
        },
        selfCareCompleted: {
          count: selfCare.completed.length,
          items: limitItems(selfCare.completed),
        },
        selfCareFlexibleGoals: buildFlexibleGoalSummary(selfCare.flexibleGoals),
        shoppingCompleted: {
          count: completedShopping.length,
          items: limitItems(completedShopping),
        },
        tasksCompleted: {
          count: completedRangeTasks.length,
          items: limitItems(completedTaskItems),
        },
      },
      remaining: {
        cleaningOverdue: limitItems(cleaning.overdue),
        cleaningOverdueByZone: groupCleaningOverdueByZone(cleaning.overdue),
        selfCareFlexibleGoals: buildFlexibleGoalSummary(selfCare.flexibleGoals),
        selfCareRemaining: limitItems(selfCare.remaining),
        shoppingActive: limitItems(activeShopping),
        tasksActive: limitItems(taskItems),
      },
      summary: {
        cleaningActive,
        cleaningOverdue: cleaning.overdue.length,
        cleaningOverdueCurrentBacklog: cleaning.overdue.length,
        cleaningScheduledThisPeriod: cleaning.tasks.length,
        cleaningTasks: cleaningActive,
        completedTasks: completedRangeTasks.length,
        loadLevel: stats.loadLevel,
        overdueTasks: overdueItems.length,
        plannedTasks: activeTaskGroups.length,
        selfCareCompleted: selfCare.completed.length,
        selfCareFlexibleGoals: buildFlexibleGoalSummary(selfCare.flexibleGoals),
        selfCareMissed: selfCare.missed.length,
        selfCareRemaining: selfCare.remaining.length,
        selfCareScheduled: selfCare.scheduled.length,
        shoppingActive: activeShopping.length,
        shoppingCompleted: completedShopping.length,
        shoppingItems: activeShopping.length,
        shoppingTotal: shopping.length,
        shoppingUrgentActive: activeShopping.filter((item) => item.urgent)
          .length,
        taskGroupsActive: activeTaskGroups.length,
        taskOccurrencesActive: weekTasks.length,
        tasksActive: activeTaskGroups.length,
      },
      timezone,
      to,
    } satisfies WeekContext)
  }

  async searchPlanner(
    params: SearchPlannerParams,
  ): Promise<PlannerSearchResult> {
    const query = params.query.trim()

    if (!query) {
      throw new AiContextValidationError('query is required.')
    }

    const timezone = resolveTimezone()
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
    const normalizedQuery = query.toLowerCase()
    const results: PlannerSearchResult['items'] = []

    if (types.includes('tasks') || types.includes('calendar')) {
      const tasks = await this.listTasks(context, params.userId)

      if (types.includes('tasks')) {
        results.push(
          ...tasks
            .filter((task) => matchesDateRange(readTaskDate(task), from, to))
            .map((task) =>
              mapTaskItem(task, to ?? from ?? getDateKey(new Date())),
            )
            .filter((item) => matchesSearch(item, normalizedQuery))
            .filter((item) => matchesSearchStatus(item.status, params.status)),
        )
      }

      if (types.includes('calendar')) {
        results.push(
          ...tasks
            .filter((task) => task.plannedDate && task.plannedStartTime)
            .filter((task) => matchesDateRange(task.plannedDate, from, to))
            .map(mapTaskCalendarEvent)
            .filter((item) => matchesSearch(item, normalizedQuery)),
        )
      }
    }

    if (types.includes('shopping')) {
      results.push(
        ...markShoppingOverdue(
          await this.listShopping(context, params.userId),
          to ?? from ?? getDateKey(new Date(), timezone),
        )
          .filter((item) => matchesSearch(item, normalizedQuery))
          .filter((item) => matchesSearchStatus(item.status, params.status)),
      )
    }

    if (types.includes('cleaning')) {
      const date = params.from ?? getDateKey(new Date())
      const cleaning = await this.getCleaningToday(context, date)

      results.push(
        ...[...cleaning.tasks, ...cleaning.overdue]
          .filter((item) => matchesDateRange(item.date, from, to))
          .filter((item) => matchesSearch(item, normalizedQuery))
          .filter((item) => matchesSearchStatus(item.status, params.status)),
      )
    }

    if (types.includes('selfcare')) {
      const [rangeFrom, rangeTo] = resolveRange(from, to, timezone)
      const selfCare = await this.getSelfCareRange(context, rangeFrom, rangeTo)

      results.push(
        ...dedupeAiItems([
          ...selfCare.scheduled,
          ...selfCare.remaining,
          ...selfCare.completed,
          ...selfCare.missed,
        ]).filter((item) => matchesSearch(item, normalizedQuery)),
      )
    }

    const compacted = compactArrayForAi(results, {
      maxArrayItems: limit,
      mode: 'search',
    })

    return {
      items: compacted.items,
      query,
      returnedCount: compacted.returnedCount,
      totalCount: compacted.totalCount,
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
    const tasks = await this.listTasks(context, params.userId)
    const activeTasks = tasks.filter(isActiveTask)
    const rangeTasks = activeTasks.filter((task) =>
      isTaskInRange(task, from, to),
    )
    const completedRangeTasks = tasks
      .filter(isTaskCompleted)
      .filter((task) => isTaskInRange(task, from, to))
    const activeTaskGroups = groupTaskOccurrences(rangeTasks)
    const overdueTasks = activeTasks.filter((task) => isTaskOverdue(task, to))
    const shopping = markShoppingOverdue(
      await this.listShopping(context, params.userId),
      to,
    )
    const activeShopping = shopping.filter(isActiveShoppingItem)
    const completedShopping = shopping.filter(isCompletedShoppingItem)
    const overdueShopping = activeShopping.filter(
      (item) => item.status === 'overdue',
    )
    const cleaning = await this.getCleaningRange(context, from, to)
    const cleaningActive = countActiveCleaningTasks(cleaning)
    const selfCare = await this.getSelfCareRange(context, from, to)
    const calendarEvents = rangeTasks.filter((task) => task.plannedStartTime)
    const tasksHighPriorityActive = rangeTasks.filter(isHighPriorityTask).length
    const completedHighPriorityTasks =
      completedRangeTasks.filter(isHighPriorityTask).length
    const overdueByDomain = {
      cleaning: cleaning.overdue.length,
      habits: 0,
      selfCare: selfCare.missed.length,
      shopping: overdueShopping.length,
      tasks: overdueTasks.length,
    }
    const stats = buildStats({
      activeCounts: {
        calendar: calendarEvents.length,
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
      calendarEvents: calendarEvents.length,
      cleaningOverdue: cleaning.overdue.length,
      habitsMissed: 0,
      selfcareMissed: selfCare.missed.length,
      shoppingActive: activeShopping.length,
      tasksActive: activeTaskGroups.length,
      tasksHighPriorityActive,
    })
    const overdueItemsByDomain = buildOverdueItemsByDomain({
      cleaning: cleaning.overdue,
      habits: [],
      selfCare: selfCare.missed,
      shopping: overdueShopping,
      tasks: overdueTasks.map((task) => mapTaskItem(task, to)),
    })

    return compactForAi({
      bottlenecks: buildOverloadBottlenecks({
        cleaningCount: cleaningActive,
        overdueCount: sumDomainCounts(overdueByDomain),
        selfCareMissed: selfCare.missed.length,
        shoppingCount: activeShopping.length,
        tasksHighPriority: tasksHighPriorityActive,
      }),
      counts: {
        activeItemsTotal: stats.activeCounts.total,
        calendarEvents: calendarEvents.length,
        calendarEventsActive: calendarEvents.length,
        cleaningActive,
        cleaningOverdue: cleaning.overdue.length,
        cleaningTasks: cleaningActive,
        habitsMissed: 0,
        overdueItemsTotal: stats.overdueByDomain.total,
        selfCareRemaining: selfCare.remaining.length,
        selfCareMissed: selfCare.missed.length,
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
      from,
      generatedAt: new Date().toISOString(),
      load: {
        activeCounts: {
          calendarEvents: calendarEvents.length,
          cleaningOverdue: cleaning.overdue.length,
          selfcareMissed: selfCare.missed.length,
          shoppingActive: activeShopping.length,
          tasksActive: activeTaskGroups.length,
          tasksHighPriorityActive,
        },
        activeScore: loadScore,
        ignoredCounts: {
          completedHighPriorityTasks,
          completedSelfcare: selfCare.completed.length,
          completedShopping: completedShopping.length,
          completedTasks: completedRangeTasks.length,
        },
        level: stats.loadLevel,
        reasons: stats.reasons,
        score: loadScore,
        structuredReasons,
      },
      cleaningOverdueByZone: groupCleaningOverdueByZone(cleaning.overdue),
      overdue: buildOverdueSummary(overdueByDomain),
      overdueItemsByDomain,
      suggestedFocus: buildSuggestedFocus(stats),
      timezone,
      to,
    } satisfies OverloadContext)
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
    const selfCare = await this.getSelfCareRange(context, from, to)
    const weakSpots = buildSelfCareWeakSpots(selfCare.missed)
    const potentialDuplicates = buildSelfCarePotentialDuplicates(
      selfCare.remaining,
    )

    return compactForAi({
      completed: limitItems(selfCare.completed),
      flexibleGoals: limitItems(selfCare.flexibleGoals),
      from,
      generatedAt: new Date().toISOString(),
      missed: limitItems(selfCare.missed),
      planned: limitItems(selfCare.planned),
      potentialDuplicates: limitItems(potentialDuplicates),
      remaining: limitItems(selfCare.remaining),
      scheduled: limitItems(selfCare.scheduled),
      summary: {
        completedCount: selfCare.completed.length,
        flexibleGoals: buildFlexibleGoalSummary(selfCare.flexibleGoals),
        missedCount: selfCare.missed.length,
        potentialDuplicateCount: potentialDuplicates.length,
        plannedCount: selfCare.planned.length,
        remainingCount: selfCare.remaining.length,
        scheduledCount: selfCare.scheduled.length,
        selfCareFlexibleGoals: buildFlexibleGoalSummary(selfCare.flexibleGoals),
        suggestedGentleFocus: weakSpots[0] ?? null,
        weakSpots,
      },
      timezone,
      to,
    } satisfies SelfCareContext)
  }

  private async loadDayContext(
    context: AiServiceReadContext,
    userId: string,
    date: string,
  ): Promise<LoadedContext> {
    const [tasks, shopping, cleaning, selfCare] = await Promise.all([
      this.listTasks(context, userId),
      this.listShopping(context, userId),
      this.getCleaningToday(context, date),
      this.getSelfCareDay(context, date),
    ])
    const activeTasks = tasks.filter(isActiveTask)
    const todayTasks = activeTasks.filter((task) => isTaskForDate(task, date))
    const completedTodayTasks = tasks.filter(
      (task) => isTaskCompleted(task) && readTaskDate(task) === date,
    )
    const overdueTasks = activeTasks.filter((task) => isTaskOverdue(task, date))
    const currentTasks = dedupeTaskItems([...todayTasks, ...overdueTasks])

    return {
      calendar: activeTasks
        .filter((task) => task.plannedDate === date && task.plannedStartTime)
        .map(mapTaskCalendarEvent),
      cleaning,
      habits: {
        completed: [],
        missed: [],
        planned: [],
      },
      selfCare,
      shopping,
      tasks: {
        all: currentTasks.map((task) => mapTaskItem(task, date)),
        completedToday: completedTodayTasks.map((task) =>
          mapTaskItem(task, date),
        ),
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

  private async listTasks(
    context: AiServiceReadContext,
    userId: string,
  ): Promise<Array<Task & { userId?: string; workspaceId?: string }>> {
    const tasks = await this.dependencies.taskService.listTasks(context, {
      limit: 100,
    })

    return tasks.filter((task) => belongsToUser(task, userId))
  }

  private async listShopping(
    context: AiServiceReadContext,
    userId: string,
  ): Promise<AiShoppingItem[]> {
    if (!this.dependencies.chaosInboxService) {
      return []
    }

    const result = await this.dependencies.chaosInboxService.listItems(
      context,
      {
        kind: 'shopping',
        limit: 100,
        page: 1,
      },
    )

    return result.items
      .filter((item) => item.kind === 'shopping')
      .filter((item) => item.userId === userId)
      .map((item) => ({
        category: item.shoppingCategory,
        dueDate: item.dueDate,
        source: 'shopping' as const,
        status:
          item.status === 'archived' || item.status === 'converted'
            ? 'done'
            : 'todo',
        title: item.text,
        urgent: item.priority === 'high' || item.isFavorite,
      }))
  }

  private async getCleaningToday(
    context: AiServiceReadContext,
    date: string,
  ): Promise<LoadedContext['cleaning']> {
    if (!this.dependencies.cleaningService) {
      return { overdue: [], tasks: [], todayZone: null }
    }

    const result = await this.dependencies.cleaningService.getToday(
      context,
      date,
    )
    const tasks = result.items.map(mapCleaningTask)
    const overdue = result.accumulatedItems.map(mapCleaningTask)
    const todayZone =
      result.zones.find((zone) => zone.dayOfWeek === result.dayOfWeek)?.title ??
      null

    return {
      overdue,
      tasks,
      todayZone,
    }
  }

  private async getCleaningRange(
    context: AiServiceReadContext,
    from: string,
    to: string,
  ): Promise<LoadedContext['cleaning']> {
    const dates = enumerateDateRange(from, to).slice(0, 14)
    const results = await Promise.all(
      dates.map((date) => this.getCleaningToday(context, date)),
    )

    return {
      overdue: dedupeItems(results.flatMap((result) => result.overdue)),
      tasks: dedupeItems(results.flatMap((result) => result.tasks)),
      todayZone: results[0]?.todayZone ?? null,
    }
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
        planned: [],
        remaining: [],
        scheduled: [],
        suggestedFocus: null,
      }
    }

    const dashboard = await this.dependencies.selfCareService.getDashboard(
      context,
      date,
    )
    const todayItems = dashboard.todayItems.filter(
      isRegularSelfCareTodayItemVisibleForAi,
    )
    const overdueItems = dashboard.overdueItems.filter(
      isRegularSelfCareTodayItemVisibleForAi,
    )
    const flexibleGoals = mapFlexibleGoalContexts(dashboard.flexibleGoals, date)
    const planned = normalizeSelfCareItemsForAi(
      todayItems.map((item) => mapSelfCareTodayItem(item, 'planned')),
    )
    const completed = normalizeSelfCareItemsForAi(
      todayItems
        .filter(isSelfCareTodayItemCompleted)
        .map((item) => mapSelfCareTodayItem(item, 'done')),
    )
    const missed = normalizeSelfCareItemsForAi(
      overdueItems.map((item) => mapSelfCareTodayItem(item, 'missed')),
    )
    const remaining = normalizeSelfCareItemsForAi(
      todayItems
        .filter((item) => !isSelfCareTodayItemCompleted(item))
        .filter((item) => item.occurrence?.status !== 'missed')
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
  ): Promise<Omit<LoadedContext['selfCare'], 'suggestedFocus'>> {
    if (!this.dependencies.selfCareService) {
      return {
        completed: [],
        flexibleGoals: [],
        missed: [],
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
      plan.occurrences.map((item) => mapSelfCareTodayItem(item, 'planned')),
    )
    const missed = filterSelfCareItemsForAi(
      plan.occurrences
        .filter((item) => item.occurrence?.status === 'missed')
        .map((item) => mapSelfCareTodayItem(item, 'missed')),
    )
    const remaining = filterSelfCareItemsForAi(
      plan.occurrences
        .filter((item) => !isSelfCareTodayItemCompleted(item))
        .filter((item) => item.occurrence?.status !== 'missed')
        .map((item) => mapSelfCareTodayItem(item, 'planned')),
    )
    const itemsById = new Map(history.items.map((item) => [item.id, item]))
    const completed = filterSelfCareItemsForAi(
      history.completions
        .filter((completion) => completion.status === 'done')
        .map((completion) => {
          const item = itemsById.get(completion.itemId)

          return {
            category: item?.category ?? null,
            date:
              completion.scheduledFor ?? completion.completedAt.slice(0, 10),
            source: 'selfcare' as const,
            status: 'done',
            title: item?.title ?? 'Self-care item',
            type: item?.type ?? null,
          }
        }),
    )

    return {
      completed,
      flexibleGoals,
      missed,
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
    dueDate: task.dueDate ?? task.plannedDate,
    importance: task.importance,
    priority:
      task.importance === 'important' || task.urgency === 'urgent'
        ? 'high'
        : task.resource !== null && task.resource <= 1
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
    id: buildFlexibleGoalContextId(entry.item.title, date),
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
    items: limitItems(goals),
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

function buildFlexibleGoalContextId(title: string, date: string): string {
  const slug = normalizeTitle(title)
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '')

  return `${slug || 'flexible-goal'}-${date}`
}

function isSelfCareTodayItemCompleted(item: SelfCareTodayItem): boolean {
  return (
    item.completion?.status === 'done' ||
    item.occurrence?.status === 'done' ||
    Boolean(item.occurrence?.completedAt)
  )
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
  return !isTaskCompleted(task)
}

function isTaskCompleted(task: Task): boolean {
  return task.status === 'done' || task.status === 'archived'
}

function isActiveShoppingItem(item: AiShoppingItem): boolean {
  return !isCompletedShoppingItem(item)
}

function isCompletedShoppingItem(item: AiShoppingItem): boolean {
  return item.status === 'done'
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
  return dedupeAiItems([
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

  return `task:${normalizeTitle(task.title)}`
}

function mapTaskGroupToTaskItem(group: AiTaskGroup): AiTaskItem {
  return {
    area: null,
    dueDate: group.dates[0] ?? null,
    importance: 'not_important',
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
}): AiOverdueItemsByDomain {
  return {
    cleaning: limitItems(input.cleaning),
    habits: limitItems(input.habits),
    selfcare: limitItems(input.selfCare),
    shopping: limitItems(input.shopping),
    tasks: limitItems(input.tasks),
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

  return limitItems(
    [...groups.entries()]
      .map(([zone, groupItems]) => ({
        count: groupItems.length,
        items: limitItems(groupItems),
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
      input.activeCounts.calendar +
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
    activeCounts.calendar +
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
    reasons.push('Self-care or habits were missed')
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
    stats.totalPlannedItems * 2 +
    stats.overdueItems * 5 +
    stats.reasons.length * 3

  return Math.min(100, base)
}

function buildStructuredLoadReasons(input: {
  calendarEvents: number
  cleaningOverdue: number
  habitsMissed: number
  selfcareMissed: number
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

function isTaskInRange(task: Task, from: string, to: string): boolean {
  const date = readTaskDate(task)

  return matchesDateRange(date, from, to)
}

function readTaskDate(task: Task): string | null {
  return (
    task.plannedDate ?? task.dueDate ?? task.completedAt?.slice(0, 10) ?? null
  )
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
  return task.resource !== null && task.resource <= 1
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
  if (from && to) {
    return [from, to]
  }

  const today = getDateKey(new Date(), timezone)

  if (from && !to) {
    return [from, addDays(from, 6)]
  }

  if (!from && to) {
    return [addDays(to, -6), to]
  }

  return getWeekRange(today)
}

function getWeekRange(date: string): [string, string] {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  const day = parsed.getUTCDay() || 7
  const monday = new Date(parsed.getTime() - (day - 1) * DAY_MS)
  const sunday = new Date(monday.getTime() + 6 * DAY_MS)

  return [toDateKey(monday), toDateKey(sunday)]
}

function enumerateDateRange(from: string, to: string): string[] {
  const dates: string[] = []
  let cursor = new Date(`${from}T00:00:00.000Z`)
  const end = new Date(`${to}T00:00:00.000Z`)

  while (cursor <= end) {
    dates.push(toDateKey(cursor))
    cursor = new Date(cursor.getTime() + DAY_MS)
  }

  return dates
}

function addDays(date: string, days: number): string {
  const parsed = new Date(`${date}T00:00:00.000Z`)

  return toDateKey(new Date(parsed.getTime() + days * DAY_MS))
}

function getDateKey(date: Date, timezone = DEFAULT_TIMEZONE): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  })

  return formatter.format(date)
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function resolveTimezone(timezone?: string): string {
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

function limitItems<T>(items: readonly T[]): T[] {
  return compactArrayForAi(items).items
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
