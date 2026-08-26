import type { TaskRecord } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'

import { NativePlannerWidgetSync } from './NativePlannerWidgetSync'

interface PlannerStub {
  isLoading: boolean
  isSyncing: boolean
  refresh: () => Promise<void>
  setTaskStatus: (taskId: string, status: 'done') => Promise<boolean>
  spheres: []
  tasks: Task[]
}

interface SessionAuthStub {
  lifecycleStatus: 'authenticated' | 'signed_out'
  sessionVersion: number
}

interface PlannerSessionStub {
  actorUserId: string
  workspace: {
    id: string
    kind: 'personal' | 'shared'
  }
  workspaceId: string
  workspaces: Array<{
    id: string
    kind: 'personal' | 'shared'
  }>
}

interface WidgetListenerHandle {
  remove: () => Promise<void> | void
}

const mocks = vi.hoisted(() => ({
  ackPendingNativePlannerWidgetCompletedTasks:
    vi.fn<(taskIds: string[]) => Promise<void>>(),
  addNativePlannerWidgetResumeListener:
    vi.fn<(listener: () => void) => Promise<WidgetListenerHandle>>(),
  buildNativePlannerWidgetSnapshot:
    vi.fn<
      (
        tasks: Task[],
        spheres: unknown[],
        now?: Date,
        supplementalData?: unknown,
      ) => unknown
    >(),
  completeCleaningTask:
    vi.fn<(taskId: string, input: unknown) => Promise<unknown>>(),
  queueCleaningTaskCompletion:
    vi.fn<
      (input: Record<string, unknown>) => Promise<Record<string, unknown>>
    >(),
  consumePendingNativePlannerWidgetRoute: vi.fn<() => Promise<string | null>>(),
  configureNativePlannerWidgetBackgroundSync:
    vi.fn<(input: Record<string, string>) => Promise<void>>(),
  disableNativePlannerWidgetBackgroundSync: vi.fn<() => Promise<void>>(),
  isAndroidPlannerWidgetRuntime: vi.fn<() => boolean>(),
  persistNativePlannerWidgetSnapshot:
    vi.fn<(snapshot: unknown) => Promise<void>>(),
  readPendingNativePlannerWidgetCompletedTasks:
    vi.fn<() => Promise<string[]>>(),
  createPlannerApiClient: vi.fn<() => unknown>(),
  createCleaningApiClient: vi.fn<() => unknown>(),
  createSelfCareApiClient: vi.fn<() => unknown>(),
  enqueuePlannerOfflineMutation: vi.fn<(input: unknown) => Promise<null>>(),
  loadCachedLifeSphereRecords: vi.fn<(workspaceId: string) => Promise<[]>>(),
  loadCachedTaskRecords: vi.fn<(workspaceId: string) => Promise<[]>>(),
  replaceCachedLifeSphereRecords:
    vi.fn<(workspaceId: string, records: unknown[]) => Promise<void>>(),
  replaceCachedTaskRecords:
    vi.fn<(workspaceId: string, records: unknown[]) => Promise<void>>(),
  upsertCachedTaskRecord:
    vi.fn<(workspaceId: string, record: unknown) => Promise<void>>(),
  usePlanner: vi.fn<() => PlannerStub>(),
  useSessionFeatureReadiness: vi.fn<
    () => {
      apiConfig: {
        accessToken: string
        actorUserId: string
        apiBaseUrl: string
        clientTimeZone: string
        workspaceId: string
      }
      session: PlannerSessionStub
    }
  >(),
  useSessionAuth: vi.fn<() => SessionAuthStub>(),
}))

vi.mock('@/features/cleaning', () => ({
  cleaningTodayQueryKey: (
    workspaceId: string,
    actorUserId: string,
    date: string,
  ) => ['cleaning', workspaceId, actorUserId, 'today', date],
  createCleaningApiClient: () => mocks.createCleaningApiClient(),
  queueCleaningTaskCompletion: (input: Record<string, unknown>) =>
    mocks.queueCleaningTaskCompletion(input),
}))

vi.mock('@/features/self-care', () => ({
  createSelfCareQueryOwnerId: (workspaceId: string, actorUserId: string) =>
    JSON.stringify([workspaceId, actorUserId]),
  createSelfCareApiClient: () => mocks.createSelfCareApiClient(),
  selfCareDashboardQueryKey: (ownerId: string, date: string) => [
    'self-care',
    ownerId,
    'dashboard',
    date,
  ],
}))

