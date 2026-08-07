import type {
  SelfCareOfflineCommand,
  SelfCareOfflineCommandResult,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

export interface SelfCareCachedRead<TData> {
  data: TData
  lastSuccessfulSyncAt: string
}

export interface SelfCareCachedReadVersion {
  lastSuccessfulSyncAt: string
  writeGeneration: number
}

interface SelfCareCachedReadRow {
  actorUserId: string
  cacheKey?: string | undefined
  data: unknown
  key: string
  lastSuccessfulSyncAt: string
  requestStartedAt?: number | undefined
  scope: string
  valueVersion: number
  workspaceId: string
}

export interface SelfCareConfirmedCachedScope {
  cacheKey: string
  data: unknown
  scope: string
}

export type SelfCareOfflineMutationStatus =
  'awaiting_refresh' | 'conflicted' | 'failed' | 'pending' | 'syncing'

export type SelfCareOfflineStorageHealth = 'failed' | 'ready' | 'unknown'

export interface SelfCareOfflineMutationConflict {
  actualVersion: number | null
  entityId: string | null
  entityType: string | null
  expectedVersion: number | null
}

export class SelfCareOfflineMutationCollisionError extends Error {
  readonly code = 'self_care_local_operation_id_conflict'

  constructor() {
    super('Не удалось безопасно сохранить изменение. Создайте его повторно.')
    this.name = 'SelfCareOfflineMutationCollisionError'
  }
}

export class SelfCareOfflinePurgeUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'Не удалось безопасно очистить локальные данные self-care. Повторите действие после перезапуска приложения.',
      options,
    )
    this.name = 'SelfCareOfflinePurgeUnavailableError'
  }
}

export interface SelfCareOfflineMutationRecord {
  actorUserId: string
  attemptCount: number
  clientTimeZone?: string | undefined
  command: SelfCareOfflineCommand
  conflict: SelfCareOfflineMutationConflict | null
  createdAt: string
  dependsOn: string[]
  id: string
  lastError: string | null
  occurredAt: string
  operationId: string
  optimisticResult: SelfCareOfflineCommandResult
  sequence: number
  serverResult: SelfCareOfflineCommandResult | null
  status: SelfCareOfflineMutationStatus
  updatedAt: string
  workspaceId: string
}

export interface EnqueueSelfCareOfflineMutationInput {
  actorUserId: string
  clientTimeZone?: string | undefined
  command: SelfCareOfflineCommand
  dependsOn?: readonly string[] | undefined
  expectedWriteGeneration?: number | undefined
  occurredAt: string
  operationId: string
  optimisticResult: SelfCareOfflineCommandResult
  workspaceId: string
}

export interface RebaseSelfCareOfflineMutationInput {
  command: SelfCareOfflineCommand
  mutationId: string
  operationId?: string | undefined
  optimisticResult: SelfCareOfflineCommandResult
}

export interface SelfCareOfflineOverlay {
  command: SelfCareOfflineCommand
  operationId: string
  result: SelfCareOfflineCommandResult
  sequence: number
  status: Exclude<SelfCareOfflineMutationStatus, 'conflicted'>
}

export type ApplySelfCareOfflineOverlay<TData> = (
  data: TData,
  overlay: SelfCareOfflineOverlay,
) => TData

export type ApplySelfCareOfflineOverlayToCachedScope = (
  scope: string,
  cacheKey: string,
  data: unknown,
  overlay: SelfCareOfflineOverlay,
) => unknown

export const SELF_CARE_OFFLINE_DATABASE_NAME = 'self-care-offline'
export const SELF_CARE_OFFLINE_SCHEMA_VERSION = 3
export const SELF_CARE_CACHE_VALUE_VERSION = 2
export const SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX =
  'planner.selfCareOfflineLifecycle:'

interface SelfCareOfflineLifecycleState {
  pendingPurges: Record<string, number>
  writeGenerations: Record<string, number>
}

interface SelfCareOfflineWorkspaceLifecycleState {
  pendingPurgeGeneration: number | null
  writeGeneration: number
}

const CACHE_ROW_LIMIT_BY_SCOPE: Readonly<Record<string, number>> = {
  analytics: 2,
  dashboard: 7,
  history: 3,
  items: 1,
  plan: 3,
  'ritual-step-drafts': 7,
  settings: 1,
  templates: 1,
}

const RETRYABLE_STATUSES: readonly SelfCareOfflineMutationStatus[] = [
  'failed',
  'pending',
  'syncing',
]

class SelfCareOfflineDatabase extends Dexie {
  cachedReads!: Table<SelfCareCachedReadRow, string>
  mutationQueue!: Table<SelfCareOfflineMutationRecord, string>

  constructor() {
    super(SELF_CARE_OFFLINE_DATABASE_NAME)

    this.version(1).stores({
      cachedReads:
        'key, workspaceId, scope, lastSuccessfulSyncAt, [workspaceId+scope]',
    })
    this.version(2)
      .stores({
        cachedReads:
          'key, workspaceId, actorUserId, scope, lastSuccessfulSyncAt, [workspaceId+actorUserId], [workspaceId+actorUserId+scope]',
      })
      .upgrade((transaction) => transaction.table('cachedReads').clear())
    this.version(SELF_CARE_OFFLINE_SCHEMA_VERSION)
      .stores({
        cachedReads:
          'key, workspaceId, actorUserId, scope, lastSuccessfulSyncAt, [workspaceId+actorUserId], [workspaceId+actorUserId+scope]',
        mutationQueue:
          'id, &operationId, workspaceId, actorUserId, status, sequence, [workspaceId+actorUserId], [workspaceId+actorUserId+sequence]',
      })
      .upgrade((transaction) => transaction.table('cachedReads').clear())
  }
}

let database: SelfCareOfflineDatabase | null = null
let storageHealth: SelfCareOfflineStorageHealth =
  typeof indexedDB === 'undefined' ? 'failed' : 'unknown'
