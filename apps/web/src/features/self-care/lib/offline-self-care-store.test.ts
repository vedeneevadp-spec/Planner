import 'fake-indexeddb/auto'

import {
  generateUuidV7,
  type SelfCareOfflineCommand,
  type SelfCareOfflineCommandResult,
} from '@planner/contracts'
import Dexie from 'dexie'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  applySelfCareOfflineOverlays,
  cancelSelfCareOfflineMutation,
  clearSelfCareOfflineWorkspaceData,
  completeSelfCareOfflineMutation,
  countSelfCareOfflineMutations,
  createSelfCareCacheKey,
  enqueueSelfCareOfflineMutation,
  getSelfCareOfflineStorageHealth,
  getSelfCareOfflineWorkspaceWriteGeneration,
  listSelfCareOfflineMutations,
  loadCachedSelfCareRead,
  loadProjectedCachedSelfCareRead,
  markSelfCareOfflineMutationAwaitingRefresh,
  markSelfCareOfflineMutationConflicted,
  probeSelfCareOfflineStorage,
  reportSelfCareOfflineStorageFailure,
  resetSelfCareOfflineDatabaseForTests,
  resetSelfCareOfflineRuntimeForTests,
  retrySelfCareOfflineMutation,
  saveCachedSelfCareRead,
  SELF_CARE_OFFLINE_DATABASE_NAME,
  SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX,
  SELF_CARE_OFFLINE_SCHEMA_VERSION,
  SelfCareOfflineMutationCollisionError,
  SelfCareOfflinePurgeUnavailableError,
  updateCachedSelfCareReadDataIfUnchanged,
} from './offline-self-care-store'

const ACTOR_USER_ID = 'user-1'

