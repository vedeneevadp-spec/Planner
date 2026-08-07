import {
  type CleaningListResponse,
  type CleaningTaskActionResponse,
  type CleaningTaskRecord,
  type CleaningTodayResponse,
  type CleaningZoneRecord,
  generateUuidV7,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

import type {
  CleaningOfflineMutationInput,
  CleaningOfflineMutationRecord,
  CleaningOfflineMutationStatus,
} from './offline-cleaning-mutation'
import {
  applyCleaningServerConfirmation,
  projectCleaningPlan,
  projectCleaningToday,
} from './offline-cleaning-projection'

export type {
  CleaningOfflineMutationInput,
  CleaningOfflineMutationRecord,
  CleaningOfflineMutationStatus,
} from './offline-cleaning-mutation'

export interface CleaningCachedRead<T> {
  data: T
  lastSuccessfulSyncAt: string
}

interface CleaningCachedPlanRow extends CleaningCachedRead<CleaningListResponse> {
  actorUserId: string
  key: string
  requestStartedAt?: number | undefined
  valueVersion: number
  workspaceId: string
}

interface CleaningCachedTodayRow extends CleaningCachedRead<CleaningTodayResponse> {
  actorUserId: string
  date: string
  key: string
  requestStartedAt?: number | undefined
  valueVersion: number
  workspaceId: string
}

export type CleaningServerConfirmation =
  | { kind: 'action'; value: CleaningTaskActionResponse }
  | { kind: 'plan'; value: CleaningListResponse }
  | { kind: 'task'; value: CleaningTaskRecord }
  | { kind: 'void' }
  | { kind: 'zone'; value: CleaningZoneRecord }

export interface CleaningOfflineQueueCounts {
  conflicted: number
  failed: number
  pending: number
}

export type CleaningOfflineStorageHealth =
  'failed' | 'ready' | 'unavailable' | 'unknown'

const RETRYABLE_STATUSES: CleaningOfflineMutationStatus[] = [
  'failed',
  'pending',
  'syncing',
]

export const CLEANING_OFFLINE_DATABASE_NAME = 'cleaning-offline'
export const CLEANING_OFFLINE_SCHEMA_VERSION = 3
export const CLEANING_CACHE_VALUE_VERSION = 1
export const CLEANING_TODAY_CACHE_LIMIT = 45
export const CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX =
  'planner.cleaningOfflineLifecycle:'

interface CleaningOfflineLifecycleState {
  pendingPurgeMarker: string | null
  writeGeneration: number
}

class CleaningOfflineDatabase extends Dexie {
  cachedPlans!: Table<CleaningCachedPlanRow, string>
  cachedTodayResponses!: Table<CleaningCachedTodayRow, string>
  mutationQueue!: Table<CleaningOfflineMutationRecord, number>

  constructor() {
    super(CLEANING_OFFLINE_DATABASE_NAME)

    this.version(1).stores({
      cachedPlans: 'key, workspaceId, lastSuccessfulSyncAt',
      cachedTodayResponses:
        'key, workspaceId, date, lastSuccessfulSyncAt, [workspaceId+date]',
    })
    this.version(2)
      .stores({
        cachedPlans:
          'key, workspaceId, actorUserId, lastSuccessfulSyncAt, [workspaceId+actorUserId]',
        cachedTodayResponses:
          'key, workspaceId, actorUserId, date, lastSuccessfulSyncAt, [workspaceId+actorUserId], [workspaceId+actorUserId+date]',
      })
      .upgrade(async (transaction) => {
        await Promise.all([
          transaction.table('cachedPlans').clear(),
          transaction.table('cachedTodayResponses').clear(),
        ])
      })
    this.version(CLEANING_OFFLINE_SCHEMA_VERSION).stores({
      cachedPlans:
        'key, workspaceId, actorUserId, lastSuccessfulSyncAt, [workspaceId+actorUserId]',
      cachedTodayResponses:
        'key, workspaceId, actorUserId, date, lastSuccessfulSyncAt, [workspaceId+actorUserId], [workspaceId+actorUserId+date]',
      mutationQueue:
        '++sequence, &operationId, workspaceId, actorUserId, status, createdAt, [workspaceId+actorUserId], [workspaceId+actorUserId+status], *entityKeys',
    })
  }
}

let database: CleaningOfflineDatabase | null = null
const pendingWrites = new Map<string, Promise<unknown>>()
const workspaceWriteGenerations = new Map<string, number>()
const queueListeners = new Set<() => void>()
let storageHealth: CleaningOfflineStorageHealth =
  typeof indexedDB === 'undefined' ? 'unavailable' : 'unknown'
let storageHealthProbe: Promise<CleaningOfflineStorageHealth> | null = null
let storageFailureEpoch = 0

export function isCleaningOfflineStorageAvailable(): boolean {
  return (
    getCleaningOfflineStorageHealth() !== 'unavailable' &&
    getCleaningOfflineStorageHealth() !== 'failed'
  )
}

export function isCleaningOfflineStorageReady(): boolean {
  return getCleaningOfflineStorageHealth() === 'ready'
}

export function getCleaningOfflineStorageHealth(): CleaningOfflineStorageHealth {
  if (typeof indexedDB === 'undefined') {
    return 'unavailable'
  }

  if (
    storageHealth === 'ready' &&
    Object.keys(readStoredCleaningPendingPurges()).length > 0
  ) {
    return 'unknown'
  }

  return storageHealth
}

export function probeCleaningOfflineStorage(): Promise<CleaningOfflineStorageHealth> {
  const currentHealth = getCleaningOfflineStorageHealth()

  if (currentHealth === 'ready' || currentHealth === 'unavailable') {
    return Promise.resolve(currentHealth)
  }

  if (storageHealthProbe) {
    return storageHealthProbe
  }

  storageHealthProbe = (async () => {
    const db = getCleaningOfflineDatabaseForMaintenance()

    if (!db) {
      return getCleaningOfflineStorageHealth()
    }

    const failureEpochAtStart = storageFailureEpoch

    try {
      const probeKey = '__cleaning-storage-health__'
      await db.transaction('rw', db.cachedPlans, async () => {
        await db.cachedPlans.put({
          actorUserId: '__health__',
          data: { history: [], states: [], tasks: [], zones: [] },
          key: probeKey,
          lastSuccessfulSyncAt: new Date(0).toISOString(),
          valueVersion: CLEANING_CACHE_VALUE_VERSION,
          workspaceId: '__health__',
        })
        await db.cachedPlans.delete(probeKey)
      })
      await applyPendingCleaningWorkspacePurges(db)
      setCleaningOfflineStorageReadyIfCurrent(failureEpochAtStart, true)
    } catch (error) {
      markCleaningOfflineStorageFailure(error)
    }

    return getCleaningOfflineStorageHealth()
  })().finally(() => {
    storageHealthProbe = null
  })

  return storageHealthProbe
}

export function subscribeCleaningOfflineQueue(
  listener: () => void,
): () => void {
  queueListeners.add(listener)
  return () => {
    queueListeners.delete(listener)
  }
}

export async function resetCleaningOfflineDatabaseForTests(): Promise<void> {
  database?.close()
  database = null
  storageHealthProbe = null
  storageHealth = typeof indexedDB === 'undefined' ? 'unavailable' : 'unknown'
  storageFailureEpoch = 0
  pendingWrites.clear()
  workspaceWriteGenerations.clear()
  removeStoredCleaningLifecycleStates()
  queueListeners.clear()

  if (typeof indexedDB !== 'undefined') {
    await Dexie.delete(CLEANING_OFFLINE_DATABASE_NAME)
  }
}

export function resetCleaningOfflineRuntimeForTests(): void {
  database?.close()
  database = null
  storageHealthProbe = null
  storageHealth = typeof indexedDB === 'undefined' ? 'unavailable' : 'unknown'
  storageFailureEpoch = 0
  pendingWrites.clear()
  workspaceWriteGenerations.clear()
  queueListeners.clear()
}

export async function clearCleaningOfflineWorkspaceData(
  workspaceId: string,
): Promise<void> {
  const purgeGeneration =
    getCleaningOfflineWorkspaceWriteGeneration(workspaceId) + 1
  const purgeMarker = beginCleaningOfflineWorkspacePurge(
    workspaceId,
    purgeGeneration,
  )
  const durablePurgePersisted = purgeMarker !== null
  setCleaningOfflineStorageHealth('unknown')
  await waitForWorkspaceWrites(workspaceId)
  const db = getCleaningOfflineDatabaseForMaintenance()

  if (!db) {
    notifyQueueListeners()

    if (durablePurgePersisted) {
      return
    }

    throw new CleaningOfflinePurgeUnavailableError()
  }

  try {
    await purgeCleaningWorkspaceData(db, workspaceId)
    removeCleaningPendingPurge(workspaceId, purgeMarker)
    notifyQueueListeners()

    if (!durablePurgePersisted) {
      throw new CleaningOfflinePurgeUnavailableError()
    }
  } catch (error) {
    markCleaningOfflineStorageFailure(error)
    notifyQueueListeners()

    if (!durablePurgePersisted) {
      throw error
    }
  }
}

export const resetCleaningOfflineWorkspaceData =
  clearCleaningOfflineWorkspaceData

export async function loadCachedCleaningPlan(
  workspaceId: string,
  actorUserId: string,
): Promise<CleaningCachedRead<CleaningListResponse> | null> {
  const readGeneration = getCleaningOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return null
  }

  const [row, mutations] = await db.transaction(
    'r',
    [db.cachedPlans, db.mutationQueue],
    () =>
      Promise.all([
        db.cachedPlans.get(createPlanKey(workspaceId, actorUserId)),
        listScopedMutations(db, workspaceId, actorUserId),
      ]),
  )

  if (!isGenerationCurrent(workspaceId, readGeneration)) {
    return null
  }

  return row?.valueVersion === CLEANING_CACHE_VALUE_VERSION
    ? {
        data: projectCleaningPlan(row.data, mutations),
        lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
      }
    : null
}