let storageProbe: Promise<SelfCareOfflineStorageHealth> | null = null
let storageFailureEpoch = 0
let lifecycleStorageListenerAttached = false
const latestCachedReadVersions = new Map<string, SelfCareCachedReadVersion>()
const pendingWrites = new Map<string, Promise<unknown>>()
const workspaceWriteGenerations = new Map<string, number>()
const localPendingPurgeWorkspaces = new Map<string, number>()
const queueListeners = new Set<() => void>()

export function isSelfCareOfflineStorageAvailable(): boolean {
  return getSelfCareOfflineStorageHealth() === 'ready'
}

export function getSelfCareOfflineStorageHealth(): SelfCareOfflineStorageHealth {
  if (!hasSelfCareOfflineStorageApi()) {
    return 'failed'
  }

  if (storageHealth === 'ready' && hasPendingSelfCareOfflinePurges()) {
    return 'unknown'
  }

  return storageHealth
}

export async function probeSelfCareOfflineStorage(): Promise<SelfCareOfflineStorageHealth> {
  if (!hasSelfCareOfflineStorageApi()) {
    setSelfCareOfflineStorageHealth('failed')
    return 'failed'
  }

  const currentHealth = getSelfCareOfflineStorageHealth()

  if (currentHealth !== 'unknown') {
    return currentHealth
  }

  storageProbe ??= probeSelfCareOfflineStorageOnce().finally(() => {
    storageProbe = null
  })
  return storageProbe
}

export function reportSelfCareOfflineStorageFailure(error: unknown): boolean {
  if (!isSelfCareOfflineStorageFailure(error)) {
    return false
  }

  database?.close()
  database = null
  storageFailureEpoch += 1
  setSelfCareOfflineStorageHealth('failed')
  return true
}

export function createSelfCareCacheKey(
  scope: string,
  parameters: readonly string[] = [],
): string {
  return [scope, ...parameters.map(encodeURIComponent)].join(':')
}

export async function loadCachedSelfCareRead<TData>(
  workspaceId: string,
  actorUserId: string,
  cacheKey: string,
): Promise<SelfCareCachedRead<TData> | null> {
  const db = getSelfCareOfflineDatabase()
  const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)

  if (!db) {
    return null
  }

  const storageKey = toStorageKey(workspaceId, actorUserId, cacheKey)
  const row = await db.cachedReads.get(storageKey)

  if (
    !row ||
    row.valueVersion !== SELF_CARE_CACHE_VALUE_VERSION ||
    !isSelfCareOfflineWorkspaceWriteGenerationCurrent(workspaceId, generation)
  ) {
    return null
  }

  observeCachedReadVersion(storageKey, {
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
    writeGeneration: generation,
  })

  return {
    data: row.data as TData,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt,
  }
}

export async function loadConfirmedSelfCareCachedScopes(
  workspaceId: string,
  actorUserId: string,
  expectedReadGeneration = getSelfCareOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<SelfCareConfirmedCachedScope[]> {
  const db = getSelfCareOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.cachedReads
    .where('[workspaceId+actorUserId]')
    .equals([workspaceId, actorUserId])
    .toArray()

  if (
    !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      expectedReadGeneration,
    )
  ) {
    return []
  }

  return rows
    .filter((row) => row.valueVersion === SELF_CARE_CACHE_VALUE_VERSION)
    .map((row) => ({
      cacheKey: row.cacheKey ?? row.scope,
      data: row.data,
      scope: row.scope,
    }))
}

export async function loadProjectedCachedSelfCareRead<TData>(
  workspaceId: string,
  actorUserId: string,
  cacheKey: string,
  applyOverlay: ApplySelfCareOfflineOverlay<TData>,
): Promise<SelfCareCachedRead<TData> | null> {
  const db = getSelfCareOfflineDatabase()
  const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)

  if (
    !db ||
    !isSelfCareOfflineWorkspaceWriteGenerationCurrent(workspaceId, generation)
  ) {
    return null
  }

  const storageKey = toStorageKey(workspaceId, actorUserId, cacheKey)
  const snapshot = await db.transaction(
    'r',
    [db.cachedReads, db.mutationQueue],
    async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          generation,
        )
      ) {
        return null
      }

      const [row, mutations] = await Promise.all([
        db.cachedReads.get(storageKey),
        listOwnerMutations(db, workspaceId, actorUserId),
      ])

      if (
        !row ||
        row.valueVersion !== SELF_CARE_CACHE_VALUE_VERSION ||
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          generation,
        )
      ) {
        return null
      }

      return { mutations, row }
    },
  )

  if (
    !snapshot ||
    !isSelfCareOfflineWorkspaceWriteGenerationCurrent(workspaceId, generation)
  ) {
    return null
  }

  observeCachedReadVersion(storageKey, {
    lastSuccessfulSyncAt: snapshot.row.lastSuccessfulSyncAt,
    writeGeneration: generation,
  })

  return {
    data: applySelfCareOfflineOverlays(
      snapshot.row.data as TData,
      snapshot.mutations,
      applyOverlay,
    ),
    lastSuccessfulSyncAt: snapshot.row.lastSuccessfulSyncAt,
  }
}

export function applySelfCareOfflineOverlays<TData>(
  base: TData,
  mutations: readonly SelfCareOfflineMutationRecord[],
  applyOverlay: ApplySelfCareOfflineOverlay<TData>,
): TData {
  return mutations
    .filter(isOverlayActive)
    .sort(compareMutations)
    .reduce(
      (current, mutation) =>
        applyOverlay(current, {
          command: mutation.command,
          operationId: mutation.operationId,
          result: resolveMutationOverlayResult(mutation),
          sequence: mutation.sequence,
          status: mutation.status as SelfCareOfflineOverlay['status'],
        }),
      base,
    )
}

