import {
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
  type TaskListPageResponse,
  taskListPageResponseSchema,
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

import {
  type ApiClientFetch,
  type ApiRequestSignal,
  createApiRequester,
} from '@/shared/lib/api-client'

import {
  mapLifeSphereToProjectRecord,
  mapNewProjectInputToLifeSphereInput,
  mapProjectUpdateInputToLifeSphereUpdateInput,
} from './sphere-project-compat'

type FetchFn = ApiClientFetch
type RequestSignal = ApiRequestSignal

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
  listTasksPage: (
    filters?: TaskListFilters,
    signal?: RequestSignal,
  ) => Promise<TaskListPageResponse>
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
  const { request } = createApiRequester(
    config,
    (message, options) => new PlannerApiError(message, options),
    fetchFn,
  )

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
      const sphere = await request({
        path: `/api/v1/life-spheres/${encodeURIComponent(projectId)}`,
        responseSchema: lifeSphereRecordSchema,
        signal,
      })

      return mapLifeSphereToProjectRecord(sphere)
    },
    async createProject(input) {
      const validatedInput = newProjectInputSchema.parse({
        ...input,
        id: input.id ?? generateUuidV7(),
      })
      const sphereInput = mapNewProjectInputToLifeSphereInput(validatedInput)

      const sphere = await request({
        body: sphereInput,
        method: 'POST',
        path: '/api/v1/life-spheres',
        responseSchema: lifeSphereRecordSchema,
        writeAccess: true,
      })

      return mapLifeSphereToProjectRecord(sphere)
    },
    async updateProject(projectId, input) {
      const validatedInput = projectUpdateInputSchema.parse(input)
      const sphereInput =
        mapProjectUpdateInputToLifeSphereUpdateInput(validatedInput)

      const sphere = await request({
        body: sphereInput,
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
    async listTasksPage(filters = {}, signal) {
      const validatedFilters = taskListFiltersSchema.parse(filters)

      return request({
        path: '/api/v1/tasks/page',
        query: validatedFilters,
        responseSchema: taskListPageResponseSchema,
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