export async function replaceCachedCleaningPlan(
  workspaceId: string,
  actorUserId: string,
  data: CleaningListResponse,
  lastSuccessfulSyncAt = new Date().toISOString(),
  expectedWriteGeneration = getCleaningOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
  requestStartedAt = 0,
): Promise<CleaningCachedRead<CleaningListResponse>> {
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return { data, lastSuccessfulSyncAt }
  }

  const storageKey = createPlanKey(workspaceId, actorUserId)

  return runSerializedWrite(storageKey, () =>
    db.transaction('rw', [db.cachedPlans, db.mutationQueue], async () => {
      if (!isGenerationCurrent(workspaceId, expectedWriteGeneration)) {
        return { data, lastSuccessfulSyncAt }
      }

      const current = await db.cachedPlans.get(storageKey)

      if (
        current?.valueVersion === CLEANING_CACHE_VALUE_VERSION &&
        (current.requestStartedAt ?? 0) > requestStartedAt
      ) {
        const mutations = await listScopedMutations(
          db,
          workspaceId,
          actorUserId,
        )

        return {
          data: projectCleaningPlan(current.data, mutations),
          lastSuccessfulSyncAt: current.lastSuccessfulSyncAt,
        }
      }

      await db.cachedPlans.put({
        actorUserId,
        data,
        key: storageKey,
        lastSuccessfulSyncAt,
        requestStartedAt,
        valueVersion: CLEANING_CACHE_VALUE_VERSION,
        workspaceId,
      })
      const mutations = await listScopedMutations(db, workspaceId, actorUserId)

      return {
        data: projectCleaningPlan(data, mutations),
        lastSuccessfulSyncAt,
      }
    }),
  )
}