export async function saveCachedSelfCareRead<TData>(
  workspaceId: string,
  actorUserId: string,
  scope: string,
  cacheKey: string,
  data: TData,
  lastSuccessfulSyncAt = new Date().toISOString(),
  expectedWriteGeneration = getSelfCareOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
  requestStartedAt = 0,
): Promise<SelfCareCachedRead<TData>> {
  const cachedRead = { data, lastSuccessfulSyncAt }
  const db = getSelfCareOfflineDatabase()

  if (!db) {
    return cachedRead
  }

  const storageKey = toStorageKey(workspaceId, actorUserId, cacheKey)

  const stored = await runSerializedWrite(storageKey, () =>
    db.transaction('rw', db.cachedReads, async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          expectedWriteGeneration,
        )
      ) {
        return { read: cachedRead }
      }

      const current = await db.cachedReads.get(storageKey)

      if (
        current?.valueVersion === SELF_CARE_CACHE_VALUE_VERSION &&
        (current.requestStartedAt ?? 0) > requestStartedAt
      ) {
        return {
          read: {
            data: current.data as TData,
            lastSuccessfulSyncAt: current.lastSuccessfulSyncAt,
          },
        }
      }

      await db.cachedReads.put({
        actorUserId,
        cacheKey,
        data,
        key: storageKey,
        lastSuccessfulSyncAt,
        requestStartedAt,
        scope,
        valueVersion: SELF_CARE_CACHE_VALUE_VERSION,
        workspaceId,
      })
      await pruneCachedScope(db, workspaceId, actorUserId, scope)
      return { read: cachedRead }
    }),
  )

  if (
    isSelfCareOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      expectedWriteGeneration,
    )
  ) {
    observeCachedReadVersion(storageKey, {
      lastSuccessfulSyncAt: stored.read.lastSuccessfulSyncAt,
      writeGeneration: expectedWriteGeneration,
    })
  }

  return stored.read
}

export async function updateCachedSelfCareReadDataIfUnchanged<TData>(
  workspaceId: string,
  actorUserId: string,
  cacheKey: string,
  expectedLastSuccessfulSyncAt: string,
  data: TData,
  expectedWriteGeneration = getSelfCareOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<SelfCareCachedRead<TData> | null> {
  const db = getSelfCareOfflineDatabase()

  if (!db) {
    return null
  }

  const storageKey = toStorageKey(workspaceId, actorUserId, cacheKey)

  return runSerializedWrite(storageKey, () =>
    db.transaction('rw', db.cachedReads, async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          expectedWriteGeneration,
        )
      ) {
        return null
      }

      const current = await db.cachedReads.get(storageKey)

      if (
        !current ||
        current.valueVersion !== SELF_CARE_CACHE_VALUE_VERSION ||
        current.lastSuccessfulSyncAt !== expectedLastSuccessfulSyncAt
      ) {
        return null
      }

      await db.cachedReads.put({ ...current, data })

      return { data, lastSuccessfulSyncAt: current.lastSuccessfulSyncAt }
    }),
  )
}

export async function enqueueSelfCareOfflineMutation(
  input: EnqueueSelfCareOfflineMutationInput,
): Promise<SelfCareOfflineMutationRecord | null> {
  const db = getSelfCareOfflineDatabase()
  const generation =
    input.expectedWriteGeneration ??
    getSelfCareOfflineWorkspaceWriteGeneration(input.workspaceId)

  if (!db) {
    return null
  }

  const mutation = await runSerializedWrite(
    queueWriteKey(input.workspaceId),
    () =>
      db.transaction('rw', db.mutationQueue, async () => {
        if (
          !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
            input.workspaceId,
            generation,
          )
        ) {
          return null
        }

        const duplicate = await db.mutationQueue
          .where('operationId')
          .equals(input.operationId)
          .first()

        if (duplicate) {
          if (
            duplicate.workspaceId === input.workspaceId &&
            duplicate.actorUserId === input.actorUserId &&
            areJsonValuesEqual(duplicate.command, input.command)
          ) {
            return duplicate
          }

          throw new SelfCareOfflineMutationCollisionError()
        }

        const existing = await listOwnerMutations(
          db,
          input.workspaceId,
          input.actorUserId,
        )
        const now = new Date().toISOString()
        const record: SelfCareOfflineMutationRecord = {
          actorUserId: input.actorUserId,
          attemptCount: 0,
          ...(input.clientTimeZone
            ? { clientTimeZone: input.clientTimeZone }
            : {}),
          command: input.command,
          conflict: null,
          createdAt: now,
          dependsOn: [...(input.dependsOn ?? [])],
          id: input.operationId,
          lastError: null,
          occurredAt: input.occurredAt,
          operationId: input.operationId,
          optimisticResult: input.optimisticResult,
          sequence:
            existing.reduce(
              (maximum, candidate) => Math.max(maximum, candidate.sequence),
              0,
            ) + 1,
          serverResult: null,
          status: 'pending',
          updatedAt: now,
          workspaceId: input.workspaceId,
        }
        await db.mutationQueue.put(record)

        return record
      }),
  )

  if (mutation) {
    notifyQueueListeners()
  }

  return mutation
}

