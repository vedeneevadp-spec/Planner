import {
  apiErrorSchema,
  type DailyPlanAutoBuildInput,
  dailyPlanAutoBuildInputSchema,
  type DailyPlanRecord,
  dailyPlanRecordSchema,
  type DailyPlanUnloadInput,
  dailyPlanUnloadInputSchema,
  type DailyPlanUnloadResponse,
  dailyPlanUnloadResponseSchema,
  type DailyPlanUpsertInput,
  dailyPlanUpsertInputSchema,
  generateUuidV7,
  lifeSphereListRecordResponseSchema,
  type LifeSphereRecord,
  lifeSphereRecordSchema,
  type LifeSphereUpdateInput,
  lifeSphereUpdateInputSchema,
  type NewLifeSphereInput,
  newLifeSphereInputSchema,
  type NewProjectInput,
  newProjectInputSchema,
  type NewTaskInput,
  newTaskInputSchema,
  type NewTaskTemplateInput,
  newTaskTemplateInputSchema,
  type ProjectRecord,
  projectRecordSchema,
  type ProjectUpdateInput,
  projectUpdateInputSchema,
  type TaskDetailsUpdateInput,
  taskDetailsUpdateInputSchema,
  type TaskEventListFilters,
  taskEventListFiltersSchema,
  type TaskEventListResponse,
  taskEventListResponseSchema,
  type TaskListFilters,
  taskListFiltersSchema,
  taskListResponseSchema,
  type TaskRecord,
  taskRecordSchema,
  type TaskScheduleUpdateInput,
  taskScheduleUpdateInputSchema,
  type TaskStatusUpdateInput,
  taskStatusUpdateInputSchema,
  taskTemplateListResponseSchema,
  type TaskTemplateRecord,
  taskTemplateRecordSchema,
  weeklySphereStatsRecordResponseSchema,
  type WeeklySphereStatsResponse,
} from '@planner/contracts'

type FetchFn = typeof fetch
type RequestSignal = AbortSignal | undefined

export class PlannerApiError extends Error {
  readonly code: string
  readonly details?: unknown
  readonly status: number