export async function loadCachedCleaningToday(
  workspaceId: string,
  actorUserId: string,
  date: string,
): Promise<CleaningCachedRead<CleaningTodayResponse> | null> {
  const readGeneration = getCleaningOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return null
  }

  const [todayRow, planRow, mutations] = await db.transaction(
    'r',
    [db.cachedPlans, db.cachedTodayResponses, db.mutationQueue],
    () =>
      Promise.all([
        db.cachedTodayResponses.get(
          createTodayKey(workspaceId, actorUserId, date),
        ),
        db.cachedPlans.get(createPlanKey(workspaceId, actorUserId)),
        listScopedMutations(db, workspaceId, actorUserId),
      ]),
  )

  if (
    !isGenerationCurrent(workspaceId, readGeneration) ||
    todayRow?.valueVersion !== CLEANING_CACHE_VALUE_VERSION
  ) {
    return null
  }

  const projectedPlan =
    planRow?.valueVersion === CLEANING_CACHE_VALUE_VERSION
      ? projectCleaningPlan(planRow.data, mutations)
      : null

  return {
    data: projectedPlan
      ? projectCleaningToday(todayRow.data, projectedPlan)
      : todayRow.data,
    lastSuccessfulSyncAt: todayRow.lastSuccessfulSyncAt,
  }
}

export async function replaceCachedCleaningToday(
  workspaceId: string,
  actorUserId: string,
  date: string,
  data: CleaningTodayResponse,
  lastSuccessfulSyncAt = new Date().toISOString(),
  expectedWriteGeneration = getCleaningOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
  requestStartedAt = 0,
): Promise<CleaningCachedRead<CleaningTodayResponse>> {
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return { data, lastSuccessfulSyncAt }
  }

  const storageKey = createTodayKey(workspaceId, actorUserId, date)

  return runSerializedWrite(storageKey, () =>
    db.transaction(
      'rw',
      [db.cachedPlans, db.cachedTodayResponses, db.mutationQueue],
      async () => {
        if (!isGenerationCurrent(workspaceId, expectedWriteGeneration)) {
          return { data, lastSuccessfulSyncAt }
        }

        const current = await db.cachedTodayResponses.get(storageKey)

        if (
          current?.valueVersion === CLEANING_CACHE_VALUE_VERSION &&
          (current.requestStartedAt ?? 0) > requestStartedAt
        ) {
          const [planRow, mutations] = await Promise.all([
            db.cachedPlans.get(createPlanKey(workspaceId, actorUserId)),
            listScopedMutations(db, workspaceId, actorUserId),
          ])
          const projectedPlan =
            planRow?.valueVersion === CLEANING_CACHE_VALUE_VERSION
              ? projectCleaningPlan(planRow.data, mutations)
              : null

          return {
            data: projectedPlan
              ? projectCleaningToday(current.data, projectedPlan)
              : current.data,
            lastSuccessfulSyncAt: current.lastSuccessfulSyncAt,
          }
        }

        await db.cachedTodayResponses.put({
          actorUserId,
          data,
          date,
          key: storageKey,
          lastSuccessfulSyncAt,
          requestStartedAt,
          valueVersion: CLEANING_CACHE_VALUE_VERSION,
          workspaceId,
        })
        await pruneCachedTodayResponses(db, workspaceId, actorUserId)
        const [planRow, mutations] = await Promise.all([
          db.cachedPlans.get(createPlanKey(workspaceId, actorUserId)),
          listScopedMutations(db, workspaceId, actorUserId),
        ])
        const projectedPlan =
          planRow?.valueVersion === CLEANING_CACHE_VALUE_VERSION
            ? projectCleaningPlan(planRow.data, mutations)
            : null

        return {
          data: projectedPlan
            ? projectCleaningToday(data, projectedPlan)
            : data,
          lastSuccessfulSyncAt,
        }
      },
    ),
  )
}