export async function listSelfCareOfflineMutations(
  workspaceId: string,
  actorUserId: string,
  expectedReadGeneration = getSelfCareOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<SelfCareOfflineMutationRecord[]> {
  const db = getSelfCareOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await listOwnerMutations(db, workspaceId, actorUserId)

  return isSelfCareOfflineWorkspaceWriteGenerationCurrent(
    workspaceId,
    expectedReadGeneration,
  )
    ? rows
    : []
}

export async function listRetryableSelfCareOfflineMutations(
  workspaceId: string,
  actorUserId: string,
  expectedReadGeneration = getSelfCareOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<SelfCareOfflineMutationRecord[]> {
  return (
    await listSelfCareOfflineMutations(
      workspaceId,
      actorUserId,
      expectedReadGeneration,
    )
  ).filter((mutation) => RETRYABLE_STATUSES.includes(mutation.status))
}

export async function countSelfCareOfflineMutations(
  workspaceId: string,
  actorUserId: string,
): Promise<{
  awaitingRefresh: number
  conflicted: number
  failed: number
  pending: number
  total: number
}> {
  const rows = await listSelfCareOfflineMutations(workspaceId, actorUserId)

  return {
    awaitingRefresh: rows.filter((row) => row.status === 'awaiting_refresh')
      .length,
    conflicted: rows.filter((row) => row.status === 'conflicted').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    pending: rows.filter(
      (row) => row.status === 'pending' || row.status === 'syncing',
    ).length,
    total: rows.length,
  }
}

export async function markSelfCareOfflineMutationSyncing(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
): Promise<void> {
  await updateMutation(
    mutationId,
    workspaceId,
    actorUserId,
    expectedWriteGeneration,
    (mutation) => ({
      ...mutation,
      attemptCount: mutation.attemptCount + 1,
      conflict: null,
      lastError: null,
      status: 'syncing',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function markSelfCareOfflineMutationFailed(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
  message: string,
): Promise<void> {
  await updateMutation(
    mutationId,
    workspaceId,
    actorUserId,
    expectedWriteGeneration,
    (mutation) => ({
      ...mutation,
      lastError: message,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function markSelfCareOfflineMutationConflicted(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
  conflict: SelfCareOfflineMutationConflict,
  message: string,
): Promise<void> {
  await updateMutation(
    mutationId,
    workspaceId,
    actorUserId,
    expectedWriteGeneration,
    (mutation) => ({
      ...mutation,
      conflict,
      lastError: message,
      serverResult: null,
      status: 'conflicted',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function markSelfCareOfflineMutationAwaitingRefresh(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
  serverResult: SelfCareOfflineCommandResult,
): Promise<void> {
  await updateMutation(
    mutationId,
    workspaceId,
    actorUserId,
    expectedWriteGeneration,
    (mutation) => ({
      ...mutation,
      conflict: null,
      lastError: null,
      serverResult,
      status: 'awaiting_refresh',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function completeSelfCareOfflineMutation(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration = getSelfCareOfflineWorkspaceWriteGeneration(
    workspaceId,
  ),
): Promise<void> {
  const db = getSelfCareOfflineDatabase()

  if (!db) {
    return
  }

  await runSerializedWrite(queueWriteKey(workspaceId), () =>
    db.transaction('rw', db.mutationQueue, async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          expectedWriteGeneration,
        )
      ) {
        return
      }

      const current = await db.mutationQueue.get(mutationId)

      if (
        current?.workspaceId === workspaceId &&
        current.actorUserId === actorUserId
      ) {
        const ownerMutations = await listOwnerMutations(
          db,
          workspaceId,
          actorUserId,
        )
        await db.mutationQueue.bulkPut(
          ownerMutations
            .filter((mutation) => mutation.dependsOn.includes(mutationId))
            .map((mutation) => ({
              ...mutation,
              dependsOn: mutation.dependsOn.filter(
                (dependency) => dependency !== mutationId,
              ),
            })),
        )
        await db.mutationQueue.delete(mutationId)
      }
    }),
  )
  notifyQueueListeners()
}

export async function commitSelfCareOfflineMutationResult(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
  applyOverlay: ApplySelfCareOfflineOverlayToCachedScope,
  options: { retainMutation?: boolean | undefined } = {},
): Promise<boolean> {
  const db = getSelfCareOfflineDatabase()
  const expectedWriteGeneration =
    getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)

  if (!db) {
    return false
  }

  const committed = await runSerializedWrite(queueWriteKey(workspaceId), () =>
    db.transaction('rw', [db.cachedReads, db.mutationQueue], async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          expectedWriteGeneration,
        )
      ) {
        return false
      }

      const mutation = await db.mutationQueue.get(mutationId)

      if (
        !mutation ||
        mutation.workspaceId !== workspaceId ||
        mutation.actorUserId !== actorUserId ||
        !mutation.serverResult
      ) {
        return false
      }

      const rows = await db.cachedReads
        .where('[workspaceId+actorUserId]')
        .equals([workspaceId, actorUserId])
        .toArray()
      const overlay: SelfCareOfflineOverlay = {
        command: mutation.command,
        operationId: mutation.operationId,
        result: resolveMutationOverlayResult(mutation),
        sequence: mutation.sequence,
        status: 'awaiting_refresh',
      }

      await db.cachedReads.bulkPut(
        rows.map((row) => ({
          ...row,
          data: applyOverlay(
            row.scope,
            row.cacheKey ?? row.scope,
            row.data,
            overlay,
          ),
        })),
      )
      if (!options.retainMutation) {
        const ownerMutations = await listOwnerMutations(
          db,
          workspaceId,
          actorUserId,
        )
        await db.mutationQueue.bulkPut(
          ownerMutations
            .filter((candidate) => candidate.dependsOn.includes(mutationId))
            .map((candidate) => ({
              ...candidate,
              dependsOn: candidate.dependsOn.filter(
                (dependency) => dependency !== mutationId,
              ),
            })),
        )
        await db.mutationQueue.delete(mutationId)
      }
      return true
    }),
  )

  if (committed) {
    notifyQueueListeners()
  }

  return committed
}

export async function retrySelfCareOfflineMutation(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
  input: {
    command: SelfCareOfflineCommand
    dependentRebases?: readonly RebaseSelfCareOfflineMutationInput[] | undefined
    operationId: string
    optimisticResult: SelfCareOfflineCommandResult
  },
): Promise<void> {
  const db = getSelfCareOfflineDatabase()
  const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)

  if (!db) {
    return
  }

  await runSerializedWrite(queueWriteKey(workspaceId), () =>
    db.transaction('rw', db.mutationQueue, async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          generation,
        )
      ) {
        return
      }

      const ownerMutations = await listOwnerMutations(
        db,
        workspaceId,
        actorUserId,
      )
      const current = ownerMutations.find(
        (mutation) => mutation.id === mutationId,
      )

      if (!current) {
        return
      }

      const dependentIds = collectDependentMutationIds(
        ownerMutations,
        mutationId,
      )
      const rebases = input.dependentRebases ?? []

      if (
        rebases.some(
          (rebase) =>
            rebase.mutationId === mutationId ||
            !dependentIds.has(rebase.mutationId),
        )
      ) {
        throw new Error(
          'Dependent rebase is outside the retried mutation chain.',
        )
      }

      await assertOperationIdAvailable(db, input.operationId, mutationId)

      for (const rebase of rebases) {
        await assertOperationIdAvailable(
          db,
          rebase.operationId ??
            ownerMutations.find(
              (mutation) => mutation.id === rebase.mutationId,
            )!.operationId,
          rebase.mutationId,
        )
      }

      const now = new Date().toISOString()
      await db.mutationQueue.put({
        ...current,
        command: input.command,
        conflict: null,
        lastError: null,
        operationId: input.operationId,
        optimisticResult: input.optimisticResult,
        serverResult: null,
        status: 'pending',
        updatedAt: now,
      })

      for (const rebase of rebases) {
        const dependent = ownerMutations.find(
          (mutation) => mutation.id === rebase.mutationId,
        )!
        await db.mutationQueue.put({
          ...dependent,
          command: rebase.command,
          conflict: null,
          lastError: null,
          operationId: rebase.operationId ?? dependent.operationId,
          optimisticResult: rebase.optimisticResult,
          serverResult: null,
          status: 'pending',
          updatedAt: now,
        })
      }
    }),
  )
  notifyQueueListeners()
}

export async function rebaseSelfCareOfflineMutations(
  workspaceId: string,
  actorUserId: string,
  rebases: readonly RebaseSelfCareOfflineMutationInput[],
): Promise<void> {
  if (!rebases.length) {
    return
  }

  const db = getSelfCareOfflineDatabase()
  const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)

  if (!db) {
    return
  }

  await runSerializedWrite(queueWriteKey(workspaceId), () =>
    db.transaction('rw', db.mutationQueue, async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          generation,
        )
      ) {
        return
      }

      const ownerMutations = await listOwnerMutations(
        db,
        workspaceId,
        actorUserId,
      )
      const byId = new Map(
        ownerMutations.map((mutation) => [mutation.id, mutation]),
      )

      for (const rebase of rebases) {
        const current = byId.get(rebase.mutationId)

        if (!current || current.status === 'awaiting_refresh') {
          throw new Error('Self-care mutation is no longer safe to rebase.')
        }

        await assertOperationIdAvailable(
          db,
          rebase.operationId ?? current.operationId,
          current.id,
        )
      }

      const now = new Date().toISOString()
      await db.mutationQueue.bulkPut(
        rebases.map((rebase) => {
          const current = byId.get(rebase.mutationId)!
          return {
            ...current,
            command: rebase.command,
            conflict: null,
            lastError: null,
            operationId: rebase.operationId ?? current.operationId,
            optimisticResult: rebase.optimisticResult,
            serverResult: null,
            status: 'pending' as const,
            updatedAt: now,
          }
        }),
      )
    }),
  )
  notifyQueueListeners()
}

export async function cancelSelfCareOfflineMutation(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
): Promise<void> {
  const db = getSelfCareOfflineDatabase()
  const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)

  if (!db) {
    return
  }

  await runSerializedWrite(queueWriteKey(workspaceId), () =>
    db.transaction('rw', db.mutationQueue, async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          generation,
        )
      ) {
        return
      }

      const current = await db.mutationQueue.get(mutationId)

      if (
        current?.workspaceId === workspaceId &&
        current.actorUserId === actorUserId
      ) {
        const ownerMutations = await listOwnerMutations(
          db,
          workspaceId,
          actorUserId,
        )
        const removedIds = collectDependentMutationIds(
          ownerMutations,
          mutationId,
        )
        await db.mutationQueue.bulkDelete([...removedIds])
      }
    }),
  )
  notifyQueueListeners()
}

