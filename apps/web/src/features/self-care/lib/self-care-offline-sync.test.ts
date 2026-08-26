import 'fake-indexeddb/auto'

import {
  generateUuidV7,
  type SelfCareOfflineCommand,
  type SelfCareOfflineCommandResult,
} from '@planner/contracts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearSelfCareOfflineWorkspaceData,
  enqueueSelfCareOfflineMutation,
  getSelfCareOfflineWorkspaceWriteGeneration,
  listSelfCareOfflineMutations,
  markSelfCareOfflineMutationAwaitingRefresh,
  resetSelfCareOfflineDatabaseForTests,
  SELF_CARE_ORPHANED_DEPENDENCY_ERROR_CODE,
} from './offline-self-care-store'
import { type SelfCareApiClient, SelfCareApiError } from './self-care-api'
import {
  classifySelfCareOfflineSyncError,
  drainSelfCareOfflineQueue,
  enqueueAndDrainSelfCareOfflineMutation,
  isQueueableSelfCareMutationError,
} from './self-care-offline-sync'

const WORKSPACE_ID = 'workspace-1'
const ACTOR_USER_ID = 'user-1'

describe('self-care offline drain', () => {
  beforeEach(async () => {
    await resetSelfCareOfflineDatabaseForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('durably enqueues a command before the first network send and retains the server overlay', async () => {
    const operationId = generateUuidV7()
    const executeOfflineCommand = vi.fn(async () => {
      await expect(
        listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
      ).resolves.toEqual([
        expect.objectContaining({ operationId, status: 'syncing' }),
      ])

      return createResponse(operationId, 'EUR')
    })
    const api = createApi(executeOfflineCommand)

    const result = await enqueueAndDrainSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      api,
      command: createCommand('USD'),
      occurredAt: '2026-08-06T08:00:00.000Z',
      operationId,
      optimisticResult: createResult('USD'),
      workspaceId: WORKSPACE_ID,
    })

    expect(result?.drain).toMatchObject({ awaitingRefresh: 1, failed: 0 })
    await expect(
      listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([
      expect.objectContaining({
        operationId,
        serverResult: createResult('EUR'),
        status: 'awaiting_refresh',
      }),
    ])
  })

  it('replays the same operation id after a lost response', async () => {
    const operationId = generateUuidV7()
    const executeOfflineCommand = vi
      .fn<SelfCareApiClient['executeOfflineCommand']>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(createResponse(operationId, 'USD', true))
    const api = createApi(executeOfflineCommand)
    await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createCommand('USD'),
      occurredAt: '2026-08-06T08:00:00.000Z',
      operationId,
      optimisticResult: createResult('USD'),
      workspaceId: WORKSPACE_ID,
    })

    await expect(
      drainSelfCareOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toMatchObject({ failed: 1 })
    await expect(
      drainSelfCareOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toMatchObject({ awaitingRefresh: 1 })

    expect(
      executeOfflineCommand.mock.calls.map(([request]) => request.operationId),
    ).toEqual([operationId, operationId])
  })

  it('turns an orphaned dependency into an actionable conflict instead of a silent no-op', async () => {
    const operationId = generateUuidV7()
    await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createCommand('USD'),
      dependsOn: [generateUuidV7()],
      occurredAt: '2026-08-06T08:00:00.000Z',
      operationId,
      optimisticResult: createResult('USD'),
      workspaceId: WORKSPACE_ID,
    })
    const executeOfflineCommand =
      vi.fn<SelfCareApiClient['executeOfflineCommand']>()

    await expect(
      drainSelfCareOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api: createApi(executeOfflineCommand),
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toMatchObject({ conflicted: 1, processed: 0 })
    expect(executeOfflineCommand).not.toHaveBeenCalled()
    const [orphanedMutation] = await listSelfCareOfflineMutations(
      WORKSPACE_ID,
      ACTOR_USER_ID,
    )
    expect(orphanedMutation).toMatchObject({
      dependsOn: [],
      operationId,
      status: 'conflicted',
    })
    expect(orphanedMutation?.conflict?.code).toBe(
      SELF_CARE_ORPHANED_DEPENDENCY_ERROR_CODE,
    )
  })

  it('is single-flight for the same actor and workspace', async () => {
    const operationId = generateUuidV7()
    let resolveRequest:
      ((value: ReturnType<typeof createResponse>) => void) | null = null
    const request = new Promise<ReturnType<typeof createResponse>>(
      (resolve) => {
        resolveRequest = resolve
      },
    )
    const executeOfflineCommand = vi.fn(() => request)
    const api = createApi(executeOfflineCommand)
    await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createCommand('USD'),
      occurredAt: '2026-08-06T08:00:00.000Z',
      operationId,
      optimisticResult: createResult('USD'),
      workspaceId: WORKSPACE_ID,
    })

    const first = drainSelfCareOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })
    const second = drainSelfCareOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })
    await vi.waitFor(() =>
      expect(executeOfflineCommand).toHaveBeenCalledTimes(1),
    )
    resolveRequest!(createResponse(operationId, 'USD'))

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ awaitingRefresh: 1 }),
      expect.objectContaining({ awaitingRefresh: 1 }),
    ])
    expect(executeOfflineCommand).toHaveBeenCalledTimes(1)
  })

  it('waits for the cross-tab lock and rereads dependencies before sending', async () => {
    const parentOperationId = generateUuidV7()
    const childOperationId = generateUuidV7()
    const parent = await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createCommand('USD'),
      occurredAt: '2026-08-06T08:00:00.000Z',
      operationId: parentOperationId,
      optimisticResult: createResult('USD'),
      workspaceId: WORKSPACE_ID,
    })
    await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createCommand('EUR', 2),
      dependsOn: [parent!.id],
      occurredAt: '2026-08-06T08:01:00.000Z',
      operationId: childOperationId,
      optimisticResult: createResult('EUR'),
      workspaceId: WORKSPACE_ID,
    })

    let releaseLock: (() => void) | null = null
    const lockAvailable = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const requestLock = vi.fn(
      async (
        _name: string,
        _options: { mode: 'exclusive' },
        run: () => Promise<unknown>,
      ) => {
        await lockAvailable
        return run()
      },
    )
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { request: requestLock },
    })
    const executeOfflineCommand = vi.fn<
      SelfCareApiClient['executeOfflineCommand']
    >((request) => Promise.resolve(createResponse(request.operationId, 'EUR')))
    const drain = drainSelfCareOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api: createApi(executeOfflineCommand),
      workspaceId: WORKSPACE_ID,
    })
    await vi.waitFor(() => expect(requestLock).toHaveBeenCalledTimes(1))

    await markSelfCareOfflineMutationAwaitingRefresh(
      parent!.id,
      WORKSPACE_ID,
      ACTOR_USER_ID,
      getSelfCareOfflineWorkspaceWriteGeneration(WORKSPACE_ID),
      createResult('USD'),
    )
    releaseLock!()

    await expect(drain).resolves.toMatchObject({
      awaitingRefresh: 1,
      processed: 1,
    })
    expect(executeOfflineCommand).toHaveBeenCalledTimes(1)
    expect(executeOfflineCommand).toHaveBeenCalledWith({
      command: createCommand('EUR', 2),
      operationId: childOperationId,
    })
    expect(requestLock).toHaveBeenCalledWith(
      `self-care-offline-drain:${WORKSPACE_ID}:${ACTOR_USER_ID}`,
      { mode: 'exclusive' },
      expect.any(Function),
    )
  })

  it('does not replay conflicts automatically and blocks dependent commands', async () => {
    const parentOperationId = generateUuidV7()
    const childOperationId = generateUuidV7()
    const parent = await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createCommand('USD'),
      occurredAt: '2026-08-06T08:00:00.000Z',
      operationId: parentOperationId,
      optimisticResult: createResult('USD'),
      workspaceId: WORKSPACE_ID,
    })
    await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createCommand('EUR', 2),
      dependsOn: [parent!.id],
      occurredAt: '2026-08-06T08:01:00.000Z',
      operationId: childOperationId,
      optimisticResult: createResult('EUR'),
      workspaceId: WORKSPACE_ID,
    })
    const conflict = new SelfCareApiError('Конфликт версии', {
      code: 'self_care_version_conflict',
      details: {
        actualVersion: 3,
        entityId: 'settings-1',
        entityType: 'settings',
        expectedVersion: 1,
      },
      status: 409,
    })
    const executeOfflineCommand = vi.fn().mockRejectedValue(conflict)
    const api = createApi(executeOfflineCommand)

    await expect(
      drainSelfCareOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toMatchObject({ conflicted: 1, processed: 1 })
    const [conflictedMutation] = await listSelfCareOfflineMutations(
      WORKSPACE_ID,
      ACTOR_USER_ID,
    )
    expect(conflictedMutation?.conflict?.code).toBe(
      'self_care_version_conflict',
    )
    await expect(
      drainSelfCareOfflineQueue({
        actorUserId: ACTOR_USER_ID,
        api,
        workspaceId: WORKSPACE_ID,
      }),
    ).resolves.toMatchObject({ processed: 0 })
    expect(executeOfflineCommand).toHaveBeenCalledTimes(1)
  })

  it('drops a delayed successful response after workspace cleanup', async () => {
    const operationId = generateUuidV7()
    let resolveRequest:
      ((value: ReturnType<typeof createResponse>) => void) | null = null
    const executeOfflineCommand = vi.fn(
      () =>
        new Promise<ReturnType<typeof createResponse>>((resolve) => {
          resolveRequest = resolve
        }),
    )
    const api = createApi(executeOfflineCommand)
    await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createCommand('USD'),
      occurredAt: '2026-08-06T08:00:00.000Z',
      operationId,
      optimisticResult: createResult('USD'),
      workspaceId: WORKSPACE_ID,
    })
    const drain = drainSelfCareOfflineQueue({
      actorUserId: ACTOR_USER_ID,
      api,
      workspaceId: WORKSPACE_ID,
    })
    await vi.waitFor(() =>
      expect(executeOfflineCommand).toHaveBeenCalledTimes(1),
    )

    await clearSelfCareOfflineWorkspaceData(WORKSPACE_ID)
    resolveRequest!(createResponse(operationId, 'USD'))
    await drain

    await expect(
      listSelfCareOfflineMutations(WORKSPACE_ID, ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it.each([
    [400, 'terminal'],
    [401, 'retryable'],
    [403, 'terminal'],
    [404, 'terminal'],
    [408, 'retryable'],
    [409, 'terminal'],
    [418, 'terminal'],
    [422, 'terminal'],
    [425, 'retryable'],
    [429, 'retryable'],
    [499, 'terminal'],
    [500, 'retryable'],
    [599, 'retryable'],
    [600, 'terminal'],
  ] as const)(
    'classifies HTTP %i as %s without retrying semantic 4xx failures',
    (status, expected) => {
      const error = new SelfCareApiError('failure', {
        code: 'request_failed',
        status,
      })

      expect(classifySelfCareOfflineSyncError(error)).toBe(expected)
      expect(isQueueableSelfCareMutationError(error)).toBe(
        expected === 'retryable',
      )
    },
  )

  it('retries transport failures but treats non-transport client failures as terminal', () => {
    const createError = (status: number, code = 'request_failed') =>
      new SelfCareApiError('failure', { code, status })

    expect(classifySelfCareOfflineSyncError(createError(401))).toBe('retryable')
    expect(classifySelfCareOfflineSyncError(createError(500))).toBe('retryable')
    expect(
      classifySelfCareOfflineSyncError(new TypeError('fetch failed')),
    ).toBe('retryable')
    expect(
      classifySelfCareOfflineSyncError(
        new DOMException('timed out', 'TimeoutError'),
      ),
    ).toBe('retryable')
    expect(classifySelfCareOfflineSyncError(new Error('invalid command'))).toBe(
      'terminal',
    )
  })
})