export async function enqueueCleaningOfflineMutation(
  input: CleaningOfflineMutationInput,
  expectedWriteGeneration = getCleaningOfflineWorkspaceWriteGeneration(
    input.workspaceId,
  ),
): Promise<CleaningOfflineMutationRecord> {
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    throw new Error(
      'Надёжное локальное сохранение недоступно в этом браузере. Подключитесь к сети и повторите.',
    )
  }

  const storageKey = `${input.workspaceId}:${input.actorUserId}:mutation-queue`

  const persistRecord = runSerializedWrite(storageKey, () =>
    db.transaction('rw', db.mutationQueue, async () => {
      assertGenerationCurrent(input.workspaceId, expectedWriteGeneration)
      const existing = await listScopedMutations(
        db,
        input.workspaceId,
        input.actorUserId,
      )
      const entityKeys = getCleaningMutationEntityKeys(input)
      const coalescedAction = findCoalescedAction(existing, input)
      const createdAt = input.createdAt ?? new Date().toISOString()
      const operationId = input.operationId ?? generateUuidV7()
      const dependencyCandidates = coalescedAction
        ? existing.filter(
            (mutation) => mutation.operationId !== coalescedAction.operationId,
          )
        : existing
      const dependsOnOperationIds = dependencyCandidates
        .filter((mutation) =>
          mutation.entityKeys.some((key) => entityKeys.includes(key)),
        )
        .map((mutation) => mutation.operationId)
      const next = {
        ...input,
        attemptCount: 0,
        conflictActualVersion: null,
        conflictExpectedVersion: null,
        createdAt,
        dependsOnOperationIds: [...new Set(dependsOnOperationIds)],
        entityKeys,
        lastError: null,
        operationId,
        status: 'pending' as const,
        updatedAt: createdAt,
      } as CleaningOfflineMutationRecord

      if (coalescedAction && next.type === 'task.action') {
        next.expectedStateVersion = coalescedAction.expectedStateVersion
        next.expectedTaskVersion = coalescedAction.expectedTaskVersion
      }

      if (coalescedAction?.sequence !== undefined) {
        await db.mutationQueue.delete(coalescedAction.sequence)
      }

      const sequence = await db.mutationQueue.add(next)
      const persisted = { ...next, sequence } as CleaningOfflineMutationRecord

      if (coalescedAction) {
        const dependents = existing.filter((mutation) =>
          mutation.dependsOnOperationIds.includes(coalescedAction.operationId),
        )

        await Promise.all(
          dependents.map((mutation) =>
            updateMutationBySequence(db, mutation, {
              dependsOnOperationIds: mutation.dependsOnOperationIds.map(
                (operationId) =>
                  operationId === coalescedAction.operationId
                    ? persisted.operationId
                    : operationId,
              ),
            }),
          ),
        )
      }

      return persisted
    }),
  )
  let record: CleaningOfflineMutationRecord

  try {
    record = await persistRecord
  } catch (error) {
    if (isCleaningOfflineStorageFailure(error)) {
      throw new CleaningOfflineMutationNotPersistedError(error)
    }

    throw error
  }

  notifyQueueListeners()
  return record
}

export async function listCleaningOfflineMutations(
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration = getCleaningOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<CleaningOfflineMutationRecord[]> {
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return []
  }

  const mutations = await listScopedMutations(db, workspaceId, actorUserId)

  return isGenerationCurrent(workspaceId, expectedWriteGeneration)
    ? mutations
    : []
}