  constructor(
    message: string,
    options: {
      code: string
      details?: unknown
      status: number
    },
  ) {
    super(message)
    this.name = 'PlannerApiError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export function isUnauthorizedPlannerApiError(
  error: unknown,
): error is PlannerApiError {
  return error instanceof PlannerApiError && error.status === 401
}

function mapLifeSphereToProjectRecord(sphere: LifeSphereRecord): ProjectRecord {
  return {
    color: sphere.color,
    createdAt: sphere.createdAt,
    deletedAt: sphere.deletedAt,
    description: sphere.description,
    icon: sphere.icon,
    id: sphere.id,
    status: sphere.isActive ? 'active' : 'archived',
    title: sphere.name,
    updatedAt: sphere.updatedAt,
    version: sphere.version,
    workspaceId: sphere.workspaceId,
  }
}

export interface PlannerApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface PlannerApiClient {
  autoBuildDailyPlan: (
    input: DailyPlanAutoBuildInput,
  ) => Promise<DailyPlanRecord>
  createLifeSphere: (input: NewLifeSphereInput) => Promise<LifeSphereRecord>
  createProject: (input: NewProjectInput) => Promise<ProjectRecord>
  createTask: (input: NewTaskInput) => Promise<TaskRecord>
  createTaskTemplate: (
    input: NewTaskTemplateInput,
  ) => Promise<TaskTemplateRecord>
  getProject: (
    projectId: string,
    signal?: RequestSignal,
  ) => Promise<ProjectRecord>
  getDailyPlan: (
    date: string,
    signal?: RequestSignal,
  ) => Promise<DailyPlanRecord>
  getLifeSphereWeeklyStats: (
    from: string,
    to: string,
    signal?: RequestSignal,
  ) => Promise<WeeklySphereStatsResponse>
  listLifeSpheres: (signal?: RequestSignal) => Promise<LifeSphereRecord[]>
  listTaskEvents: (
    filters?: TaskEventListFilters,
    signal?: RequestSignal,
  ) => Promise<TaskEventListResponse>
  listProjects: (signal?: RequestSignal) => Promise<ProjectRecord[]>
  listTasks: (
    filters?: TaskListFilters,
    signal?: RequestSignal,
  ) => Promise<TaskRecord[]>
  listTaskTemplates: (signal?: RequestSignal) => Promise<TaskTemplateRecord[]>
  removeTaskTemplate: (templateId: string) => Promise<void>
  removeLifeSphere: (sphereId: string) => Promise<void>
  removeTask: (taskId: string, expectedVersion?: number) => Promise<void>
  saveDailyPlan: (
    date: string,
    input: DailyPlanUpsertInput,
  ) => Promise<DailyPlanRecord>
  setTaskSchedule: (
    taskId: string,
    input: TaskScheduleUpdateInput,
  ) => Promise<TaskRecord>
  setTaskStatus: (
    taskId: string,
    input: TaskStatusUpdateInput,
  ) => Promise<TaskRecord>
  updateTask: (
    taskId: string,
    input: TaskDetailsUpdateInput,
  ) => Promise<TaskRecord>
  updateProject: (
    projectId: string,
    input: ProjectUpdateInput,
  ) => Promise<ProjectRecord>
  updateLifeSphere: (
    sphereId: string,
    input: LifeSphereUpdateInput,
  ) => Promise<LifeSphereRecord>
  unloadDailyPlan: (
    input: DailyPlanUnloadInput,
  ) => Promise<DailyPlanUnloadResponse>
}

export function createPlannerApiClient(
  config: PlannerApiClientConfig,
  fetchFn: FetchFn = fetch,
): PlannerApiClient {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method?: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT'
    path: string
    query?: Record<string, string | number | undefined> | undefined
    responseSchema?: { parse: (value: unknown) => TResponse }
    signal?: RequestSignal
    writeAccess?: boolean
  }): Promise<TResponse> {
    const url = new URL(`${baseUrl}${options.path}`)

    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined) {
          continue
        }

        url.searchParams.set(key, String(value))
      }
    }

    const headers = new Headers({
      'x-workspace-id': config.workspaceId,
    })

    if (config.accessToken) {
      headers.set('authorization', `Bearer ${config.accessToken}`)
    }

    if (options.writeAccess && !config.accessToken) {
      headers.set('x-actor-user-id', config.actorUserId)
    }

    if (options.body !== undefined) {
      headers.set('content-type', 'application/json')
    }

    const response = await fetchFn(url, {
      body: options.body === undefined ? null : JSON.stringify(options.body),
      headers,
      method: options.method ?? 'GET',
      ...(options.signal ? { signal: options.signal } : {}),
    })

    if (response.status === 204) {
      return undefined as TResponse
    }

    const payload = (await response.json()) as unknown

    if (!response.ok) {
      const parsedError = apiErrorSchema.safeParse(payload)

      if (parsedError.success) {
        throw new PlannerApiError(parsedError.data.error.message, {
          code: parsedError.data.error.code,
          details: parsedError.data.error.details,
          status: response.status,
        })
      }

      throw new PlannerApiError('Request failed.', {
        code: 'request_failed',
        details: payload,
        status: response.status,
      })
    }

    return options.responseSchema
      ? options.responseSchema.parse(payload)
      : (payload as TResponse)
  }

  return {
    async getDailyPlan(date, signal) {
      return request({
        path: '/api/v1/daily-plan',
        query: { date },
        responseSchema: dailyPlanRecordSchema,
        signal,
      })
    },
    async saveDailyPlan(date, input) {
      const validatedInput = dailyPlanUpsertInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'PUT',
        path: '/api/v1/daily-plan',
        query: { date },
        responseSchema: dailyPlanRecordSchema,
        writeAccess: true,
      })
    },
    async autoBuildDailyPlan(input) {
      const validatedInput = dailyPlanAutoBuildInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/daily-plan/auto-build',
        responseSchema: dailyPlanRecordSchema,
        writeAccess: true,
      })
    },
    async unloadDailyPlan(input) {
      const validatedInput = dailyPlanUnloadInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/daily-plan/unload',
        responseSchema: dailyPlanUnloadResponseSchema,
      })
    },
    async listLifeSpheres(signal) {
      return request({
        path: '/api/v1/life-spheres',
        responseSchema: lifeSphereListRecordResponseSchema,
        signal,
      })
    },
    async createLifeSphere(input) {
      const validatedInput = newLifeSphereInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
      })

      return request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/life-spheres',
        responseSchema: lifeSphereRecordSchema,
        writeAccess: true,
      })
    },
    async updateLifeSphere(sphereId, input) {
      const validatedInput = lifeSphereUpdateInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'PATCH',
        path: `/api/v1/life-spheres/${encodeURIComponent(sphereId)}`,
        responseSchema: lifeSphereRecordSchema,
        writeAccess: true,
      })
    },
    async removeLifeSphere(sphereId) {
      await request<void>({
        method: 'DELETE',
        path: `/api/v1/life-spheres/${encodeURIComponent(sphereId)}`,
        writeAccess: true,
      })
    },
    async getLifeSphereWeeklyStats(from, to, signal) {
      return request({
        path: '/api/v1/life-spheres/weekly-stats',
        query: { from, to },
        responseSchema: weeklySphereStatsRecordResponseSchema,
        signal,
      })
    },
    async listProjects(signal) {
      const spheres = await request({
        path: '/api/v1/life-spheres',
        responseSchema: lifeSphereListRecordResponseSchema,
        signal,
      })

      return spheres.map((sphere) => mapLifeSphereToProjectRecord(sphere))
    },
    async getProject(projectId, signal) {
      return request({
        path: `/api/v1/projects/${encodeURIComponent(projectId)}`,
        responseSchema: projectRecordSchema,
        signal,
      })
    },
    async createProject(input) {
      const validatedInput = newProjectInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
      })

      const sphere = await request({
        body: {
          color: validatedInput.color,
          description: validatedInput.description,
          icon: validatedInput.icon,
          id: validatedInput.id,
          name: validatedInput.title,
        },
        method: 'POST',
        path: '/api/v1/life-spheres',
        responseSchema: lifeSphereRecordSchema,
        writeAccess: true,
      })

      return mapLifeSphereToProjectRecord(sphere)
    },
    async updateProject(projectId, input) {
      const validatedInput = projectUpdateInputSchema.parse(input)

      const sphere = await request({
        body: {
          ...(validatedInput.expectedVersion !== undefined
            ? { expectedVersion: validatedInput.expectedVersion }
            : {}),
          ...(validatedInput.title !== undefined
            ? { name: validatedInput.title }
            : {}),
          ...(validatedInput.description !== undefined
            ? { description: validatedInput.description }
            : {}),
          ...(validatedInput.color !== undefined
            ? { color: validatedInput.color }
            : {}),
          ...(validatedInput.icon !== undefined
            ? { icon: validatedInput.icon }
            : {}),
        },
        method: 'PATCH',
        path: `/api/v1/life-spheres/${encodeURIComponent(projectId)}`,
        responseSchema: lifeSphereRecordSchema,
        writeAccess: true,
      })

      return mapLifeSphereToProjectRecord(sphere)
    },
    async listTasks(filters = {}, signal) {
      const validatedFilters = taskListFiltersSchema.parse(filters)

      return request({
        path: '/api/v1/tasks',
        query: validatedFilters,
        responseSchema: taskListResponseSchema,
        signal,
      })
    },
    async listTaskEvents(filters = {}, signal) {
      const validatedFilters = taskEventListFiltersSchema.parse(filters)

      return request({
        path: '/api/v1/task-events',
        query: validatedFilters,
        responseSchema: taskEventListResponseSchema,
        signal,
      })
    },
    async createTask(input) {
      const validatedInput = newTaskInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
      })

      return request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/tasks',
        responseSchema: taskRecordSchema,
        writeAccess: true,
      })
    },
    async listTaskTemplates(signal) {
      return request({
        path: '/api/v1/task-templates',
        responseSchema: taskTemplateListResponseSchema,
        signal,
      })
    },
    async createTaskTemplate(input) {
      const validatedInput = newTaskTemplateInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
      })

      return request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/task-templates',
        responseSchema: taskTemplateRecordSchema,
        writeAccess: true,
      })
    },
    async removeTaskTemplate(templateId) {
      await request<void>({
        method: 'DELETE',
        path: `/api/v1/task-templates/${encodeURIComponent(templateId)}`,
        writeAccess: true,
      })
    },
    async updateTask(taskId, input) {
      const validatedInput = taskDetailsUpdateInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'PATCH',
        path: `/api/v1/tasks/${encodeURIComponent(taskId)}`,
        responseSchema: taskRecordSchema,
        writeAccess: true,
      })
    },
    async setTaskStatus(taskId, input) {
      const validatedInput = taskStatusUpdateInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'PATCH',
        path: `/api/v1/tasks/${encodeURIComponent(taskId)}/status`,
        responseSchema: taskRecordSchema,
        writeAccess: true,
      })
    },
    async setTaskSchedule(taskId, input) {
      const validatedInput = taskScheduleUpdateInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'PATCH',
        path: `/api/v1/tasks/${encodeURIComponent(taskId)}/schedule`,
        responseSchema: taskRecordSchema,
        writeAccess: true,
      })
    },
    async removeTask(taskId, expectedVersion) {
      await request<void>({
        method: 'DELETE',
        path: `/api/v1/tasks/${encodeURIComponent(taskId)}`,
        query: expectedVersion === undefined ? undefined : { expectedVersion },
        writeAccess: true,
      })
    },
  }
}