vi.mock('@/features/session', () => ({
  useSessionFeatureReadiness: () => mocks.useSessionFeatureReadiness(),
  useSessionAuth: () => mocks.useSessionAuth(),
}))

vi.mock('../lib/planner-api', () => ({
  createPlannerApiClient: () => mocks.createPlannerApiClient(),
}))

vi.mock('../lib/offline-planner-store', () => ({
  enqueuePlannerOfflineMutation: (input: unknown) =>
    mocks.enqueuePlannerOfflineMutation(input),
  isPlannerOfflineStorageAvailable: () => true,
  loadCachedLifeSphereRecords: (workspaceId: string) =>
    mocks.loadCachedLifeSphereRecords(workspaceId),
  loadCachedTaskRecords: (workspaceId: string) =>
    mocks.loadCachedTaskRecords(workspaceId),
  replaceCachedLifeSphereRecords: (workspaceId: string, records: unknown[]) =>
    mocks.replaceCachedLifeSphereRecords(workspaceId, records),
  replaceCachedTaskRecords: (workspaceId: string, records: unknown[]) =>
    mocks.replaceCachedTaskRecords(workspaceId, records),
  upsertCachedTaskRecord: (workspaceId: string, record: unknown) =>
    mocks.upsertCachedTaskRecord(workspaceId, record),
}))

vi.mock('../lib/usePlanner', () => ({
  usePlanner: () => mocks.usePlanner(),
}))

vi.mock('../lib/native-planner-widget', () => ({
  ackPendingNativePlannerWidgetCompletedTasks: (
    taskIds: string[],
  ): Promise<void> =>
    mocks.ackPendingNativePlannerWidgetCompletedTasks(taskIds),
  addNativePlannerWidgetResumeListener: (listener: () => void) =>
    mocks.addNativePlannerWidgetResumeListener(listener),
  buildNativePlannerWidgetSnapshot: (
    tasks: Task[],
    spheres: unknown[],
    now?: Date,
    supplementalData?: unknown,
  ) =>
    mocks.buildNativePlannerWidgetSnapshot(
      tasks,
      spheres,
      now,
      supplementalData,
    ),
  configureNativePlannerWidgetBackgroundSync: (input: Record<string, string>) =>
    mocks.configureNativePlannerWidgetBackgroundSync(input),
  consumePendingNativePlannerWidgetRoute: () =>
    mocks.consumePendingNativePlannerWidgetRoute(),
  disableNativePlannerWidgetBackgroundSync: () =>
    mocks.disableNativePlannerWidgetBackgroundSync(),
  getNativePlannerWidgetCleaningTaskId: (taskId: string) =>
    taskId.startsWith('cleaning:') ? taskId.slice('cleaning:'.length) : null,
  isAndroidPlannerWidgetRuntime: () => mocks.isAndroidPlannerWidgetRuntime(),
  persistNativePlannerWidgetSnapshot: (snapshot: unknown) =>
    mocks.persistNativePlannerWidgetSnapshot(snapshot),
  readPendingNativePlannerWidgetCompletedTasks: () =>
    mocks.readPendingNativePlannerWidgetCompletedTasks(),
}))

const baseTask: Task = {
  assigneeDisplayName: null,
  assigneeUserId: null,
  authorDisplayName: null,
  authorUserId: null,
  completedAt: null,
  createdAt: '2026-05-09T09:00:00.000Z',
  dueDate: null,
  icon: '',
  id: 'task-1',
  importance: 'not_important',
  necessity: 'desired',
  note: '',
  plannedDate: '2026-05-09',
  plannedEndTime: null,
  plannedStartTime: null,
  project: '',
  projectId: null,
  remindBeforeStart: undefined,
  requiresConfirmation: false,
  resource: null,
  sphereId: null,
  status: 'todo',
  title: 'Widget task',
  urgency: 'not_urgent',
}