export function subscribeSelfCareOfflineQueue(
  listener: () => void,
): () => void {
  ensureSelfCareOfflineLifecycleStorageListener()
  queueListeners.add(listener)

  return () => {
    queueListeners.delete(listener)
  }
}

export async function clearSelfCareOfflineWorkspaceData(
  workspaceId: string,
): Promise<void> {
  const generation = getSelfCareOfflineWorkspaceWriteGeneration(workspaceId) + 1
  const markerPersisted = beginSelfCareOfflineWorkspacePurge(
    workspaceId,
    generation,
  )
  await waitForWorkspaceWrites(workspaceId)
  clearObservedWorkspaceVersions(workspaceId)
  notifyQueueListeners()

  if (storageHealth === 'failed') {
    if (!markerPersisted) {
      throw new SelfCareOfflinePurgeUnavailableError()
    }

    return
  }

  const db = getSelfCareOfflineLifecycleDatabase()

  if (!db) {
    if (!markerPersisted) {
      throw new SelfCareOfflinePurgeUnavailableError()
    }

    return
  }

  try {
    await purgeSelfCareOfflineWorkspaces(db, [workspaceId])
  } catch (error) {
    reportSelfCareOfflineStorageFailure(error)

    if (!markerPersisted) {
      throw new SelfCareOfflinePurgeUnavailableError({ cause: error })
    }

    return
  }

  if (!markerPersisted) {
    throw new SelfCareOfflinePurgeUnavailableError()
  }

  completeSelfCareOfflineWorkspacePurges({ [workspaceId]: generation })
  clearObservedWorkspaceVersions(workspaceId)
  notifyQueueListeners()
}

export async function resetSelfCareOfflineDatabaseForTests(): Promise<void> {
  resetSelfCareOfflineRuntimeForTests()

  if (hasSelfCareOfflineStorageApi()) {
    await Dexie.delete(SELF_CARE_OFFLINE_DATABASE_NAME)
  }

  removeStoredSelfCareOfflineLifecycleState()
}

export function resetSelfCareOfflineRuntimeForTests(): void {
  database?.close()
  database = null
  storageProbe = null
  storageFailureEpoch = 0
  latestCachedReadVersions.clear()
  pendingWrites.clear()
  workspaceWriteGenerations.clear()
  localPendingPurgeWorkspaces.clear()
  queueListeners.clear()
  storageHealth = hasSelfCareOfflineStorageApi() ? 'unknown' : 'failed'
}

