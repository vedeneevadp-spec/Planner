import type {
  ChaosInboxItemRecord,
  ChaosInboxKind,
  ChaosInboxStatus,
  CleaningTodayResponse,
  HabitTodayResponse,
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
  AiCleaningTask,
  AiHabitItem,
  AiLoadLevel,
  AiSelfCareItem,
  AiShoppingItem,
  AiSuggestedMode,
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

interface HabitServiceLike {
  getStats(
    context: AiServiceReadContext,
    from: string,
    to: string,
  ): Promise<{
    stats: Array<{ currentStreak: number; habitId: string }>
  }>
  getToday(
    context: AiServiceReadContext,
    date: string,
  ): Promise<HabitTodayResponse>
}

interface SelfCareServiceLike {
  getDashboard(
    context: AiServiceReadContext,
    date: string,
  ): Promise<{
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
  habitService?: HabitServiceLike | undefined
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
    missed: AiSelfCareItem[]
    planned: AiSelfCareItem[]
    suggestedFocus: string | null
  }
  shopping: AiShoppingItem[]
  tasks: {
    all: AiTaskItem[]
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

    if (include.includes('tasks')) {
      result.tasks = {
        important: limitItems(loaded.tasks.important),
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
      const urgent = loaded.shopping.filter((item) => item.urgent)
      const normal = loaded.shopping.filter((item) => !item.urgent)

      result.shopping = {
        normal: limitItems(normal),
        totalCount: loaded.shopping.length,
        urgent: limitItems(urgent),
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
        missed: limitItems(loaded.selfCare.missed),
        planned: limitItems(loaded.selfCare.planned),
        suggestedFocus: loaded.selfCare.suggestedFocus,
      }
    }

    if (include.includes('habits')) {
      result.habits = {
        completed: limitItems(loaded.habits.completed),
        missed: limitItems(loaded.habits.missed),
        planned: limitItems(loaded.habits.planned),
      }
    }

    if (include.includes('stats')) {
      result.stats = buildStats({
        calendarCount: loaded.calendar.length,
        cleaningCount: loaded.cleaning.tasks.length,
        habitsMissed: loaded.habits.missed.length,
        overdueCount:
          loaded.tasks.overdue.length +
          loaded.cleaning.overdue.length +
          loaded.selfCare.missed.length,
        selfCareMissed: loaded.selfCare.missed.length,
        shoppingCount: loaded.shopping.length,
        taskCount: loaded.tasks.today.length,
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
    const weekTasks = tasks.filter((task) => isTaskInRange(task, from, to))
    const completedTasks = weekTasks.filter((task) => task.status === 'done')
    const overdueTasks = tasks.filter((task) => isTaskOverdue(task, to))
    const shopping = await this.listShopping(context, params.userId)
    const cleaning = await this.getCleaningRange(context, from, to)
    const selfCare = await this.getSelfCareRange(context, from, to)
    const taskItems = weekTasks.map((task) => mapTaskItem(task, from))
    const overdueItems = overdueTasks.map((task) => mapTaskItem(task, to))
    const repeatedOrStuck = taskItems.filter((item) =>
      Boolean(item.snippet?.toLowerCase().includes('recurring')),
    )
    const stats = buildStats({
      calendarCount: tasks.filter((task) => task.plannedStartTime).length,
      cleaningCount: cleaning.tasks.length,
      habitsMissed: 0,
      overdueCount: overdueItems.length + selfCare.missed.length,
      selfCareMissed: selfCare.missed.length,
      shoppingCount: shopping.length,
      taskCount: weekTasks.length,
    })

    return compactForAi({
      bottlenecks: buildBottlenecks(stats.reasons, overdueItems.length),
      from,
      generatedAt: new Date().toISOString(),
      highlights: {
        completed: limitItems(
          completedTasks.map((task) => mapTaskItem(task, to)),
        ),
        overdue: limitItems(overdueItems),
        repeatedOrStuck: limitItems(repeatedOrStuck),
        upcomingImportant: limitItems(
          taskItems.filter((item) => item.priority === 'high'),
        ),
      },
      possibleSimplifications: buildSimplifications(stats),
      summary: {
        cleaningTasks: cleaning.tasks.length,
        completedTasks: completedTasks.length,
        loadLevel: stats.loadLevel,
        overdueTasks: overdueItems.length,
        plannedTasks: weekTasks.length,
        selfCareCompleted: selfCare.completed.length,
        selfCareMissed: selfCare.missed.length,
        shoppingItems: shopping.length,
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
        ...(await this.listShopping(context, params.userId))
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
        ...[
          ...selfCare.planned,
          ...selfCare.completed,
          ...selfCare.missed,
        ].filter((item) => matchesSearch(item, normalizedQuery)),
      )
    }

    if (types.includes('habits')) {
      const habits = await this.getHabitsToday(
        context,
        params.from ?? getDateKey(new Date()),
      )

      results.push(
        ...[...habits.planned, ...habits.completed, ...habits.missed].filter(
          (item) => matchesSearch(item, normalizedQuery),
        ),
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
    const rangeTasks = tasks.filter((task) => isTaskInRange(task, from, to))
    const overdueTasks = tasks.filter((task) => isTaskOverdue(task, to))
    const shopping = await this.listShopping(context, params.userId)
    const cleaning = await this.getCleaningRange(context, from, to)
    const selfCare = await this.getSelfCareRange(context, from, to)
    const calendarEvents = rangeTasks.filter((task) => task.plannedStartTime)
    const stats = buildStats({
      calendarCount: calendarEvents.length,
      cleaningCount: cleaning.tasks.length,
      habitsMissed: 0,
      overdueCount: overdueTasks.length + selfCare.missed.length,
      selfCareMissed: selfCare.missed.length,
      shoppingCount: shopping.length,
      taskCount: rangeTasks.length,
    })

    return compactForAi({
      bottlenecks: buildOverloadBottlenecks({
        cleaningCount: cleaning.tasks.length,
        overdueCount: overdueTasks.length,
        selfCareMissed: selfCare.missed.length,
        shoppingCount: shopping.length,
        tasksHighPriority: rangeTasks.filter(isHighPriorityTask).length,
      }),
      counts: {
        calendarEvents: calendarEvents.length,
        cleaningTasks: cleaning.tasks.length,
        selfCareMissed: selfCare.missed.length,
        shoppingItems: shopping.length,
        tasksHighPriority: rangeTasks.filter(isHighPriorityTask).length,
        tasksOverdue: overdueTasks.length,
        tasksTotal: rangeTasks.length,
      },
      from,
      generatedAt: new Date().toISOString(),
      load: {
        level: stats.loadLevel,
        reasons: stats.reasons,
        score: calculateLoadScore(stats),
      },
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

    return compactForAi({
      completed: limitItems(selfCare.completed),
      from,
      generatedAt: new Date().toISOString(),
      missed: limitItems(selfCare.missed),
      planned: limitItems(selfCare.planned),
      summary: {
        completedCount: selfCare.completed.length,
        missedCount: selfCare.missed.length,
        plannedCount: selfCare.planned.length,
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
    const [tasks, shopping, cleaning, selfCare, habits] = await Promise.all([
      this.listTasks(context, userId),
      this.listShopping(context, userId),
      this.getCleaningToday(context, date),
      this.getSelfCareDay(context, date),
      this.getHabitsToday(context, date),
    ])
    const todayTasks = tasks.filter((task) => isTaskForDate(task, date))
    const overdueTasks = tasks.filter((task) => isTaskOverdue(task, date))

    return {
      calendar: tasks
        .filter((task) => task.plannedDate === date && task.plannedStartTime)
        .map(mapTaskCalendarEvent),
      cleaning,
      habits,
      selfCare,
      shopping,
      tasks: {
        all: tasks.map((task) => mapTaskItem(task, date)),
        important: tasks
          .filter(isHighPriorityTask)
          .map((task) => mapTaskItem(task, date)),
        lowEnergy: tasks
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
    const baseSession = await this.dependencies.sessionService.resolveSession({
      actorUserId: userId,
      auth: null,
      workspaceId: undefined,
    })
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

    const auth = createSyntheticAuthContext(userId, baseSession.actor.email)
    const session =
      personalWorkspace.id === baseSession.workspaceId
        ? baseSession
        : await this.dependencies.sessionService.resolveSession({
            actorUserId: userId,
            auth: null,
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
      return { completed: [], missed: [], planned: [], suggestedFocus: null }
    }

    const dashboard = await this.dependencies.selfCareService.getDashboard(
      context,
      date,
    )
    const planned = dashboard.todayItems.map((item) =>
      mapSelfCareTodayItem(item, 'planned'),
    )
    const completed = dashboard.todayItems
      .filter((item) => item.completion || item.occurrence?.status === 'done')
      .map((item) => mapSelfCareTodayItem(item, 'done'))
    const missed = dashboard.overdueItems.map((item) =>
      mapSelfCareTodayItem(item, 'missed'),
    )

    return {
      completed,
      missed,
      planned,
      suggestedFocus:
        dashboard.upcomingImportant[0]?.item.title ??
        dashboard.planningHints[0]?.item.title ??
        null,
    }
  }

  private async getSelfCareRange(
    context: AiServiceReadContext,
    from: string,
    to: string,
  ): Promise<Omit<LoadedContext['selfCare'], 'suggestedFocus'>> {
    if (!this.dependencies.selfCareService) {
      return { completed: [], missed: [], planned: [] }
    }

    const [plan, history] = await Promise.all([
      this.dependencies.selfCareService.getPlan(context, from, to),
      this.dependencies.selfCareService.getHistory(context, from, to),
    ])
    const planned = plan.occurrences.map((item) =>
      mapSelfCareTodayItem(item, 'planned'),
    )
    const missed = plan.occurrences
      .filter((item) => item.occurrence?.status === 'missed')
      .map((item) => mapSelfCareTodayItem(item, 'missed'))
    const itemsById = new Map(history.items.map((item) => [item.id, item]))
    const completed = history.completions
      .filter((completion) => completion.status === 'done')
      .map((completion) => {
        const item = itemsById.get(completion.itemId)

        return {
          date: completion.scheduledFor ?? completion.completedAt.slice(0, 10),
          source: 'selfcare' as const,
          status: 'done',
          title: item?.title ?? 'Self-care item',
          type: item?.type ?? null,
        }
      })

    return {
      completed,
      missed,
      planned,
    }
  }

  private async getHabitsToday(
    context: AiServiceReadContext,
    date: string,
  ): Promise<LoadedContext['habits']> {
    if (!this.dependencies.habitService) {
      return { completed: [], missed: [], planned: [] }
    }

    const result = await this.dependencies.habitService.getToday(context, date)
    const statsResult = await this.dependencies.habitService.getStats(
      context,
      date,
      date,
    )
    const streaksByHabitId = new Map(
      statsResult.stats.map((stats) => [stats.habitId, stats.currentStreak]),
    )
    const items = result.items
      .filter((item) => item.isDueToday)
      .map((item) => ({
        date,
        source: 'habits' as const,
        status:
          item.entry?.status === 'done'
            ? 'done'
            : item.entry?.status === 'skipped'
              ? 'missed'
              : 'planned',
        streak: streaksByHabitId.get(item.habit.id) ?? null,
        title: item.habit.title,
      }))

    return {
      completed: items.filter((item) => item.status === 'done'),
      missed: items.filter((item) => item.status === 'missed'),
      planned: items,
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
    priority:
      task.importance === 'important' || task.urgency === 'urgent'
        ? 'high'
        : task.resource !== null && task.resource <= 1
          ? 'low'
          : 'normal',
    snippet: buildTaskSnippet(task),
    source: 'tasks',
    status: isTaskOverdue(task, today)
      ? 'overdue'
      : task.status === 'archived'
        ? 'cancelled'
        : task.status,
    tags: task.project ? [task.project] : [],
    title: task.title,
  }
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
    date:
      item.occurrence?.scheduledFor ?? item.completion?.scheduledFor ?? null,
    source: 'selfcare',
    status,
    title: item.item.title,
    type: item.item.type,
  }
}

function buildTaskSnippet(task: Task): string | null {
  const parts = [
    task.note ? task.note : null,
    task.recurrence?.isActive ? 'recurring' : null,
  ].filter(Boolean)

  return parts.length ? parts.join(' ') : null
}

function buildStats(input: {
  calendarCount: number
  cleaningCount: number
  habitsMissed: number
  overdueCount: number
  selfCareMissed: number
  shoppingCount: number
  taskCount: number
}): NonNullable<TodayContext['stats']> {
  const totalPlannedItems =
    input.taskCount +
    input.calendarCount +
    input.shoppingCount +
    input.cleaningCount
  const reasons: string[] = []

  if (input.taskCount >= 8) {
    reasons.push('Many planned tasks')
  }

  if (input.calendarCount >= 4) {
    reasons.push('Several timed calendar blocks')
  }

  if (input.overdueCount > 0) {
    reasons.push('Overdue items need attention')
  }

  if (input.selfCareMissed > 0 || input.habitsMissed > 0) {
    reasons.push('Self-care or habits were missed')
  }

  const score =
    input.taskCount * 2 +
    input.calendarCount * 3 +
    input.shoppingCount +
    input.cleaningCount * 2 +
    input.overdueCount * 4 +
    input.selfCareMissed * 3
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
    loadLevel,
    overdueItems: input.overdueCount,
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