function createCommand(
  currency: string,
  expectedVersion = 1,
): SelfCareOfflineCommand {
  return {
    expectedVersion,
    input: { currency },
    type: 'update_settings',
  }
}

function createResult(currency: string): SelfCareOfflineCommandResult {
  return {
    kind: 'settings',
    value: {
      minimumItems: [],
      settings: {
        createdAt: '2026-08-06T08:00:00.000Z',
        currency,
        defaultReminderTone: 'soft',
        gentleModeDate: null,
        gentleModeEnabledToday: false,
        id: 'settings-1',
        quietHoursEnd: null,
        quietHoursStart: null,
        showAppointmentsInCalendar: true,
        showSelfCareInMainTasks: true,
        updatedAt: '2026-08-06T08:00:00.000Z',
        userId: ACTOR_USER_ID,
        version: 2,
      },
    },
  }
}

function createResponse(
  operationId: string,
  currency: string,
  replayed = false,
) {
  return { operationId, replayed, result: createResult(currency) }
}

function createApi(
  executeOfflineCommand: (
    input: Parameters<SelfCareApiClient['executeOfflineCommand']>[0],
  ) => ReturnType<SelfCareApiClient['executeOfflineCommand']>,
): SelfCareApiClient {
  return { executeOfflineCommand } as SelfCareApiClient
}
