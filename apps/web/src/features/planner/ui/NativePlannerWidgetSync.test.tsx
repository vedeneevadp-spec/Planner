import type { TaskRecord } from '@planner/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Task } from '@/entities/task'

import { NativePlannerWidgetSync } from './NativePlannerWidgetSync'

interface PlannerStub {
  isLoading: boolean
  isSyncing: boolean
  setTaskStatus: (taskId: string, status: 'done') => Promise<boolean>
  spheres: []
  tasks: Task[]
}

interface SessionAuthStub {
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
    vi.fn<(tasks: Task[], spheres: unknown[]) => unknown>(),
  consumePendingNativePlannerWidgetRoute: vi.fn<() => Promise<string | null>>(),
  isAndroidPlannerWidgetRuntime: vi.fn<() => boolean>(),
  persistNativePlannerWidgetSnapshot:
    vi.fn<(snapshot: unknown) => Promise<void>>(),
  readPendingNativePlannerWidgetCompletedTasks:
    vi.fn<() => Promise<string[]>>(),
  createPlannerApiClient: vi.fn<() => unknown>(),
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
  buildNativePlannerWidgetSnapshot: (tasks: Task[], spheres: unknown[]) =>
    mocks.buildNativePlannerWidgetSnapshot(tasks, spheres),
  consumePendingNativePlannerWidgetRoute: () =>
    mocks.consumePendingNativePlannerWidgetRoute(),
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
      hiddenTaskCount: 0,
      overdueCount: 0,
      tasks: [],
      todayCount: 0,
      version: 4,
    })
    mocks.consumePendingNativePlannerWidgetRoute.mockResolvedValue(null)
    mocks.isAndroidPlannerWidgetRuntime.mockReturnValue(true)
    mocks.persistNativePlannerWidgetSnapshot.mockResolvedValue(undefined)
    mocks.readPendingNativePlannerWidgetCompletedTasks.mockResolvedValue([])
    mocks.createPlannerApiClient.mockReturnValue({
      listLifeSpheres: vi.fn().mockResolvedValue([]),
      listTasks: vi.fn().mockResolvedValue([]),
      setTaskStatus: vi.fn(),
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
      sessionVersion: 1,
    })
  })

  afterEach(() => {
    cleanup()
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
    const listTasks = vi.fn().mockResolvedValue([personalTask])
    const listLifeSpheres = vi.fn().mockResolvedValue([])

    mocks.createPlannerApiClient.mockReturnValue({
      listLifeSpheres,
      listTasks,
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
      expect(mocks.buildNativePlannerWidgetSnapshot).toHaveBeenCalledWith(
        [expect.objectContaining({ id: 'personal-task' })],
        [],
      )
    })
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
      listLifeSpheres: vi.fn().mockResolvedValue([]),
      listTasks: vi.fn().mockResolvedValue([personalTask]),
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
    setTaskStatus?: (taskId: string, status: 'done') => Promise<boolean>
    tasks?: Task[]
  } = {},
): PlannerStub {
  return {
    isLoading: false,
    isSyncing: false,
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