describe('NativePlannerWidgetSync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ackPendingNativePlannerWidgetCompletedTasks.mockResolvedValue(
      undefined,
    )
    mocks.addNativePlannerWidgetResumeListener.mockResolvedValue({
      remove: vi.fn(),
    })
    mocks.buildNativePlannerWidgetSnapshot.mockReturnValue({
      dateKey: '2026-05-09',
      doneTodayCount: 0,
      generatedAt: '2026-05-09T09:00:00.000Z',
      hiddenCleaningTaskCount: 0,
      hiddenSelfCareTaskCount: 0,
      hiddenTaskCount: 0,
      overdueCount: 0,
      tasks: [],
      todayCount: 0,
      version: 5,
    })
    mocks.consumePendingNativePlannerWidgetRoute.mockResolvedValue(null)
    mocks.configureNativePlannerWidgetBackgroundSync.mockResolvedValue(
      undefined,
    )
    mocks.disableNativePlannerWidgetBackgroundSync.mockResolvedValue(undefined)
    mocks.isAndroidPlannerWidgetRuntime.mockReturnValue(true)
    mocks.persistNativePlannerWidgetSnapshot.mockResolvedValue(undefined)
    mocks.readPendingNativePlannerWidgetCompletedTasks.mockResolvedValue([])
    mocks.createPlannerApiClient.mockReturnValue({
      getTaskReadModel: vi.fn().mockResolvedValue({ items: [] }),
      listLifeSpheres: vi.fn().mockResolvedValue([]),
      setTaskStatus: vi.fn(),
    })
    mocks.completeCleaningTask.mockResolvedValue({})
    mocks.queueCleaningTaskCompletion.mockImplementation((input) =>
      Promise.resolve({
        operationId: '0198a620-1d00-7000-8000-000000000001',
        queued: true,
        today: input.today,
      }),
    )
    mocks.createCleaningApiClient.mockReturnValue({
      completeTask: mocks.completeCleaningTask,
      getToday: vi.fn().mockResolvedValue({ generalItems: [], items: [] }),
    })
    mocks.createSelfCareApiClient.mockReturnValue({
      getDashboard: vi.fn().mockResolvedValue({
        flexibleGoals: [],
        overdueItems: [],
        todayItems: [],
      }),
    })
    mocks.enqueuePlannerOfflineMutation.mockResolvedValue(null)
    mocks.loadCachedLifeSphereRecords.mockResolvedValue([])
    mocks.loadCachedTaskRecords.mockResolvedValue([])
    mocks.replaceCachedLifeSphereRecords.mockResolvedValue(undefined)
    mocks.replaceCachedTaskRecords.mockResolvedValue(undefined)
    mocks.upsertCachedTaskRecord.mockResolvedValue(undefined)
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createSessionFeatureReadinessStub(createSessionStub('personal')),
    )
    mocks.useSessionAuth.mockReturnValue({
      lifecycleStatus: 'authenticated',
      sessionVersion: 1,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('configures native background sync for the personal workspace', async () => {
    mocks.usePlanner.mockReturnValue(createPlannerStub())

    renderSync()

    await waitFor(() => {
      expect(
        mocks.configureNativePlannerWidgetBackgroundSync,
      ).toHaveBeenCalledWith({
        apiBaseUrl: 'http://localhost:3000',
        timeZone: 'Europe/Astrakhan',
        workspaceId: 'personal-workspace',
      })
    })
  })

  it('refetches planner, self-care, and cleaning data when the app resumes', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const getToday = vi.fn().mockResolvedValue({ generalItems: [], items: [] })
    const getDashboard = vi.fn().mockResolvedValue({
      flexibleGoals: [],
      overdueItems: [],
      todayItems: [],
    })

    mocks.usePlanner.mockReturnValue(createPlannerStub({ refresh }))
    mocks.createCleaningApiClient.mockReturnValue({
      completeTask: mocks.completeCleaningTask,
      getToday,
    })
    mocks.createSelfCareApiClient.mockReturnValue({ getDashboard })

    renderSync()

    await waitFor(() => {
      expect(mocks.addNativePlannerWidgetResumeListener).toHaveBeenCalled()
      expect(getToday).toHaveBeenCalled()
      expect(getDashboard).toHaveBeenCalled()
    })
    refresh.mockClear()
    getToday.mockClear()
    getDashboard.mockClear()

    const resumeListener =
      mocks.addNativePlannerWidgetResumeListener.mock.calls[0]?.[0]

    if (!resumeListener) {
      throw new Error('Expected Android widget resume listener.')
    }

    resumeListener()

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledTimes(1)
      expect(getToday).toHaveBeenCalledTimes(1)
      expect(getDashboard).toHaveBeenCalledTimes(1)
    })
  })

  it('acknowledges widget completions after a successful task update', async () => {
    const setTaskStatus = vi.fn().mockResolvedValue(true)

    mocks.readPendingNativePlannerWidgetCompletedTasks.mockResolvedValue([
      'task-1',
    ])
    mocks.usePlanner.mockReturnValue(createPlannerStub({ setTaskStatus }))

    renderSync()

    await waitFor(() => {
      expect(setTaskStatus).toHaveBeenCalledWith('task-1', 'done')
    })
    await waitFor(() => {
      expect(
        mocks.ackPendingNativePlannerWidgetCompletedTasks,
      ).toHaveBeenCalledWith(['task-1'])
    })
  })

  it('keeps failed widget completions pending and does not overwrite the widget snapshot', async () => {
    const setTaskStatus = vi.fn().mockResolvedValue(false)

    mocks.readPendingNativePlannerWidgetCompletedTasks.mockResolvedValue([
      'task-1',
    ])
    mocks.usePlanner.mockReturnValue(createPlannerStub({ setTaskStatus }))

    renderSync()

    await waitFor(() => {
      expect(setTaskStatus).toHaveBeenCalledWith('task-1', 'done')
    })
    await Promise.resolve()

    expect(
      mocks.ackPendingNativePlannerWidgetCompletedTasks,
    ).not.toHaveBeenCalled()
    expect(mocks.persistNativePlannerWidgetSnapshot).not.toHaveBeenCalled()
  })

  it('acknowledges pending ids that are already completed locally', async () => {
    const setTaskStatus = vi.fn()

    mocks.readPendingNativePlannerWidgetCompletedTasks.mockResolvedValue([
      'task-1',
    ])
    mocks.usePlanner.mockReturnValue(
      createPlannerStub({
        setTaskStatus,
        tasks: [{ ...baseTask, status: 'done' }],
      }),
    )

    renderSync()

    await waitFor(() => {
      expect(
        mocks.ackPendingNativePlannerWidgetCompletedTasks,
      ).toHaveBeenCalledWith(['task-1'])
    })
    expect(setTaskStatus).not.toHaveBeenCalled()
  })

  it('builds the widget from personal workspace tasks when a shared workspace is open', async () => {
    const personalTask = createTaskRecord({
      id: 'personal-task',
      title: 'Personal task',
      workspaceId: 'personal-workspace',
    })
    const getTaskReadModel = vi.fn().mockResolvedValue({
      items: [personalTask],
    })
    const listLifeSpheres = vi.fn().mockResolvedValue([])

    mocks.createPlannerApiClient.mockReturnValue({
      getTaskReadModel,
      listLifeSpheres,
      setTaskStatus: vi.fn(),
    })
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createSessionFeatureReadinessStub(createSessionStub('shared')),
    )
    mocks.usePlanner.mockReturnValue(
      createPlannerStub({
        tasks: [{ ...baseTask, id: 'shared-task', title: 'Shared task' }],
      }),
    )

    renderSync()

    await waitFor(() => {
      expect(mocks.buildNativePlannerWidgetSnapshot).toHaveBeenCalled()
    })
    const buildCall = mocks.buildNativePlannerWidgetSnapshot.mock.calls.at(-1)
    const supplementalData = buildCall?.[3]

    expect(buildCall?.[0][0]?.id).toBe('personal-task')
    expect(buildCall?.[1]).toEqual([])
    expect(buildCall?.[2]).toBeUndefined()
    expect(isRecord(supplementalData)).toBe(true)

    if (!isRecord(supplementalData)) {
      throw new Error('Expected widget supplemental data.')
    }

    expect(isRecord(supplementalData.cleaning)).toBe(true)
    expect(isRecord(supplementalData.selfCare)).toBe(true)
  })

  it('acknowledges personal widget completions while a shared workspace is open', async () => {
    const personalTask = createTaskRecord({
      id: 'personal-task',
      title: 'Personal task',
      workspaceId: 'personal-workspace',
    })
    const completedPersonalTask = {
      ...personalTask,
      completedAt: '2026-05-09T10:00:00.000Z',
      status: 'done' as const,
      updatedAt: '2026-05-09T10:00:00.000Z',
      version: 2,
    }
    const setTaskStatus = vi.fn().mockResolvedValue(completedPersonalTask)

    mocks.createPlannerApiClient.mockReturnValue({
      getTaskReadModel: vi.fn().mockResolvedValue({
        items: [personalTask],
      }),
      listLifeSpheres: vi.fn().mockResolvedValue([]),
      setTaskStatus,
    })
    mocks.readPendingNativePlannerWidgetCompletedTasks.mockResolvedValue([
      'personal-task',
    ])
    mocks.useSessionFeatureReadiness.mockReturnValue(
      createSessionFeatureReadinessStub(createSessionStub('shared')),
    )
    mocks.usePlanner.mockReturnValue(
      createPlannerStub({
        tasks: [{ ...baseTask, id: 'shared-task', title: 'Shared task' }],
      }),
    )

    renderSync()

    await waitFor(() => {
      expect(setTaskStatus).toHaveBeenCalledWith('personal-task', {
        expectedVersion: 1,
        status: 'done',
      })
    })
    await waitFor(() => {
      expect(
        mocks.ackPendingNativePlannerWidgetCompletedTasks,
      ).toHaveBeenCalledWith(['personal-task'])
    })
    expect(mocks.enqueuePlannerOfflineMutation).not.toHaveBeenCalled()
  })

  it('completes and acknowledges cleaning tasks queued by the widget', async () => {
    const cleaningApi = {
      completeTask: mocks.completeCleaningTask,
      getToday: vi.fn().mockResolvedValue({
        generalItems: [],
        items: [{ task: { id: 'kitchen' } }],
      }),
    }
    mocks.createCleaningApiClient.mockReturnValue(cleaningApi)
    mocks.readPendingNativePlannerWidgetCompletedTasks.mockResolvedValue([
      'cleaning:kitchen',
    ])
    mocks.usePlanner.mockReturnValue(createPlannerStub())

    renderSync()

    await waitFor(() => {
      expect(mocks.queueCleaningTaskCompletion).toHaveBeenCalled()
    })
    const queuedCompletion =
      mocks.queueCleaningTaskCompletion.mock.calls[0]?.[0]
    expect(queuedCompletion).toMatchObject({
      actorUserId: 'actor-user-1',
      taskId: 'kitchen',
      workspaceId: 'personal-workspace',
    })
    expect(queuedCompletion?.api).toBe(cleaningApi)
    expect(queuedCompletion?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(mocks.completeCleaningTask).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(
        mocks.ackPendingNativePlannerWidgetCompletedTasks,
      ).toHaveBeenCalledWith(['cleaning:kitchen'])
    })
  })
})

