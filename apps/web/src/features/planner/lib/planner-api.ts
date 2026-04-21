import {
  apiErrorSchema,
  generateUuidV7,
  type NewProjectInput,
  newProjectInputSchema,
  type NewTaskInput,
  newTaskInputSchema,
  projectListResponseSchema,
  type ProjectRecord,
  projectRecordSchema,
  type ProjectUpdateInput,
  projectUpdateInputSchema,
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

export interface PlannerApiClientConfig {
  accessToken?: string
  actorUserId: string
  apiBaseUrl: string
  workspaceId: string
}

export interface PlannerApiClient {
  createProject: (input: NewProjectInput) => Promise<ProjectRecord>
  createTask: (input: NewTaskInput) => Promise<TaskRecord>
  getProject: (
    projectId: string,
    signal?: RequestSignal,
  ) => Promise<ProjectRecord>
  listTaskEvents: (
    filters?: TaskEventListFilters,
    signal?: RequestSignal,
  ) => Promise<TaskEventListResponse>
  listProjects: (signal?: RequestSignal) => Promise<ProjectRecord[]>
  listTasks: (
    filters?: TaskListFilters,
    signal?: RequestSignal,
  ) => Promise<TaskRecord[]>
  removeTask: (taskId: string, expectedVersion?: number) => Promise<void>
  setTaskSchedule: (
    taskId: string,
    input: TaskScheduleUpdateInput,
  ) => Promise<TaskRecord>
  setTaskStatus: (
    taskId: string,
    input: TaskStatusUpdateInput,
  ) => Promise<TaskRecord>
  updateProject: (
    projectId: string,
    input: ProjectUpdateInput,
  ) => Promise<ProjectRecord>
}

export function createPlannerApiClient(
  config: PlannerApiClientConfig,
  fetchFn: FetchFn = fetch,
): PlannerApiClient {
  const baseUrl = config.apiBaseUrl.replace(/\/$/, '')

  async function request<TResponse>(options: {
    body?: unknown
    method?: 'DELETE' | 'GET' | 'PATCH' | 'POST'
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
    async listProjects(signal) {
      return request({
        path: '/api/v1/projects',
        responseSchema: projectListResponseSchema,
        signal,
      })
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

      return request({
        body: validatedInput,
        method: 'POST',
        path: '/api/v1/projects',
        responseSchema: projectRecordSchema,
        writeAccess: true,
      })
    },
    async updateProject(projectId, input) {
      const validatedInput = projectUpdateInputSchema.parse(input)

      return request({
        body: validatedInput,
        method: 'PATCH',
        path: `/api/v1/projects/${encodeURIComponent(projectId)}`,
        responseSchema: projectRecordSchema,
        writeAccess: true,
      })
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