export function getSelfCareOfflineWorkspaceWriteGeneration(
  workspaceId: string,
): number {
  ensureSelfCareOfflineLifecycleStorageListener()
  const runtimeGeneration = workspaceWriteGenerations.get(workspaceId) ?? 0
  const persistedGeneration =
    readStoredSelfCareOfflineWorkspaceLifecycleState(
      workspaceId,
    ).writeGeneration
  const generation = Math.max(runtimeGeneration, persistedGeneration)

  if (generation !== runtimeGeneration) {
    workspaceWriteGenerations.set(workspaceId, generation)
    clearObservedWorkspaceVersions(workspaceId)
  }

  return generation
}

export function isSelfCareOfflineWorkspaceWriteGenerationCurrent(
  workspaceId: string,
  expectedWriteGeneration: number,
): boolean {
  return (
    expectedWriteGeneration ===
    getSelfCareOfflineWorkspaceWriteGeneration(workspaceId)
  )
}

export function getSelfCareCachedReadVersion(
  workspaceId: string,
  actorUserId: string,
  cacheKey: string,
): SelfCareCachedReadVersion | null {
  return (
    latestCachedReadVersions.get(
      toStorageKey(workspaceId, actorUserId, cacheKey),
    ) ?? null
  )
}

function getSelfCareOfflineDatabase(): SelfCareOfflineDatabase | null {
  if (
    !hasSelfCareOfflineStorageApi() ||
    storageHealth === 'failed' ||
    hasPendingSelfCareOfflinePurges()
  ) {
    return null
  }

  return getSelfCareOfflineLifecycleDatabase()
}

function getSelfCareOfflineLifecycleDatabase(): SelfCareOfflineDatabase | null {
  if (!hasSelfCareOfflineStorageApi()) {
    return null
  }

  database ??= new SelfCareOfflineDatabase()
  return database
}

async function probeSelfCareOfflineStorageOnce(): Promise<SelfCareOfflineStorageHealth> {
  const failureEpoch = storageFailureEpoch
  const db = getSelfCareOfflineLifecycleDatabase()

  if (!db) {
    setSelfCareOfflineStorageHealth('failed')
    return 'failed'
  }

  try {
    await flushPendingSelfCareOfflinePurges(db)

    if (storageHealth === 'failed' || storageFailureEpoch !== failureEpoch) {
      return 'failed'
    }

    const probeKey = '__self-care-storage-health__'
    await db.transaction('rw', db.cachedReads, async () => {
      await db.cachedReads.put({
        actorUserId: '__health__',
        cacheKey: '__health__',
        data: null,
        key: probeKey,
        lastSuccessfulSyncAt: new Date(0).toISOString(),
        scope: '__health__',
        valueVersion: SELF_CARE_CACHE_VALUE_VERSION,
        workspaceId: '__health__',
      })
      await db.cachedReads.delete(probeKey)
    })

    if (
      getSelfCareOfflineStorageHealth() !== 'failed' &&
      storageFailureEpoch === failureEpoch &&
      !hasPendingSelfCareOfflinePurges()
    ) {
      setSelfCareOfflineStorageHealth('ready')
    }
  } catch (error) {
    reportSelfCareOfflineStorageFailure(error)
    setSelfCareOfflineStorageHealth('failed')
  }

  return getSelfCareOfflineStorageHealth()
}

function hasSelfCareOfflineStorageApi(): boolean {
  return typeof indexedDB !== 'undefined'
}

function setSelfCareOfflineStorageHealth(
  next: SelfCareOfflineStorageHealth,
): void {
  if (storageHealth === 'failed' && next === 'ready') {
    return
  }

  if (storageHealth === next) {
    return
  }

  storageHealth = next
  notifyQueueListeners()
}