function renderSync() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <NativePlannerWidgetSync />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function createSessionStub(kind: 'personal' | 'shared'): PlannerSessionStub {
  const workspaceId =
    kind === 'personal' ? 'personal-workspace' : 'shared-workspace'

  return {
    actorUserId: 'actor-user-1',
    workspace: {
      id: workspaceId,
      kind,
    },
    workspaceId,
    workspaces: [
      {
        id: 'personal-workspace',
        kind: 'personal',
      },
      {
        id: 'shared-workspace',
        kind: 'shared',
      },
    ],
  }
}

function createSessionFeatureReadinessStub(session: PlannerSessionStub) {
  return {
    apiConfig: {
      accessToken: 'access-token',
      actorUserId: session.actorUserId,
      apiBaseUrl: 'http://localhost:3000',
      clientTimeZone: 'Europe/Astrakhan',
      workspaceId: session.workspaceId,
    },
    session,
  }
}

function createPlannerStub(
  overrides: {
    isLoading?: boolean
    isSyncing?: boolean
    refresh?: () => Promise<void>
    setTaskStatus?: (taskId: string, status: 'done') => Promise<boolean>
    tasks?: Task[]
  } = {},
): PlannerStub {
  return {
    isLoading: false,
    isSyncing: false,
    refresh: vi.fn().mockResolvedValue(undefined),
    setTaskStatus: vi.fn().mockResolvedValue(true),
    spheres: [],
    tasks: [baseTask],
    ...overrides,
  }
}

function createTaskRecord(
  overrides: Partial<TaskRecord> & Pick<TaskRecord, 'id' | 'title'>,
): TaskRecord {
  return {
    ...baseTask,
    ...overrides,
    deletedAt: null,
    updatedAt: '2026-05-09T09:00:00.000Z',
    version: 1,
    workspaceId: overrides.workspaceId ?? 'personal-workspace',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