export async function getCleaningOfflineMutation(
  operationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration = getCleaningOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<CleaningOfflineMutationRecord | null> {
  const mutations = await listCleaningOfflineMutations(
    workspaceId,
    actorUserId,
    expectedWriteGeneration,
  )

  return (
    mutations.find((mutation) => mutation.operationId === operationId) ?? null
  )
}

export async function getCleaningOfflineQueueCounts(
  workspaceId: string,
  actorUserId: string,
): Promise<CleaningOfflineQueueCounts> {
  const mutations = await listCleaningOfflineMutations(workspaceId, actorUserId)

  return {
    conflicted: mutations.filter((item) => item.status === 'conflicted').length,
    failed: mutations.filter((item) => item.status === 'failed').length,
    pending: mutations.filter((item) =>
      RETRYABLE_STATUSES.includes(item.status),
    ).length,
  }
}

export async function markCleaningOfflineMutationSyncing(
  operationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
): Promise<void> {
  await updateScopedMutation(
    operationId,
    workspaceId,
    actorUserId,
    expectedWriteGeneration,
    (mutation) => ({
      attemptCount: mutation.attemptCount + 1,
      lastError: null,
      status: 'syncing',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function markCleaningOfflineMutationFailed(
  operationId: string,
  message: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
): Promise<void> {
  await updateScopedMutation(
    operationId,
    workspaceId,
    actorUserId,
    expectedWriteGeneration,
    () => ({
      lastError: message,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function markCleaningOfflineMutationConflicted(
  operationId: string,
  conflict: {
    actualVersion: number | null
    expectedVersion: number | null
    message: string
  },
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
): Promise<void> {
  await updateScopedMutation(
    operationId,
    workspaceId,
    actorUserId,
    expectedWriteGeneration,
    () => ({
      conflictActualVersion: conflict.actualVersion,
      conflictExpectedVersion: conflict.expectedVersion,
      lastError: conflict.message,
      status: 'conflicted',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function completeCleaningOfflineMutation(
  operationId: string,
  confirmation: CleaningServerConfirmation,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
): Promise<void> {
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return
  }

  const storageKey = `${workspaceId}:${actorUserId}:mutation-queue`

  await runSerializedWrite(storageKey, () =>
    db.transaction(
      'rw',
      [db.cachedPlans, db.cachedTodayResponses, db.mutationQueue],
      async () => {
        assertGenerationCurrent(workspaceId, expectedWriteGeneration)
        const mutation = await db.mutationQueue
          .where('operationId')
          .equals(operationId)
          .first()

        if (
          !mutation ||
          mutation.workspaceId !== workspaceId ||
          mutation.actorUserId !== actorUserId
        ) {
          return
        }

        const planKey = createPlanKey(workspaceId, actorUserId)
        const planRow = await db.cachedPlans.get(planKey)

        if (planRow?.valueVersion === CLEANING_CACHE_VALUE_VERSION) {
          const confirmedPlan = applyCleaningServerConfirmation(
            planRow.data,
            mutation,
            confirmation,
          )

          await db.cachedPlans.put({
            ...planRow,
            data: confirmedPlan,
            requestStartedAt: Math.max(
              planRow.requestStartedAt ?? 0,
              Date.now() + 1,
            ),
          })
          const todayRows = await db.cachedTodayResponses
            .where('[workspaceId+actorUserId]')
            .equals([workspaceId, actorUserId])
            .toArray()

          await db.cachedTodayResponses.bulkPut(
            todayRows.map((row) => ({
              ...row,
              data: projectCleaningToday(row.data, confirmedPlan),
            })),
          )
        }

        if (mutation.sequence !== undefined) {
          const dependents = await listScopedMutations(
            db,
            workspaceId,
            actorUserId,
          )

          await Promise.all(
            dependents
              .filter((candidate) =>
                candidate.dependsOnOperationIds.includes(operationId),
              )
              .map((candidate) =>
                updateMutationBySequence(db, candidate, {
                  dependsOnOperationIds: candidate.dependsOnOperationIds.filter(
                    (dependencyId) => dependencyId !== operationId,
                  ),
                }),
              ),
          )
          await db.mutationQueue.delete(mutation.sequence)
        }
      },
    ),
  )
  notifyQueueListeners()
}

export async function discardConflictedCleaningMutations(
  workspaceId: string,
  actorUserId: string,
): Promise<void> {
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return
  }

  await db.transaction('rw', db.mutationQueue, async () => {
    const scoped = await listScopedMutations(db, workspaceId, actorUserId)
    const discardedOperationIds = new Set(
      scoped
        .filter((mutation) => mutation.status === 'conflicted')
        .map((mutation) => mutation.operationId),
    )

    let changed = true

    while (changed) {
      changed = false

      for (const mutation of scoped) {
        if (
          !discardedOperationIds.has(mutation.operationId) &&
          mutation.dependsOnOperationIds.some((operationId) =>
            discardedOperationIds.has(operationId),
          )
        ) {
          discardedOperationIds.add(mutation.operationId)
          changed = true
        }
      }
    }

    await db.mutationQueue.bulkDelete(
      scoped
        .filter((mutation) => discardedOperationIds.has(mutation.operationId))
        .flatMap((mutation) =>
          mutation.sequence === undefined ? [] : [mutation.sequence],
        ),
    )
  })
  notifyQueueListeners()
}

export async function retryConflictedCleaningMutations(
  workspaceId: string,
  actorUserId: string,
): Promise<number> {
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return 0
  }

  const storageKey = `${workspaceId}:${actorUserId}:mutation-queue`
  const retried = await runSerializedWrite(storageKey, () =>
    db.transaction('rw', [db.cachedPlans, db.mutationQueue], async () => {
      const planRow = await db.cachedPlans.get(
        createPlanKey(workspaceId, actorUserId),
      )

      if (planRow?.valueVersion !== CLEANING_CACHE_VALUE_VERSION) {
        return 0
      }

      const scoped = await listScopedMutations(db, workspaceId, actorUserId)
      const candidates = scoped.filter(
        (mutation) => mutation.status === 'conflicted',
      )
      const candidateIds = new Set(
        candidates.map((mutation) => mutation.operationId),
      )

      const replacementIds = new Map<string, string>()
      const skippedIds = new Set<string>()
      const scopedIds = new Set(scoped.map((mutation) => mutation.operationId))
      let workingPlan = planRow.data
      let count = 0

      for (const mutation of candidates) {
        if (
          mutation.dependsOnOperationIds.some(
            (operationId) =>
              candidateIds.has(operationId) &&
              (skippedIds.has(operationId) || !replacementIds.has(operationId)),
          )
        ) {
          skippedIds.add(mutation.operationId)
          continue
        }

        const replacement = rebaseConflictedMutation(mutation, workingPlan)

        if (!replacement) {
          skippedIds.add(mutation.operationId)
          continue
        }

        replacement.dependsOnOperationIds =
          mutation.dependsOnOperationIds.flatMap((operationId) => {
            if (candidateIds.has(operationId)) {
              const replacementId = replacementIds.get(operationId)
              return replacementId ? [replacementId] : []
            }

            return scopedIds.has(operationId) ? [operationId] : []
          })
        const persisted = {
          ...replacement,
          ...(mutation.sequence === undefined
            ? {}
            : { sequence: mutation.sequence }),
        }

        if (mutation.sequence === undefined) {
          persisted.sequence = await db.mutationQueue.add(replacement)
        } else {
          await db.mutationQueue.delete(mutation.sequence)
          await db.mutationQueue.put(persisted)
        }

        replacementIds.set(mutation.operationId, replacement.operationId)
        workingPlan = projectCleaningPlan(workingPlan, [persisted])
        count += 1
      }

      for (const mutation of scoped) {
        if (
          replacementIds.has(mutation.operationId) ||
          mutation.sequence === undefined
        ) {
          continue
        }

        const dependsOnOperationIds = mutation.dependsOnOperationIds.map(
          (operationId) => replacementIds.get(operationId) ?? operationId,
        )

        if (
          dependsOnOperationIds.some(
            (operationId, index) =>
              operationId !== mutation.dependsOnOperationIds[index],
          )
        ) {
          await updateMutationBySequence(db, mutation, {
            dependsOnOperationIds,
          })
        }
      }

      return count
    }),
  )

  notifyQueueListeners()
  return retried
}

export function getCleaningOfflineWorkspaceWriteGeneration(
  workspaceId: string,
): number {
  const runtimeGeneration = workspaceWriteGenerations.get(workspaceId) ?? 0
  const persistedGeneration =
    readStoredCleaningWorkspaceWriteGeneration(workspaceId)
  const generation = Math.max(runtimeGeneration, persistedGeneration)

  if (generation !== runtimeGeneration) {
    workspaceWriteGenerations.set(workspaceId, generation)
  }

  return generation
}

export function isCleaningOfflineWorkspaceWriteGenerationCurrent(
  workspaceId: string,
  expectedWriteGeneration: number,
): boolean {
  return isGenerationCurrent(workspaceId, expectedWriteGeneration)
}

function getCleaningOfflineDatabaseForMaintenance(): CleaningOfflineDatabase | null {
  if (typeof indexedDB === 'undefined') {
    return null
  }

  database ??= new CleaningOfflineDatabase()
  return database
}

async function getCleaningOfflineDatabaseForAccess(): Promise<CleaningOfflineDatabase | null> {
  if ((await probeCleaningOfflineStorage()) !== 'ready') {
    return null
  }

  return getCleaningOfflineDatabaseForMaintenance()
}

async function applyPendingCleaningWorkspacePurges(
  db: CleaningOfflineDatabase,
): Promise<void> {
  while (true) {
    const pendingPurges = Object.entries(readStoredCleaningPendingPurges())

    if (pendingPurges.length === 0) {
      return
    }

    for (const [workspaceId, marker] of pendingPurges) {
      await purgeCleaningWorkspaceData(db, workspaceId)

      if (!removeCleaningPendingPurge(workspaceId, marker)) {
        throw new CleaningOfflinePurgeMarkerUnavailableError()
      }
    }
  }
}

function purgeCleaningWorkspaceData(
  db: CleaningOfflineDatabase,
  workspaceId: string,
): Promise<void> {
  return db.transaction(
    'rw',
    [db.cachedPlans, db.cachedTodayResponses, db.mutationQueue],
    async () => {
      await Promise.all([
        db.cachedPlans.where('workspaceId').equals(workspaceId).delete(),
        db.cachedTodayResponses
          .where('workspaceId')
          .equals(workspaceId)
          .delete(),
        db.mutationQueue.where('workspaceId').equals(workspaceId).delete(),
      ])
    },
  )
}

function createPlanKey(workspaceId: string, actorUserId: string): string {
  return `${workspaceId}:${actorUserId}:plan`
}

function createTodayKey(
  workspaceId: string,
  actorUserId: string,
  date: string,
): string {
  return `${workspaceId}:${actorUserId}:today:${date}`
}

function listScopedMutations(
  db: CleaningOfflineDatabase,
  workspaceId: string,
  actorUserId: string,
): Promise<CleaningOfflineMutationRecord[]> {
  return db.mutationQueue
    .where('[workspaceId+actorUserId]')
    .equals([workspaceId, actorUserId])
    .sortBy('sequence')
}

function findCoalescedAction(
  mutations: CleaningOfflineMutationRecord[],
  input: CleaningOfflineMutationInput,
): Extract<CleaningOfflineMutationRecord, { type: 'task.action' }> | null {
  if (input.type !== 'task.action') {
    return null
  }

  const candidate = [...mutations]
    .reverse()
    .find(
      (
        mutation,
      ): mutation is Extract<
        CleaningOfflineMutationRecord,
        { type: 'task.action' }
      > =>
        mutation.type === 'task.action' &&
        mutation.taskId === input.taskId &&
        mutation.input.date === input.input.date &&
        (mutation.status === 'pending' || mutation.status === 'failed'),
    )

  if (!candidate) {
    return null
  }

  const candidateOrder = candidate.sequence ?? Number.MAX_SAFE_INTEGER
  const hasInterveningRelatedMutation = mutations.some(
    (mutation) =>
      mutation.operationId !== candidate.operationId &&
      (mutation.sequence ?? Number.MAX_SAFE_INTEGER) > candidateOrder &&
      mutation.entityKeys.some((key) => input.entityKeys.includes(key)),
  )
  const hasDependentMutation = mutations.some(
    (mutation) =>
      mutation.operationId !== candidate.operationId &&
      mutation.dependsOnOperationIds.includes(candidate.operationId),
  )

  return hasInterveningRelatedMutation || hasDependentMutation
    ? null
    : candidate
}

function getCleaningMutationEntityKeys(
  input: CleaningOfflineMutationInput,
): string[] {
  const entityKeys = new Set(input.entityKeys)

  if (
    (input.type === 'task.create' || input.type === 'task.update') &&
    input.input.zoneId
  ) {
    entityKeys.add(`zone:${input.input.zoneId}`)
  }

  if (input.type === 'zone.delete') {
    for (const task of input.expectedTaskVersions) {
      entityKeys.add(`task:${task.taskId}`)
    }
  }

  if (input.type === 'cleaning.seed') {
    for (const entry of input.input.zones) {
      if (entry.zone.id) {
        entityKeys.add(`zone:${entry.zone.id}`)
      }

      for (const task of entry.tasks) {
        if (task.id) {
          entityKeys.add(`task:${task.id}`)
        }
      }
    }
  }

  return [...entityKeys]
}

function rebaseConflictedMutation(
  mutation: CleaningOfflineMutationRecord,
  plan: CleaningListResponse,
): CleaningOfflineMutationRecord | null {
  const now = new Date().toISOString()
  const { sequence: _sequence, ...record } = mutation
  const base = {
    ...record,
    attemptCount: 0,
    conflictActualVersion: null,
    conflictExpectedVersion: null,
    dependsOnOperationIds: [],
    lastError: null,
    operationId: generateUuidV7(),
    status: 'pending' as const,
    updatedAt: now,
  }

  if (mutation.type === 'zone.update') {
    const zone = plan.zones.find((item) => item.id === mutation.zoneId)
    return zone
      ? ({
          ...base,
          expectedVersion: zone.version,
        } as CleaningOfflineMutationRecord)
      : null
  }

  if (mutation.type === 'zone.delete') {
    const zone = plan.zones.find((item) => item.id === mutation.zoneId)

    return zone
      ? ({
          ...base,
          expectedTaskVersions: plan.tasks
            .filter((task) => task.zoneId === zone.id)
            .map((task) => ({ taskId: task.id, version: task.version })),
          expectedVersion: zone.version,
        } as CleaningOfflineMutationRecord)
      : null
  }

  if (mutation.type === 'task.update') {
    const task = plan.tasks.find((item) => item.id === mutation.taskId)
    return task
      ? ({
          ...base,
          expectedVersion: task.version,
        } as CleaningOfflineMutationRecord)
      : null
  }

  if (mutation.type === 'task.delete') {
    const task = plan.tasks.find((item) => item.id === mutation.taskId)
    return task
      ? ({
          ...base,
          expectedVersion: task.version,
        } as CleaningOfflineMutationRecord)
      : null
  }

  if (mutation.type === 'task.action') {
    const task = plan.tasks.find((item) => item.id === mutation.taskId)

    if (!task) {
      return null
    }

    const state = plan.states.find((item) => item.taskId === mutation.taskId)
    return {
      ...base,
      expectedStateVersion: state?.version ?? 1,
      expectedTaskVersion: task.version,
    } as CleaningOfflineMutationRecord
  }

  return base
}

async function updateScopedMutation(
  operationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
  update: (
    mutation: CleaningOfflineMutationRecord,
  ) => Partial<CleaningOfflineMutationRecord>,
): Promise<void> {
  const db = await getCleaningOfflineDatabaseForAccess()

  if (!db) {
    return
  }

  await db.transaction('rw', db.mutationQueue, async () => {
    assertGenerationCurrent(workspaceId, expectedWriteGeneration)
    const mutation = await db.mutationQueue
      .where('operationId')
      .equals(operationId)
      .first()

    if (
      !mutation ||
      mutation.workspaceId !== workspaceId ||
      mutation.actorUserId !== actorUserId ||
      mutation.sequence === undefined
    ) {
      return
    }

    await db.mutationQueue.update(mutation.sequence, update(mutation))
  })
  notifyQueueListeners()
}

function updateMutationBySequence(
  db: CleaningOfflineDatabase,
  mutation: CleaningOfflineMutationRecord,
  update: Partial<CleaningOfflineMutationRecord>,
): Promise<number> {
  return mutation.sequence === undefined
    ? Promise.resolve(0)
    : db.mutationQueue.update(mutation.sequence, update)
}

async function pruneCachedTodayResponses(
  db: CleaningOfflineDatabase,
  workspaceId: string,
  actorUserId: string,
): Promise<void> {
  const rows = await db.cachedTodayResponses
    .where('[workspaceId+actorUserId]')
    .equals([workspaceId, actorUserId])
    .sortBy('date')
  const obsoleteKeys = rows
    .slice(0, Math.max(0, rows.length - CLEANING_TODAY_CACHE_LIMIT))
    .map((row) => row.key)

  if (obsoleteKeys.length > 0) {
    await db.cachedTodayResponses.bulkDelete(obsoleteKeys)
  }
}

async function runSerializedWrite<T>(
  storageKey: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = pendingWrites.get(storageKey) ?? Promise.resolve()
  const current = previous
    .catch(() => undefined)
    .then(async () => {
      const failureEpochAtStart = storageFailureEpoch
      const result = await write()
      setCleaningOfflineStorageReadyIfCurrent(failureEpochAtStart, false)
      return result
    })
  pendingWrites.set(storageKey, current)

  try {
    return await current
  } catch (error) {
    markCleaningOfflineStorageFailure(error)
    throw error
  } finally {
    if (pendingWrites.get(storageKey) === current) {
      pendingWrites.delete(storageKey)
    }
  }
}

function markCleaningOfflineStorageFailure(error: unknown): void {
  if (!isCleaningOfflineStorageFailure(error)) {
    return
  }

  storageFailureEpoch += 1
  database?.close()
  database = null
  setCleaningOfflineStorageHealth('failed')
}

function setCleaningOfflineStorageReadyIfCurrent(
  expectedFailureEpoch: number,
  allowFailedRecovery: boolean,
): void {
  if (
    storageFailureEpoch === expectedFailureEpoch &&
    (allowFailedRecovery || storageHealth !== 'failed')
  ) {
    setCleaningOfflineStorageHealth('ready')
  }
}

function isCleaningOfflineStorageFailure(error: unknown): boolean {
  const name =
    error instanceof DOMException || error instanceof Error ? error.name : ''

  return [
    'DatabaseClosedError',
    'InvalidAccessError',
    'InvalidStateError',
    'MissingAPIError',
    'NotReadableError',
    'OpenFailedError',
    'QuotaExceededError',
    'SecurityError',
    'UnknownError',
    'UnsupportedError',
    'VersionChangeError',
    'VersionError',
  ].includes(name)
}

function setCleaningOfflineStorageHealth(
  nextHealth: CleaningOfflineStorageHealth,
): void {
  if (storageHealth === nextHealth) {
    return
  }

  storageHealth = nextHealth
  notifyQueueListeners()
}

async function waitForWorkspaceWrites(workspaceId: string): Promise<void> {
  const prefix = `${workspaceId}:`
  const writes = [...pendingWrites.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, write]) => write)

  await Promise.allSettled(writes)
}

function isGenerationCurrent(
  workspaceId: string,
  expectedWriteGeneration: number,
): boolean {
  return (
    expectedWriteGeneration ===
    getCleaningOfflineWorkspaceWriteGeneration(workspaceId)
  )
}

function assertGenerationCurrent(
  workspaceId: string,
  expectedWriteGeneration: number,
): void {
  if (!isGenerationCurrent(workspaceId, expectedWriteGeneration)) {
    throw new CleaningOfflineGenerationInvalidatedError()
  }
}

function notifyQueueListeners(): void {
  for (const listener of queueListeners) {
    try {
      listener()
    } catch (error) {
      console.warn('Cleaning offline queue listener failed.', error)
    }
  }
}

function beginCleaningOfflineWorkspacePurge(
  workspaceId: string,
  generation: number,
): string | null {
  workspaceWriteGenerations.set(workspaceId, generation)
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const marker = generateUuidV7()
    const storageKey = createCleaningOfflineLifecycleStorageKey(workspaceId)
    const serialized = JSON.stringify({
      pendingPurgeMarker: marker,
      writeGeneration: generation,
    } satisfies CleaningOfflineLifecycleState)
    window.localStorage.setItem(storageKey, serialized)

    return window.localStorage.getItem(storageKey) === serialized
      ? marker
      : null
  } catch {
    return null
  }
}

function removeCleaningPendingPurge(
  workspaceId: string,
  expectedMarker: string | null,
): boolean {
  if (expectedMarker === null || typeof window === 'undefined') {
    return expectedMarker === null
  }

  try {
    const storageKey = createCleaningOfflineLifecycleStorageKey(workspaceId)
    const rawValue = window.localStorage.getItem(storageKey)

    if (rawValue === null) {
      return true
    }

    const lifecycle = parseCleaningOfflineLifecycleState(rawValue)

    if (!lifecycle) {
      return false
    }

    if (lifecycle.pendingPurgeMarker !== expectedMarker) {
      return true
    }

    const serialized = JSON.stringify({
      pendingPurgeMarker: null,
      writeGeneration: lifecycle.writeGeneration,
    } satisfies CleaningOfflineLifecycleState)
    window.localStorage.setItem(storageKey, serialized)

    return window.localStorage.getItem(storageKey) === serialized
  } catch {
    return false
  }
}

function readStoredCleaningPendingPurges(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const pendingPurges: Record<string, string> = {}

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index)

      if (
        !storageKey?.startsWith(CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)
      ) {
        continue
      }

      const workspaceId = decodeURIComponent(
        storageKey.slice(CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX.length),
      )
      const lifecycle = parseCleaningOfflineLifecycleState(
        window.localStorage.getItem(storageKey),
      )

      if (lifecycle?.pendingPurgeMarker) {
        pendingPurges[workspaceId] = lifecycle.pendingPurgeMarker
      }
    }

    return pendingPurges
  } catch {
    return {}
  }
}

function readStoredCleaningWorkspaceWriteGeneration(
  workspaceId: string,
): number {
  if (typeof window === 'undefined') {
    return 0
  }

  try {
    return (
      parseCleaningOfflineLifecycleState(
        window.localStorage.getItem(
          createCleaningOfflineLifecycleStorageKey(workspaceId),
        ),
      )?.writeGeneration ?? 0
    )
  } catch {
    return 0
  }
}

function parseCleaningOfflineLifecycleState(
  rawValue: string | null,
): CleaningOfflineLifecycleState | null {
  if (!rawValue) {
    return null
  }

  try {
    const parsedValue = JSON.parse(rawValue) as unknown

    if (
      !parsedValue ||
      typeof parsedValue !== 'object' ||
      Array.isArray(parsedValue)
    ) {
      return null
    }

    const value = parsedValue as Record<string, unknown>
    const pendingPurgeMarker = value.pendingPurgeMarker
    const writeGeneration = value.writeGeneration

    if (
      (pendingPurgeMarker !== null &&
        (typeof pendingPurgeMarker !== 'string' ||
          pendingPurgeMarker.length === 0)) ||
      typeof writeGeneration !== 'number' ||
      !Number.isSafeInteger(writeGeneration) ||
      writeGeneration < 0
    ) {
      return null
    }

    return { pendingPurgeMarker, writeGeneration }
  } catch {
    return null
  }
}

function createCleaningOfflineLifecycleStorageKey(workspaceId: string): string {
  return `${CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
}

function removeStoredCleaningLifecycleStates(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    const storageKeys: string[] = []

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const storageKey = window.localStorage.key(index)

      if (
        storageKey?.startsWith(CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)
      ) {
        storageKeys.push(storageKey)
      }
    }

    for (const storageKey of storageKeys) {
      window.localStorage.removeItem(storageKey)
    }
  } catch {
    // Test cleanup remains best-effort when localStorage is unavailable.
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (!event.key?.startsWith(CLEANING_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)) {
      return
    }

    storageHealth = typeof indexedDB === 'undefined' ? 'unavailable' : 'unknown'
    notifyQueueListeners()
  })
}

export class CleaningOfflineGenerationInvalidatedError extends Error {}

export class CleaningOfflineMutationNotPersistedError extends Error {
  constructor(cause: unknown) {
    super('Cleaning offline mutation was not persisted.', { cause })
    this.name = 'CleaningOfflineMutationNotPersistedError'
  }
}

export class CleaningOfflinePurgeUnavailableError extends Error {
  constructor() {
    super('Не удалось надёжно очистить локальные данные уборки.')
    this.name = 'CleaningOfflinePurgeUnavailableError'
  }
}

class CleaningOfflinePurgeMarkerUnavailableError extends Error {
  constructor() {
    super('Cleaning offline purge marker could not be removed.')
    this.name = 'CleaningOfflinePurgeMarkerUnavailableError'
  }
}