describe('offline self-care read cache', () => {
  beforeEach(async () => {
    await resetSelfCareOfflineDatabaseForTests()
  })

  it('persists a read model together with its successful server sync time', async () => {
    const cacheKey = createSelfCareCacheKey('dashboard', ['2026-08-06'])

    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'dashboard',
      cacheKey,
      { date: '2026-08-06', todayItems: [] },
      '2026-08-06T08:30:00.000Z',
    )

    await expect(
      loadCachedSelfCareRead('workspace-1', ACTOR_USER_ID, cacheKey),
    ).resolves.toEqual({
      data: { date: '2026-08-06', todayItems: [] },
      lastSuccessfulSyncAt: '2026-08-06T08:30:00.000Z',
    })
  })

  it('keeps workspaces isolated and clears only the selected workspace', async () => {
    const cacheKey = createSelfCareCacheKey('items')

    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'items',
      cacheKey,
      {
        items: ['first'],
      },
    )
    await saveCachedSelfCareRead(
      'workspace-2',
      ACTOR_USER_ID,
      'items',
      cacheKey,
      {
        items: ['second'],
      },
    )

    await clearSelfCareOfflineWorkspaceData('workspace-1')

    await expect(
      loadCachedSelfCareRead('workspace-1', ACTOR_USER_ID, cacheKey),
    ).resolves.toBeNull()
    await expect(
      loadCachedSelfCareRead('workspace-2', ACTOR_USER_ID, cacheKey),
    ).resolves.toMatchObject({ data: { items: ['second'] } })
  })

  it('opens the explicit current schema', async () => {
    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'items',
      createSelfCareCacheKey('items'),
      { items: [] },
    )

    const db = new Dexie(SELF_CARE_OFFLINE_DATABASE_NAME)
    await db.open()

    expect(db.verno).toBe(SELF_CARE_OFFLINE_SCHEMA_VERSION)
    db.close()
  })

  it('bounds dated cache rows while retaining the newest reads', async () => {
    for (let day = 1; day <= 9; day += 1) {
      const date = `2026-08-${String(day).padStart(2, '0')}`
      await saveCachedSelfCareRead(
        'workspace-1',
        ACTOR_USER_ID,
        'dashboard',
        createSelfCareCacheKey('dashboard', [date]),
        { date },
        `${date}T08:00:00.000Z`,
      )
    }

    await expect(
      loadCachedSelfCareRead(
        'workspace-1',
        ACTOR_USER_ID,
        createSelfCareCacheKey('dashboard', ['2026-08-01']),
      ),
    ).resolves.toBeNull()
    await expect(
      loadCachedSelfCareRead(
        'workspace-1',
        ACTOR_USER_ID,
        createSelfCareCacheKey('dashboard', ['2026-08-09']),
      ),
    ).resolves.toMatchObject({ data: { date: '2026-08-09' } })
  })

  it('never exposes one actor cache to another actor in the same workspace', async () => {
    const cacheKey = createSelfCareCacheKey('items')
    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'items',
      cacheKey,
      { items: ['private'] },
    )

    await expect(
      loadCachedSelfCareRead('workspace-1', 'user-2', cacheKey),
    ).resolves.toBeNull()
  })

  it('clears legacy rows without an actor during the schema upgrade', async () => {
    const legacyDatabase = new Dexie(SELF_CARE_OFFLINE_DATABASE_NAME)
    legacyDatabase.version(1).stores({
      cachedReads:
        'key, workspaceId, scope, lastSuccessfulSyncAt, [workspaceId+scope]',
    })
    await legacyDatabase.open()
    await legacyDatabase.table('cachedReads').put({
      data: { items: ['private'] },
      key: 'items',
      lastSuccessfulSyncAt: '2026-08-06T08:30:00.000Z',
      scope: 'items',
      workspaceId: 'workspace-1',
    })
    legacyDatabase.close()

    await expect(
      loadCachedSelfCareRead(
        'workspace-1',
        ACTOR_USER_ID,
        createSelfCareCacheKey('items'),
      ),
    ).resolves.toBeNull()

    const upgradedDatabase = new Dexie(SELF_CARE_OFFLINE_DATABASE_NAME)
    await upgradedDatabase.open()
    await expect(upgradedDatabase.table('cachedReads').count()).resolves.toBe(0)
    upgradedDatabase.close()
  })

  it('does not let a late projection overwrite a newer server snapshot', async () => {
    const cacheKey = createSelfCareCacheKey('items')
    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'items',
      cacheKey,
      { revision: 'old' },
      '2026-08-06T08:00:00.000Z',
    )
    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'items',
      cacheKey,
      { revision: 'new' },
      '2026-08-06T09:00:00.000Z',
    )

    await expect(
      updateCachedSelfCareReadDataIfUnchanged(
        'workspace-1',
        ACTOR_USER_ID,
        cacheKey,
        '2026-08-06T08:00:00.000Z',
        { revision: 'projected-old' },
      ),
    ).resolves.toBeNull()
    await expect(
      loadCachedSelfCareRead('workspace-1', ACTOR_USER_ID, cacheKey),
    ).resolves.toMatchObject({ data: { revision: 'new' } })
  })

  it('keeps a newer server snapshot when an older request finishes later', async () => {
    const workspaceId = 'workspace-1'
    const cacheKey = createSelfCareCacheKey('items')
    const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)
    await saveCachedSelfCareRead(
      workspaceId,
      ACTOR_USER_ID,
      'items',
      cacheKey,
      { revision: 'newer' },
      '2026-08-06T08:32:00.000Z',
      generation,
      200,
    )
    const staleWrite = await saveCachedSelfCareRead(
      workspaceId,
      ACTOR_USER_ID,
      'items',
      cacheKey,
      { revision: 'older' },
      '2026-08-06T08:33:00.000Z',
      generation,
      100,
    )

    expect(staleWrite).toEqual({
      data: { revision: 'newer' },
      lastSuccessfulSyncAt: '2026-08-06T08:32:00.000Z',
    })
    await expect(
      loadCachedSelfCareRead(workspaceId, ACTOR_USER_ID, cacheKey),
    ).resolves.toEqual(staleWrite)
  })

  it('does not resurrect a server read returned after workspace cleanup', async () => {
    const cacheKey = createSelfCareCacheKey('items')
    const requestGeneration =
      getSelfCareOfflineWorkspaceWriteGeneration('workspace-1')

    await clearSelfCareOfflineWorkspaceData('workspace-1')
    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'items',
      cacheKey,
      { items: ['late'] },
      '2026-08-06T10:00:00.000Z',
      requestGeneration,
    )

    await expect(
      loadCachedSelfCareRead('workspace-1', ACTOR_USER_ID, cacheKey),
    ).resolves.toBeNull()
  })

  it('clears version-two cached reads that do not contain versioned self-care entities', async () => {
    const legacyDatabase = new Dexie(SELF_CARE_OFFLINE_DATABASE_NAME)
    legacyDatabase.version(2).stores({
      cachedReads:
        'key, workspaceId, actorUserId, scope, lastSuccessfulSyncAt, [workspaceId+actorUserId], [workspaceId+actorUserId+scope]',
    })
    await legacyDatabase.open()
    await legacyDatabase.table('cachedReads').put({
      actorUserId: ACTOR_USER_ID,
      data: { items: [{ id: 'legacy-unversioned' }] },
      key: 'workspace-1:user-1:items',
      lastSuccessfulSyncAt: '2026-08-06T08:30:00.000Z',
      scope: 'items',
      valueVersion: 1,
      workspaceId: 'workspace-1',
    })
    legacyDatabase.close()

    await expect(
      loadCachedSelfCareRead(
        'workspace-1',
        ACTOR_USER_ID,
        createSelfCareCacheKey('items'),
      ),
    ).resolves.toBeNull()

    const upgradedDatabase = new Dexie(SELF_CARE_OFFLINE_DATABASE_NAME)
    await upgradedDatabase.open()
    await expect(upgradedDatabase.table('cachedReads').count()).resolves.toBe(0)
    upgradedDatabase.close()
  })

  it('keeps queued commands isolated by actor and workspace with monotonic sequence', async () => {
    const first = await enqueueMutation('workspace-1', 'user-1', 'USD')
    const second = await enqueueMutation('workspace-1', 'user-1', 'EUR')
    await enqueueMutation('workspace-1', 'user-2', 'GBP')
    await enqueueMutation('workspace-2', 'user-1', 'CNY')

    expect(first?.sequence).toBe(1)
    expect(second?.sequence).toBe(2)
    await expect(
      listSelfCareOfflineMutations('workspace-1', 'user-1'),
    ).resolves.toEqual([
      expect.objectContaining({ sequence: 1 }),
      expect.objectContaining({ sequence: 2 }),
    ])
    await expect(
      countSelfCareOfflineMutations('workspace-1', 'user-1'),
    ).resolves.toMatchObject({ pending: 2, total: 2 })
  })

  it('counts current and legacy closed-occurrence conflicts separately', async () => {
    const current = await enqueueMutation('workspace-1', ACTOR_USER_ID, 'USD')
    const legacy = await enqueueMutation('workspace-1', ACTOR_USER_ID, 'EUR')
    const generation = getSelfCareOfflineWorkspaceWriteGeneration('workspace-1')

    await markSelfCareOfflineMutationConflicted(
      current!.id,
      'workspace-1',
      ACTOR_USER_ID,
      generation,
      {
        actualVersion: 2,
        code: 'self_care_occurrence_closed',
        entityId: 'occurrence-1',
        entityType: 'occurrence',
        expectedVersion: null,
      },
      'The self-care occurrence was already completed or changed.',
    )
    await markSelfCareOfflineMutationConflicted(
      legacy!.id,
      'workspace-1',
      ACTOR_USER_ID,
      generation,
      {
        actualVersion: 3,
        entityId: 'occurrence-2',
        entityType: 'occurrence',
        expectedVersion: null,
      },
      'The self-care occurrence was already completed or changed.',
    )

    await expect(
      countSelfCareOfflineMutations('workspace-1', ACTOR_USER_ID),
    ).resolves.toMatchObject({
      closedOccurrenceConflicts: 2,
      conflicted: 2,
      total: 2,
    })
  })

  it('rejects operation-id collisions without exposing or mutating another actor queue', async () => {
    const operationId = generateUuidV7()
    const firstInput = {
      actorUserId: ACTOR_USER_ID,
      command: createSettingsCommand('USD'),
      occurredAt: '2026-08-06T08:00:00.000Z',
      operationId,
      optimisticResult: createSettingsResult('USD'),
      workspaceId: 'workspace-1',
    }
    const first = await enqueueSelfCareOfflineMutation(firstInput)

    await expect(
      enqueueSelfCareOfflineMutation({
        ...firstInput,
        actorUserId: 'user-2',
      }),
    ).rejects.toBeInstanceOf(SelfCareOfflineMutationCollisionError)

    const generation = getSelfCareOfflineWorkspaceWriteGeneration('workspace-1')
    await markSelfCareOfflineMutationConflicted(
      first!.id,
      'workspace-1',
      'user-2',
      generation,
      {
        actualVersion: 2,
        entityId: 'settings-1',
        entityType: 'settings',
        expectedVersion: 1,
      },
      'Чужая очередь не должна измениться',
    )
    await completeSelfCareOfflineMutation(
      first!.id,
      'workspace-1',
      'user-2',
      generation,
    )

    await expect(
      listSelfCareOfflineMutations('workspace-1', ACTOR_USER_ID),
    ).resolves.toEqual([
      expect.objectContaining({ id: first!.id, status: 'pending' }),
    ])
    await expect(
      listSelfCareOfflineMutations('workspace-1', 'user-2'),
    ).resolves.toEqual([])
    await expect(enqueueSelfCareOfflineMutation(firstInput)).resolves.toEqual(
      first,
    )
    await expect(
      enqueueSelfCareOfflineMutation({
        ...firstInput,
        command: createSettingsCommand('EUR'),
      }),
    ).rejects.toBeInstanceOf(SelfCareOfflineMutationCollisionError)
  })

  it('derives a projected read from confirmed base and active queue records', async () => {
    const cacheKey = createSelfCareCacheKey('settings')
    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'settings',
      cacheKey,
      { currency: 'RUB' },
    )
    const mutation = await enqueueMutation('workspace-1', ACTOR_USER_ID, 'USD')

    const projected = await loadProjectedCachedSelfCareRead<{
      currency: string | null
    }>('workspace-1', ACTOR_USER_ID, cacheKey, (current, overlay) => ({
      ...current,
      currency:
        overlay.result.kind === 'settings'
          ? overlay.result.value.settings.currency
          : current.currency,
    }))

    expect(projected?.data).toEqual({ currency: 'USD' })
    expect(mutation).not.toBeNull()
    await expect(
      loadCachedSelfCareRead('workspace-1', ACTOR_USER_ID, cacheKey),
    ).resolves.toMatchObject({ data: { currency: 'RUB' } })
  })

  it('keeps one projected snapshot while cancellation and enqueue interleave', async () => {
    const cacheKey = createSelfCareCacheKey('settings')
    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'settings',
      cacheKey,
      { currency: 'RUB' },
    )
    const mutation = await enqueueMutation('workspace-1', ACTOR_USER_ID, 'USD')
    const queueChanges: Promise<void>[] = []

    const projected = await loadProjectedCachedSelfCareRead<{
      currency: string | null
    }>('workspace-1', ACTOR_USER_ID, cacheKey, (current, overlay) => {
      queueChanges.push(
        (async () => {
          await cancelSelfCareOfflineMutation(
            mutation!.id,
            'workspace-1',
            ACTOR_USER_ID,
          )
          await enqueueMutation('workspace-1', ACTOR_USER_ID, 'EUR')
        })(),
      )

      return {
        ...current,
        currency:
          overlay.result.kind === 'settings'
            ? overlay.result.value.settings.currency
            : current.currency,
      }
    })
    await Promise.all(queueChanges)

    expect(projected?.data).toEqual({ currency: 'USD' })
    await expect(
      listSelfCareOfflineMutations('workspace-1', ACTOR_USER_ID),
    ).resolves.toEqual([
      expect.objectContaining({
        optimisticResult: createSettingsResult('EUR'),
        status: 'pending',
      }),
    ])
  })

  it('keeps the server result overlay until a refreshed base is acknowledged', async () => {
    const mutation = await enqueueMutation('workspace-1', ACTOR_USER_ID, 'USD')
    const serverResult = createSettingsResult('EUR')

    await markSelfCareOfflineMutationAwaitingRefresh(
      mutation!.id,
      'workspace-1',
      ACTOR_USER_ID,
      getSelfCareOfflineWorkspaceWriteGeneration('workspace-1'),
      serverResult,
    )

    const [stored] = await listSelfCareOfflineMutations(
      'workspace-1',
      ACTOR_USER_ID,
    )
    expect(stored).toMatchObject({
      serverResult,
      status: 'awaiting_refresh',
    })
    expect(
      applySelfCareOfflineOverlays<{ currency: string | null }>(
        { currency: 'RUB' },
        [stored!],
        (current, overlay) => ({
          currency:
            overlay.result.kind === 'settings'
              ? overlay.result.value.settings.currency
              : current.currency,
        }),
      ),
    ).toEqual({ currency: 'EUR' })

    await completeSelfCareOfflineMutation(
      mutation!.id,
      'workspace-1',
      ACTOR_USER_ID,
    )
    await expect(
      listSelfCareOfflineMutations('workspace-1', ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it('excludes conflicts from overlays and supports retry with a new operation id or cancel', async () => {
    const mutation = await enqueueMutation('workspace-1', ACTOR_USER_ID, 'USD')
    const generation = getSelfCareOfflineWorkspaceWriteGeneration('workspace-1')
    await markSelfCareOfflineMutationConflicted(
      mutation!.id,
      'workspace-1',
      ACTOR_USER_ID,
      generation,
      {
        actualVersion: 2,
        entityId: 'settings-1',
        entityType: 'settings',
        expectedVersion: 1,
      },
      'Конфликт версии',
    )
    const [conflicted] = await listSelfCareOfflineMutations(
      'workspace-1',
      ACTOR_USER_ID,
    )
    expect(
      applySelfCareOfflineOverlays(
        { currency: 'RUB' },
        [conflicted!],
        (current) => ({ ...current, currency: 'USD' }),
      ),
    ).toEqual({ currency: 'RUB' })

    const nextOperationId = generateUuidV7()
    await retrySelfCareOfflineMutation(
      mutation!.id,
      'workspace-1',
      ACTOR_USER_ID,
      {
        command: createSettingsCommand('USD', 2),
        operationId: nextOperationId,
        optimisticResult: createSettingsResult('USD'),
      },
    )
    await expect(
      listSelfCareOfflineMutations('workspace-1', ACTOR_USER_ID),
    ).resolves.toEqual([
      expect.objectContaining({
        operationId: nextOperationId,
        status: 'pending',
      }),
    ])

    await cancelSelfCareOfflineMutation(
      mutation!.id,
      'workspace-1',
      ACTOR_USER_ID,
    )
    await expect(
      listSelfCareOfflineMutations('workspace-1', ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it('preserves dependency ids on retry and cancels all transitive dependents', async () => {
    const parent = await enqueueMutation('workspace-1', ACTOR_USER_ID, 'USD')
    const child = await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createSettingsCommand('EUR', 2),
      dependsOn: [parent!.id],
      occurredAt: '2026-08-06T08:01:00.000Z',
      operationId: generateUuidV7(),
      optimisticResult: createSettingsResult('EUR'),
      workspaceId: 'workspace-1',
    })
    const grandchild = await enqueueSelfCareOfflineMutation({
      actorUserId: ACTOR_USER_ID,
      command: createSettingsCommand('GBP', 3),
      dependsOn: [child!.id],
      occurredAt: '2026-08-06T08:02:00.000Z',
      operationId: generateUuidV7(),
      optimisticResult: createSettingsResult('GBP'),
      workspaceId: 'workspace-1',
    })
    const unrelated = await enqueueMutation('workspace-1', ACTOR_USER_ID, 'CNY')
    const replacementOperationId = generateUuidV7()

    await retrySelfCareOfflineMutation(
      parent!.id,
      'workspace-1',
      ACTOR_USER_ID,
      {
        command: createSettingsCommand('USD', 4),
        dependentRebases: [
          {
            command: createSettingsCommand('EUR', 5),
            mutationId: child!.id,
            optimisticResult: createSettingsResult('EUR'),
          },
          {
            command: createSettingsCommand('GBP', 6),
            mutationId: grandchild!.id,
            optimisticResult: createSettingsResult('GBP'),
          },
        ],
        operationId: replacementOperationId,
        optimisticResult: createSettingsResult('USD'),
      },
    )

    const afterRetry = await listSelfCareOfflineMutations(
      'workspace-1',
      ACTOR_USER_ID,
    )
    expect(afterRetry.find(({ id }) => id === parent!.id)).toMatchObject({
      id: parent!.id,
      operationId: replacementOperationId,
    })
    expect(afterRetry.find(({ id }) => id === child!.id)?.dependsOn).toEqual([
      parent!.id,
    ])
    expect(
      afterRetry.find(({ id }) => id === child!.id)?.command,
    ).toMatchObject({ expectedVersion: 5 })
    expect(
      afterRetry.find(({ id }) => id === grandchild!.id)?.command,
    ).toMatchObject({ expectedVersion: 6 })

    await cancelSelfCareOfflineMutation(
      parent!.id,
      'workspace-1',
      ACTOR_USER_ID,
    )

    await expect(
      listSelfCareOfflineMutations('workspace-1', ACTOR_USER_ID),
    ).resolves.toEqual([expect.objectContaining({ id: unrelated!.id })])
  })

  it('clears cached reads and queued commands without allowing a late generation write', async () => {
    const generation = getSelfCareOfflineWorkspaceWriteGeneration('workspace-1')
    await enqueueMutation('workspace-1', ACTOR_USER_ID, 'USD')
    await clearSelfCareOfflineWorkspaceData('workspace-1')
    await saveCachedSelfCareRead(
      'workspace-1',
      ACTOR_USER_ID,
      'settings',
      createSelfCareCacheKey('settings'),
      { currency: 'late' },
      new Date().toISOString(),
      generation,
    )

    await expect(
      listSelfCareOfflineMutations('workspace-1', ACTOR_USER_ID),
    ).resolves.toEqual([])
    await expect(
      loadCachedSelfCareRead(
        'workspace-1',
        ACTOR_USER_ID,
        createSelfCareCacheKey('settings'),
      ),
    ).resolves.toBeNull()
  })

  it('observes a cleanup generation persisted by another browser context', async () => {
    const workspaceId = 'workspace-1'
    const cacheKey = createSelfCareCacheKey('settings')
    const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)
    const nextLifecycle = JSON.stringify({
      pendingPurgeGeneration: null,
      writeGeneration: generation + 1,
    })
    window.localStorage.setItem(
      selfCareLifecycleStorageKey(workspaceId),
      nextLifecycle,
    )
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: selfCareLifecycleStorageKey(workspaceId),
        newValue: nextLifecycle,
      }),
    )

    await saveCachedSelfCareRead(
      workspaceId,
      ACTOR_USER_ID,
      'settings',
      cacheKey,
      { currency: 'late' },
      new Date().toISOString(),
      generation,
    )

    expect(getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)).toBe(
      generation + 1,
    )
    await expect(
      loadCachedSelfCareRead(workspaceId, ACTOR_USER_ID, cacheKey),
    ).resolves.toBeNull()
  })

  it('keeps concurrent purge markers isolated per workspace', async () => {
    const firstWorkspaceId = 'workspace-1'
    const secondWorkspaceId = 'workspace-2'
    const cacheKey = createSelfCareCacheKey('settings')
    await saveCachedSelfCareRead(
      firstWorkspaceId,
      ACTOR_USER_ID,
      'settings',
      cacheKey,
      { currency: 'USD' },
    )
    await saveCachedSelfCareRead(
      secondWorkspaceId,
      ACTOR_USER_ID,
      'settings',
      cacheKey,
      { currency: 'EUR' },
    )
    await enqueueMutation(firstWorkspaceId, ACTOR_USER_ID, 'USD')
    await enqueueMutation(secondWorkspaceId, ACTOR_USER_ID, 'EUR')

    const firstPurge = clearSelfCareOfflineWorkspaceData(firstWorkspaceId)
    const secondPurge = clearSelfCareOfflineWorkspaceData(secondWorkspaceId)

    expect(readSelfCareLifecycleState(firstWorkspaceId)).toEqual({
      pendingPurgeGeneration: 1,
      writeGeneration: 1,
    })
    expect(readSelfCareLifecycleState(secondWorkspaceId)).toEqual({
      pendingPurgeGeneration: 1,
      writeGeneration: 1,
    })

    await Promise.all([firstPurge, secondPurge])

    expect(
      readSelfCareLifecycleState(firstWorkspaceId).pendingPurgeGeneration,
    ).toBeNull()
    expect(
      readSelfCareLifecycleState(secondWorkspaceId).pendingPurgeGeneration,
    ).toBeNull()
    await expect(
      loadCachedSelfCareRead(firstWorkspaceId, ACTOR_USER_ID, cacheKey),
    ).resolves.toBeNull()
    await expect(
      loadCachedSelfCareRead(secondWorkspaceId, ACTOR_USER_ID, cacheKey),
    ).resolves.toBeNull()
    await expect(
      listSelfCareOfflineMutations(firstWorkspaceId, ACTOR_USER_ID),
    ).resolves.toEqual([])
    await expect(
      listSelfCareOfflineMutations(secondWorkspaceId, ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it('flushes a durable pending purge before storage becomes ready after reload', async () => {
    const workspaceId = 'workspace-1'
    const cacheKey = createSelfCareCacheKey('settings')
    await saveCachedSelfCareRead(
      workspaceId,
      ACTOR_USER_ID,
      'settings',
      cacheKey,
      { currency: 'USD' },
    )
    await enqueueMutation(workspaceId, ACTOR_USER_ID, 'USD')
    reportSelfCareOfflineStorageFailure(
      new DOMException('Quota exhausted', 'QuotaExceededError'),
    )

    await clearSelfCareOfflineWorkspaceData(workspaceId)
    expect(getSelfCareOfflineStorageHealth()).toBe('failed')

    resetSelfCareOfflineRuntimeForTests()
    expect(getSelfCareOfflineStorageHealth()).toBe('unknown')
    await expect(probeSelfCareOfflineStorage()).resolves.toBe('ready')
    await expect(
      loadCachedSelfCareRead(workspaceId, ACTOR_USER_ID, cacheKey),
    ).resolves.toBeNull()
    await expect(
      listSelfCareOfflineMutations(workspaceId, ACTOR_USER_ID),
    ).resolves.toEqual([])
  })

  it('rejects cleanup explicitly when neither a durable marker nor a purge is available', async () => {
    reportSelfCareOfflineStorageFailure(
      new DOMException('Storage denied', 'SecurityError'),
    )
    const storageSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Storage denied', 'SecurityError')
      })

    try {
      await expect(
        clearSelfCareOfflineWorkspaceData('workspace-1'),
      ).rejects.toBeInstanceOf(SelfCareOfflinePurgeUnavailableError)
    } finally {
      storageSpy.mockRestore()
    }
  })

  it('rejects a successful local purge when cross-tab invalidation could not be persisted', async () => {
    const workspaceId = 'workspace-1'
    await saveCachedSelfCareRead(
      workspaceId,
      ACTOR_USER_ID,
      'settings',
      createSelfCareCacheKey('settings'),
      { currency: 'USD' },
    )
    await enqueueMutation(workspaceId, ACTOR_USER_ID, 'USD')
    const storageSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('Storage denied', 'SecurityError')
      })

    try {
      await expect(
        clearSelfCareOfflineWorkspaceData(workspaceId),
      ).rejects.toBeInstanceOf(SelfCareOfflinePurgeUnavailableError)
    } finally {
      storageSpy.mockRestore()
    }

    const rawDatabase = new Dexie(SELF_CARE_OFFLINE_DATABASE_NAME)
    await rawDatabase.open()
    await expect(
      rawDatabase
        .table('cachedReads')
        .where('workspaceId')
        .equals(workspaceId)
        .count(),
    ).resolves.toBe(0)
    await expect(
      rawDatabase
        .table('mutationQueue')
        .where('workspaceId')
        .equals(workspaceId)
        .count(),
    ).resolves.toBe(0)
    rawDatabase.close()
  })

  it('marks a named Dexie write failure as failed through the serialized write boundary', async () => {
    await expect(probeSelfCareOfflineStorage()).resolves.toBe('ready')
    const versionError = new Error('Database version changed')
    versionError.name = 'VersionChangeError'
    const putSpy = vi
      .spyOn(IDBObjectStore.prototype, 'put')
      .mockImplementation(() => {
        throw versionError
      })

    try {
      await expect(
        saveCachedSelfCareRead(
          'workspace-1',
          ACTOR_USER_ID,
          'settings',
          createSelfCareCacheKey('settings'),
          { currency: 'USD' },
        ),
      ).rejects.toBe(versionError)
    } finally {
      putSpy.mockRestore()
    }

    expect(getSelfCareOfflineStorageHealth()).toBe('failed')
  })
})

function createSettingsCommand(
  currency: string,
  expectedVersion = 1,
): SelfCareOfflineCommand {
  return {
    expectedVersion,
    input: { currency },
    type: 'update_settings',
  }
}

function createSettingsResult(currency: string): SelfCareOfflineCommandResult {
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

async function enqueueMutation(
  workspaceId: string,
  actorUserId: string,
  currency: string,
) {
  return enqueueSelfCareOfflineMutation({
    actorUserId,
    command: createSettingsCommand(currency),
    occurredAt: '2026-08-06T08:00:00.000Z',
    operationId: generateUuidV7(),
    optimisticResult: createSettingsResult(currency),
    workspaceId,
  })
}

function readSelfCareLifecycleState(workspaceId: string): {
  pendingPurgeGeneration: number | null
  writeGeneration: number
} {
  return JSON.parse(
    window.localStorage.getItem(selfCareLifecycleStorageKey(workspaceId)) ??
      '{}',
  ) as {
    pendingPurgeGeneration: number | null
    writeGeneration: number
  }
}

function selfCareLifecycleStorageKey(workspaceId: string): string {
  return `${SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
}