function isSelfCareOfflineStorageFailure(error: unknown): boolean {
  const name =
    error instanceof DOMException || error instanceof Error ? error.name : ''

  if (
    [
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
  ) {
    return true
  }

  return (
    typeof error === 'object' &&
    error !== null &&
    'inner' in error &&
    isSelfCareOfflineStorageFailure(error.inner)
  )
}

function beginSelfCareOfflineWorkspacePurge(
  workspaceId: string,
  generation: number,
): boolean {
  workspaceWriteGenerations.set(workspaceId, generation)
  localPendingPurgeWorkspaces.set(workspaceId, generation)
  const lifecycle =
    readStoredSelfCareOfflineWorkspaceLifecycleState(workspaceId)
  return writeStoredSelfCareOfflineWorkspaceLifecycleState(workspaceId, {
    pendingPurgeGeneration: Math.max(
      lifecycle.pendingPurgeGeneration ?? 0,
      generation,
    ),
    writeGeneration: Math.max(lifecycle.writeGeneration, generation),
  })
}

async function flushPendingSelfCareOfflinePurges(
  db: SelfCareOfflineDatabase,
): Promise<void> {
  for (;;) {
    const persisted = readStoredSelfCareOfflineLifecycleState().pendingPurges
    const pendingPurges = { ...persisted }

    for (const [workspaceId, generation] of localPendingPurgeWorkspaces) {
      pendingPurges[workspaceId] = Math.max(
        pendingPurges[workspaceId] ?? 0,
        generation,
      )
    }

    const workspaceIds = Object.keys(pendingPurges)

    if (!workspaceIds.length) {
      return
    }

    await purgeSelfCareOfflineWorkspaces(db, workspaceIds)

    if (!completeSelfCareOfflineWorkspacePurges(pendingPurges)) {
      throw new SelfCareOfflinePurgeUnavailableError()
    }
  }
}

async function purgeSelfCareOfflineWorkspaces(
  db: SelfCareOfflineDatabase,
  workspaceIds: readonly string[],
): Promise<void> {
  await db.transaction('rw', [db.cachedReads, db.mutationQueue], async () => {
    for (const workspaceId of workspaceIds) {
      await Promise.all([
        db.cachedReads.where('workspaceId').equals(workspaceId).delete(),
        db.mutationQueue.where('workspaceId').equals(workspaceId).delete(),
      ])
    }
  })
}

function completeSelfCareOfflineWorkspacePurges(
  completedPurges: Readonly<Record<string, number>>,
): boolean {
  let completed = true

  for (const [workspaceId, generation] of Object.entries(completedPurges)) {
    const localGeneration = localPendingPurgeWorkspaces.get(workspaceId)

    if (localGeneration !== undefined && localGeneration <= generation) {
      localPendingPurgeWorkspaces.delete(workspaceId)
    }

    const lifecycle =
      readStoredSelfCareOfflineWorkspaceLifecycleState(workspaceId)
    const persistedGeneration = lifecycle.pendingPurgeGeneration

    if (persistedGeneration !== null && persistedGeneration <= generation) {
      completed =
        writeStoredSelfCareOfflineWorkspaceLifecycleState(workspaceId, {
          pendingPurgeGeneration: null,
          writeGeneration: Math.max(lifecycle.writeGeneration, generation),
        }) && completed
    }
  }

  return completed
}

function hasPendingSelfCareOfflinePurges(): boolean {
  return (
    localPendingPurgeWorkspaces.size > 0 ||
    Object.keys(readStoredSelfCareOfflineLifecycleState().pendingPurges)
      .length > 0
  )
}

function readStoredSelfCareOfflineLifecycleState(): SelfCareOfflineLifecycleState {
  const lifecycle: SelfCareOfflineLifecycleState = {
    pendingPurges: {},
    writeGenerations: {},
  }

  for (const key of listStoredSelfCareOfflineLifecycleKeys()) {
    const workspaceId = parseSelfCareOfflineLifecycleStorageKey(key)

    if (!workspaceId) {
      continue
    }

    const workspaceLifecycle =
      readStoredSelfCareOfflineWorkspaceLifecycleState(workspaceId)
    lifecycle.writeGenerations[workspaceId] = workspaceLifecycle.writeGeneration

    if (workspaceLifecycle.pendingPurgeGeneration !== null) {
      lifecycle.pendingPurges[workspaceId] =
        workspaceLifecycle.pendingPurgeGeneration
    }
  }

  return lifecycle
}

function readStoredSelfCareOfflineWorkspaceLifecycleState(
  workspaceId: string,
): SelfCareOfflineWorkspaceLifecycleState {
  if (typeof window === 'undefined') {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }

  try {
    return parseSelfCareOfflineWorkspaceLifecycleState(
      window.localStorage.getItem(
        createSelfCareOfflineLifecycleStorageKey(workspaceId),
      ),
    )
  } catch {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }
}

function parseSelfCareOfflineWorkspaceLifecycleState(
  rawValue: string | null,
): SelfCareOfflineWorkspaceLifecycleState {
  if (!rawValue) {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { pendingPurgeGeneration: null, writeGeneration: 0 }
    }

    const value = parsed as Record<string, unknown>
    const writeGeneration = sanitizeSelfCareOfflineGeneration(
      value.writeGeneration,
    )
    const pendingPurgeGeneration =
      value.pendingPurgeGeneration === null
        ? null
        : sanitizeOptionalSelfCareOfflineGeneration(
            value.pendingPurgeGeneration,
          )

    return {
      pendingPurgeGeneration,
      writeGeneration,
    }
  } catch {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }
}

function sanitizeSelfCareOfflineGeneration(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0
}

function sanitizeOptionalSelfCareOfflineGeneration(
  value: unknown,
): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function writeStoredSelfCareOfflineWorkspaceLifecycleState(
  workspaceId: string,
  lifecycle: SelfCareOfflineWorkspaceLifecycleState,
): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const serialized = JSON.stringify(lifecycle)
    const storageKey = createSelfCareOfflineLifecycleStorageKey(workspaceId)
    window.localStorage.setItem(storageKey, serialized)
    return window.localStorage.getItem(storageKey) === serialized
  } catch {
    return false
  }
}

function removeStoredSelfCareOfflineLifecycleState(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    for (const key of listStoredSelfCareOfflineLifecycleKeys()) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Test cleanup remains best-effort when localStorage is unavailable.
  }
}

function ensureSelfCareOfflineLifecycleStorageListener(): void {
  if (lifecycleStorageListenerAttached || typeof window === 'undefined') {
    return
  }

  window.addEventListener('storage', handleSelfCareOfflineLifecycleStorage)
  lifecycleStorageListenerAttached = true
}

function handleSelfCareOfflineLifecycleStorage(event: StorageEvent): void {
  const workspaceId = parseSelfCareOfflineLifecycleStorageKey(event.key)

  if (!workspaceId) {
    return
  }

  const lifecycle = parseSelfCareOfflineWorkspaceLifecycleState(event.newValue)
  const generation = lifecycle.writeGeneration
  const runtimeGeneration = workspaceWriteGenerations.get(workspaceId) ?? 0

  if (generation > runtimeGeneration) {
    workspaceWriteGenerations.set(workspaceId, generation)
    clearObservedWorkspaceVersions(workspaceId)
  }

  notifyQueueListeners()
}

function createSelfCareOfflineLifecycleStorageKey(workspaceId: string): string {
  return `${SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
}

function parseSelfCareOfflineLifecycleStorageKey(
  storageKey: string | null,
): string | null {
  if (!storageKey?.startsWith(SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)) {
    return null
  }

  const encodedWorkspaceId = storageKey.slice(
    SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX.length,
  )

  if (!encodedWorkspaceId) {
    return null
  }

  try {
    return decodeURIComponent(encodedWorkspaceId)
  } catch {
    return null
  }
}

function listStoredSelfCareOfflineLifecycleKeys(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const keys: string[] = []

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)

      if (key?.startsWith(SELF_CARE_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)) {
        keys.push(key)
      }
    }

    return keys
  } catch {
    return []
  }
}

function toStorageKey(
  workspaceId: string,
  actorUserId: string,
  cacheKey: string,
): string {
  return `${workspaceId}:${actorUserId}:${cacheKey}`
}

async function pruneCachedScope(
  db: SelfCareOfflineDatabase,
  workspaceId: string,
  actorUserId: string,
  scope: string,
): Promise<void> {
  const limit = CACHE_ROW_LIMIT_BY_SCOPE[scope] ?? 3
  const rows = await db.cachedReads
    .where('[workspaceId+actorUserId+scope]')
    .equals([workspaceId, actorUserId, scope])
    .sortBy('lastSuccessfulSyncAt')
  const obsoleteKeys = rows
    .slice(0, Math.max(0, rows.length - limit))
    .map((row) => row.key)

  if (obsoleteKeys.length) {
    await db.cachedReads.bulkDelete(obsoleteKeys)
  }
}

async function listOwnerMutations(
  db: SelfCareOfflineDatabase,
  workspaceId: string,
  actorUserId: string,
): Promise<SelfCareOfflineMutationRecord[]> {
  return (
    await db.mutationQueue
      .where('[workspaceId+actorUserId]')
      .equals([workspaceId, actorUserId])
      .toArray()
  ).sort(compareMutations)
}

async function assertOperationIdAvailable(
  db: SelfCareOfflineDatabase,
  operationId: string,
  mutationId: string,
): Promise<void> {
  const existing = await db.mutationQueue
    .where('operationId')
    .equals(operationId)
    .first()

  if (existing && existing.id !== mutationId) {
    throw new SelfCareOfflineMutationCollisionError()
  }
}

async function updateMutation(
  mutationId: string,
  workspaceId: string,
  actorUserId: string,
  expectedWriteGeneration: number,
  update: (
    mutation: SelfCareOfflineMutationRecord,
  ) => SelfCareOfflineMutationRecord,
): Promise<void> {
  const db = getSelfCareOfflineDatabase()

  if (!db) {
    return
  }

  await runSerializedWrite(queueWriteKey(workspaceId), () =>
    db.transaction('rw', db.mutationQueue, async () => {
      if (
        !isSelfCareOfflineWorkspaceWriteGenerationCurrent(
          workspaceId,
          expectedWriteGeneration,
        )
      ) {
        return
      }

      const current = await db.mutationQueue.get(mutationId)

      if (
        !current ||
        current.workspaceId !== workspaceId ||
        current.actorUserId !== actorUserId
      ) {
        return
      }

      await db.mutationQueue.put(update(current))
    }),
  )
  notifyQueueListeners()
}

async function runSerializedWrite<T>(
  storageKey: string,
  write: () => Promise<T>,
): Promise<T> {
  const previous = pendingWrites.get(storageKey) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(write)
  pendingWrites.set(storageKey, current)

  try {
    return await current
  } catch (error) {
    reportSelfCareOfflineStorageFailure(error)
    throw error
  } finally {
    if (pendingWrites.get(storageKey) === current) {
      pendingWrites.delete(storageKey)
    }
  }
}

function observeCachedReadVersion(
  storageKey: string,
  version: SelfCareCachedReadVersion,
): void {
  const current = latestCachedReadVersions.get(storageKey)

  if (
    !current ||
    current.writeGeneration < version.writeGeneration ||
    (current.writeGeneration === version.writeGeneration &&
      current.lastSuccessfulSyncAt <= version.lastSuccessfulSyncAt)
  ) {
    latestCachedReadVersions.set(storageKey, version)
  }
}

function clearObservedWorkspaceVersions(workspaceId: string): void {
  const prefix = `${workspaceId}:`

  for (const key of latestCachedReadVersions.keys()) {
    if (key.startsWith(prefix)) {
      latestCachedReadVersions.delete(key)
    }
  }
}

async function waitForWorkspaceWrites(workspaceId: string): Promise<void> {
  const prefix = `${workspaceId}:`
  const writes = [...pendingWrites.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, write]) => write)

  await Promise.allSettled(writes)
}

function queueWriteKey(workspaceId: string): string {
  return `${workspaceId}:queue`
}

function compareMutations(
  left: SelfCareOfflineMutationRecord,
  right: SelfCareOfflineMutationRecord,
): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id)
}

function isOverlayActive(mutation: SelfCareOfflineMutationRecord): boolean {
  return mutation.status !== 'conflicted'
}

function resolveMutationOverlayResult(
  mutation: SelfCareOfflineMutationRecord,
): SelfCareOfflineCommandResult {
  const server = mutation.serverResult
  const optimistic = mutation.optimisticResult

  if (!server) {
    return optimistic
  }

  if (server.kind === 'completion' && optimistic.kind === 'completion') {
    return {
      ...server,
      ...(!Object.prototype.hasOwnProperty.call(server, 'courseDetails') &&
      Object.prototype.hasOwnProperty.call(optimistic, 'courseDetails')
        ? { courseDetails: optimistic.courseDetails }
        : {}),
      ...(!server.item && optimistic.item ? { item: optimistic.item } : {}),
      ...(!Object.prototype.hasOwnProperty.call(server, 'scheduleRule') &&
      Object.prototype.hasOwnProperty.call(optimistic, 'scheduleRule')
        ? { scheduleRule: optimistic.scheduleRule }
        : {}),
    }
  }

  return server
}

function collectDependentMutationIds(
  mutations: readonly SelfCareOfflineMutationRecord[],
  rootMutationId: string,
): Set<string> {
  const removed = new Set([rootMutationId])
  let changed = true

  while (changed) {
    changed = false

    for (const mutation of mutations) {
      if (
        !removed.has(mutation.id) &&
        mutation.dependsOn.some((dependency) => removed.has(dependency))
      ) {
        removed.add(mutation.id)
        changed = true
      }
    }
  }

  return removed
}

function areJsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => areJsonValuesEqual(value, right[index]))
    )
  }

  if (!isRecord(left) || !isRecord(right)) {
    return false
  }

  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && areJsonValuesEqual(left[key], right[key]),
    )
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function notifyQueueListeners(): void {
  for (const listener of queueListeners) {
    listener()
  }
}
