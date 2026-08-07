import {
  type ChaosInboxItemRecord,
  type ChaosInboxItemUpdateInput,
  type ChaosInboxPriority,
  type ChaosInboxShoppingCategory,
  generateUuidV7,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

export type ShoppingListOfflineMutationStatus =
  'conflicted' | 'failed' | 'pending' | 'syncing'

interface ShoppingListCachedItemRow {
  item: ChaosInboxItemRecord
  itemId: string
  key: string
  updatedAt: string
  workspaceId: string
}

interface ShoppingListOfflineMutationBase {
  actorUserId: string
  attemptCount: number
  createdAt: string
  id: string
  itemId: string
  lastError: string | null
  status: ShoppingListOfflineMutationStatus
  updatedAt: string
  workspaceId: string
}

export type ShoppingListOfflineMutationRecord =
  | (ShoppingListOfflineMutationBase & {
      isFavorite?: boolean
      priority?: ChaosInboxPriority | null
      shoppingCategory?: ChaosInboxShoppingCategory | null
      text: string
      type: 'shopping.create'
    })
  | (ShoppingListOfflineMutationBase & {
      patch: ChaosInboxItemUpdateInput
      type: 'shopping.update'
    })
  | (ShoppingListOfflineMutationBase & {
      type: 'shopping.delete'
    })

export type ShoppingListOfflineMutationInput =
  | {
      actorUserId: string
      isFavorite?: boolean
      itemId: string
      priority?: ChaosInboxPriority | null
      shoppingCategory?: ChaosInboxShoppingCategory | null
      text: string
      type: 'shopping.create'
      workspaceId: string
    }
  | {
      actorUserId: string
      itemId: string
      patch: ChaosInboxItemUpdateInput
      type: 'shopping.update'
      workspaceId: string
    }
  | {
      actorUserId: string
      itemId: string
      type: 'shopping.delete'
      workspaceId: string
    }

const RETRYABLE_QUEUE_STATUSES: ShoppingListOfflineMutationStatus[] = [
  'failed',
  'pending',
  'syncing',
]
export const SHOPPING_LIST_OFFLINE_DATABASE_NAME = 'shopping-list-offline'
export const SHOPPING_LIST_OFFLINE_SCHEMA_VERSION = 1
export const SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX =
  'planner.shoppingListOfflineLifecycle:'

interface ShoppingListOfflineLifecycleState {
  pendingPurges: Record<string, number>
  writeGenerations: Record<string, number>
}

interface ShoppingListOfflineWorkspaceLifecycleState {
  pendingPurgeGeneration: number | null
  writeGeneration: number
}

export class ShoppingListOfflinePurgeUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'Не удалось безопасно очистить локальные данные списка покупок. Повторите действие после перезапуска приложения.',
      options,
    )
    this.name = 'ShoppingListOfflinePurgeUnavailableError'
  }
}

class ShoppingListOfflineDatabase extends Dexie {
  cachedItems!: Table<ShoppingListCachedItemRow, string>
  mutationQueue!: Table<ShoppingListOfflineMutationRecord, string>

  constructor() {
    super(SHOPPING_LIST_OFFLINE_DATABASE_NAME)

    this.version(SHOPPING_LIST_OFFLINE_SCHEMA_VERSION).stores({
      cachedItems: 'key, workspaceId, itemId, updatedAt',
      mutationQueue: 'id, workspaceId, status, createdAt, updatedAt',
    })
  }
}

let database: ShoppingListOfflineDatabase | null = null
let lifecycleFlush: Promise<void> | null = null
let lifecycleStorageListenerAttached = false
const pendingWorkspaceWrites = new Map<string, Set<Promise<unknown>>>()
const workspaceWriteGenerations = new Map<string, number>()
const localPendingPurgeWorkspaces = new Map<string, number>()
const runtimeInvalidatedWorkspaces = new Map<string, number>()
let runtimeLifecycleBaseline = readStoredShoppingListOfflineLifecycleState()

export function isShoppingListOfflineStorageAvailable(): boolean {
  ensureShoppingListOfflineLifecycleStorageListener()
  return typeof indexedDB !== 'undefined'
}

export async function resetShoppingListOfflineDatabaseForTests(): Promise<void> {
  database?.close()
  database = null
  lifecycleFlush = null
  pendingWorkspaceWrites.clear()
  workspaceWriteGenerations.clear()
  localPendingPurgeWorkspaces.clear()
  runtimeInvalidatedWorkspaces.clear()

  if (isShoppingListOfflineStorageAvailable()) {
    await Dexie.delete(SHOPPING_LIST_OFFLINE_DATABASE_NAME)
  }

  removeStoredShoppingListOfflineLifecycleState()
  runtimeLifecycleBaseline = readStoredShoppingListOfflineLifecycleState()
}

export function resetShoppingListOfflineRuntimeForTests(): void {
  database?.close()
  database = null
  lifecycleFlush = null
  pendingWorkspaceWrites.clear()
  workspaceWriteGenerations.clear()
  localPendingPurgeWorkspaces.clear()
  runtimeInvalidatedWorkspaces.clear()
  runtimeLifecycleBaseline = readStoredShoppingListOfflineLifecycleState()
}

export async function clearShoppingListOfflineWorkspaceData(
  workspaceId: string,
): Promise<void> {
  const generation =
    getShoppingListOfflineWorkspaceWriteGeneration(workspaceId) + 1
  const markerPersisted = beginShoppingListOfflineWorkspacePurge(
    workspaceId,
    generation,
  )
  await waitForShoppingListWorkspaceWrites(workspaceId)
  const db = getShoppingListOfflineDatabaseForMaintenance()

  if (!db) {
    if (markerPersisted) {
      return
    }

    throw new ShoppingListOfflinePurgeUnavailableError()
  }

  try {
    await purgeShoppingListOfflineWorkspaces(db, [workspaceId])
  } catch (error) {
    if (markerPersisted) {
      return
    }

    throw new ShoppingListOfflinePurgeUnavailableError({ cause: error })
  }

  if (
    !markerPersisted ||
    !completeShoppingListOfflineWorkspacePurges({ [workspaceId]: generation })
  ) {
    throw new ShoppingListOfflinePurgeUnavailableError()
  }
}

export async function loadCachedShoppingListItems(
  workspaceId: string,
): Promise<ChaosInboxItemRecord[]> {
  const readGeneration =
    getShoppingListOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getShoppingListOfflineDatabaseForAccess(workspaceId)

  if (!db) {
    return []
  }

  const rows = await db.cachedItems
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  if (
    !isShoppingListOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      readGeneration,
    )
  ) {
    return []
  }

  return rows.map((row) => row.item)
}

export async function replaceCachedShoppingListItems(
  workspaceId: string,
  items: ChaosInboxItemRecord[],
): Promise<void> {
  const writeGeneration =
    getShoppingListOfflineWorkspaceWriteGeneration(workspaceId)

  const updatedAt = new Date().toISOString()
  const rows = items.map((item): ShoppingListCachedItemRow => ({
    item,
    itemId: item.id,
    key: createCachedShoppingListItemKey(workspaceId, item.id),
    updatedAt,
    workspaceId,
  }))

  await runShoppingListWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.transaction('rw', db.cachedItems, async () => {
      await db.cachedItems.where('workspaceId').equals(workspaceId).delete()

      if (rows.length > 0) {
        await db.cachedItems.bulkPut(rows)
      }
    }),
  )
}

export async function upsertCachedShoppingListItem(
  workspaceId: string,
  item: ChaosInboxItemRecord,
): Promise<void> {
  const writeGeneration =
    getShoppingListOfflineWorkspaceWriteGeneration(workspaceId)

  await runShoppingListWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.cachedItems.put({
      item,
      itemId: item.id,
      key: createCachedShoppingListItemKey(workspaceId, item.id),
      updatedAt: new Date().toISOString(),
      workspaceId,
    }),
  )
}

export async function removeCachedShoppingListItem(
  workspaceId: string,
  itemId: string,
): Promise<void> {
  const writeGeneration =
    getShoppingListOfflineWorkspaceWriteGeneration(workspaceId)

  await runShoppingListWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.cachedItems.delete(createCachedShoppingListItemKey(workspaceId, itemId)),
  )
}

export async function enqueueShoppingListOfflineMutation(
  input: ShoppingListOfflineMutationInput,
): Promise<ShoppingListOfflineMutationRecord | null> {
  const writeGeneration = getShoppingListOfflineWorkspaceWriteGeneration(
    input.workspaceId,
  )

  const now = new Date().toISOString()
  const mutation = {
    ...input,
    attemptCount: 0,
    createdAt: now,
    id: generateUuidV7(),
    lastError: null,
    status: 'pending',
    updatedAt: now,
  } satisfies ShoppingListOfflineMutationRecord

  const stored = await runShoppingListWorkspaceWrite(
    input.workspaceId,
    writeGeneration,
    (db) => db.mutationQueue.put(mutation).then(() => mutation),
  )

  return stored ?? null
}

export async function listRetryableShoppingListOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
): Promise<ShoppingListOfflineMutationRecord[]> {
  const readGeneration =
    getShoppingListOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getShoppingListOfflineDatabaseForAccess(workspaceId)

  if (!db) {
    return []
  }

  const rows = await db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter(
      (mutation) =>
        (!actorUserId || mutation.actorUserId === actorUserId) &&
        RETRYABLE_QUEUE_STATUSES.includes(mutation.status),
    )
    .toArray()

  if (
    !isShoppingListOfflineWorkspaceWriteGenerationCurrent(
      workspaceId,
      readGeneration,
    )
  ) {
    return []
  }

  return rows.sort(compareOfflineMutations)
}

export async function countRetryableShoppingListOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
): Promise<number> {
  const mutations = await listRetryableShoppingListOfflineMutations(
    workspaceId,
    actorUserId,
  )

  return mutations.length
}

export async function countConflictedShoppingListOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
): Promise<number> {
  const readGeneration =
    getShoppingListOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getShoppingListOfflineDatabaseForAccess(workspaceId)

  if (!db) {
    return 0
  }

  const count = await db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter(
      (mutation) =>
        (!actorUserId || mutation.actorUserId === actorUserId) &&
        mutation.status === 'conflicted',
    )
    .count()

  return isShoppingListOfflineWorkspaceWriteGenerationCurrent(
    workspaceId,
    readGeneration,
  )
    ? count
    : 0
}

export async function markShoppingListOfflineMutationSyncing(
  mutationId: string,
): Promise<void> {
  await runShoppingListMutationWrite(mutationId, (db, mutation) =>
    db.mutationQueue.update(mutationId, {
      attemptCount: mutation.attemptCount + 1,
      lastError: null,
      status: 'syncing',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function completeShoppingListOfflineMutation(
  mutationId: string,
): Promise<void> {
  await runShoppingListMutationWrite(mutationId, (db) =>
    db.mutationQueue.delete(mutationId),
  )
}

export async function markShoppingListOfflineMutationFailed(
  mutationId: string,
  errorMessage: string,
): Promise<void> {
  await runShoppingListMutationWrite(mutationId, (db) =>
    db.mutationQueue.update(mutationId, {
      lastError: errorMessage,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function markShoppingListOfflineMutationConflicted(
  mutationId: string,
  errorMessage: string,
): Promise<void> {
  await runShoppingListMutationWrite(mutationId, (db) =>
    db.mutationQueue.update(mutationId, {
      lastError: errorMessage,
      status: 'conflicted',
      updatedAt: new Date().toISOString(),
    }),
  )
}

function getShoppingListOfflineDatabaseForMaintenance(): ShoppingListOfflineDatabase | null {
  if (!isShoppingListOfflineStorageAvailable()) {
    return null
  }

  database ??= new ShoppingListOfflineDatabase()

  return database
}

async function getShoppingListOfflineDatabaseForAccess(
  workspaceId?: string,
): Promise<ShoppingListOfflineDatabase | null> {
  const db = getShoppingListOfflineDatabaseForMaintenance()

  if (!db) {
    return null
  }

  await flushPendingShoppingListOfflinePurges(db)

  if (workspaceId && runtimeInvalidatedWorkspaces.has(workspaceId)) {
    return null
  }

  return db
}

function getShoppingListOfflineWorkspaceWriteGeneration(
  workspaceId: string,
): number {
  ensureShoppingListOfflineLifecycleStorageListener()
  const runtimeGeneration = workspaceWriteGenerations.get(workspaceId) ?? 0
  const persistedGeneration =
    readStoredShoppingListOfflineWorkspaceLifecycleState(
      workspaceId,
    ).writeGeneration
  const generation = Math.max(runtimeGeneration, persistedGeneration)
  const baselineGeneration =
    runtimeLifecycleBaseline.writeGenerations[workspaceId] ?? 0

  if (generation !== runtimeGeneration) {
    workspaceWriteGenerations.set(workspaceId, generation)
  }

  if (persistedGeneration > baselineGeneration) {
    runtimeInvalidatedWorkspaces.set(workspaceId, persistedGeneration)
  }

  return generation
}

function isShoppingListOfflineWorkspaceWriteGenerationCurrent(
  workspaceId: string,
  expectedWriteGeneration: number,
): boolean {
  return (
    expectedWriteGeneration ===
      getShoppingListOfflineWorkspaceWriteGeneration(workspaceId) &&
    !runtimeInvalidatedWorkspaces.has(workspaceId)
  )
}

async function runShoppingListWorkspaceWrite<T>(
  workspaceId: string,
  expectedWriteGeneration: number,
  write: (db: ShoppingListOfflineDatabase) => Promise<T>,
): Promise<T | undefined> {
  const current = (async () => {
    const db = await getShoppingListOfflineDatabaseForAccess(workspaceId)

    if (!db) {
      return undefined
    }

    return db.transaction(
      'rw',
      [db.cachedItems, db.mutationQueue],
      async () => {
        if (
          !isShoppingListOfflineWorkspaceWriteGenerationCurrent(
            workspaceId,
            expectedWriteGeneration,
          )
        ) {
          return undefined
        }

        return write(db)
      },
    )
  })()
  const workspaceWrites =
    pendingWorkspaceWrites.get(workspaceId) ?? new Set<Promise<unknown>>()
  workspaceWrites.add(current)
  pendingWorkspaceWrites.set(workspaceId, workspaceWrites)

  try {
    return await current
  } finally {
    workspaceWrites.delete(current)

    if (workspaceWrites.size === 0) {
      pendingWorkspaceWrites.delete(workspaceId)
    }
  }
}

async function runShoppingListMutationWrite(
  mutationId: string,
  write: (
    db: ShoppingListOfflineDatabase,
    mutation: ShoppingListOfflineMutationRecord,
  ) => Promise<unknown>,
): Promise<void> {
  const db = await getShoppingListOfflineDatabaseForAccess()

  if (!db) {
    return
  }

  const mutation = await db.mutationQueue.get(mutationId)

  if (!mutation) {
    return
  }

  const writeGeneration = getShoppingListOfflineWorkspaceWriteGeneration(
    mutation.workspaceId,
  )

  await runShoppingListWorkspaceWrite(
    mutation.workspaceId,
    writeGeneration,
    async (currentDb) => {
      const currentMutation = await currentDb.mutationQueue.get(mutationId)

      if (!currentMutation) {
        return
      }

      await write(currentDb, currentMutation)
    },
  )
}

async function waitForShoppingListWorkspaceWrites(
  workspaceId: string,
): Promise<void> {
  const writes = [...(pendingWorkspaceWrites.get(workspaceId) ?? [])]
  await Promise.allSettled(writes)
}

function beginShoppingListOfflineWorkspacePurge(
  workspaceId: string,
  generation: number,
): boolean {
  workspaceWriteGenerations.set(workspaceId, generation)
  runtimeInvalidatedWorkspaces.set(workspaceId, generation)
  localPendingPurgeWorkspaces.set(workspaceId, generation)
  const lifecycle =
    readStoredShoppingListOfflineWorkspaceLifecycleState(workspaceId)
  return writeStoredShoppingListOfflineWorkspaceLifecycleState(workspaceId, {
    pendingPurgeGeneration: Math.max(
      lifecycle.pendingPurgeGeneration ?? 0,
      generation,
    ),
    writeGeneration: Math.max(lifecycle.writeGeneration, generation),
  })
}

async function flushPendingShoppingListOfflinePurges(
  db: ShoppingListOfflineDatabase,
): Promise<void> {
  lifecycleFlush ??= flushPendingShoppingListOfflinePurgesOnce(db).finally(
    () => {
      lifecycleFlush = null
    },
  )
  await lifecycleFlush
}

async function flushPendingShoppingListOfflinePurgesOnce(
  db: ShoppingListOfflineDatabase,
): Promise<void> {
  for (;;) {
    const pendingPurges = {
      ...readStoredShoppingListOfflineLifecycleState().pendingPurges,
    }

    for (const [workspaceId, generation] of localPendingPurgeWorkspaces) {
      pendingPurges[workspaceId] = Math.max(
        pendingPurges[workspaceId] ?? 0,
        generation,
      )
    }

    const workspaceIds = Object.keys(pendingPurges)

    if (workspaceIds.length === 0) {
      return
    }

    await purgeShoppingListOfflineWorkspaces(db, workspaceIds)

    if (!completeShoppingListOfflineWorkspacePurges(pendingPurges)) {
      throw new ShoppingListOfflinePurgeUnavailableError()
    }
  }
}

async function purgeShoppingListOfflineWorkspaces(
  db: ShoppingListOfflineDatabase,
  workspaceIds: readonly string[],
): Promise<void> {
  await db.transaction('rw', [db.cachedItems, db.mutationQueue], async () => {
    for (const workspaceId of workspaceIds) {
      await Promise.all([
        db.cachedItems.where('workspaceId').equals(workspaceId).delete(),
        db.mutationQueue.where('workspaceId').equals(workspaceId).delete(),
      ])
    }
  })
}

function completeShoppingListOfflineWorkspacePurges(
  completedPurges: Readonly<Record<string, number>>,
): boolean {
  let completed = true

  for (const [workspaceId, generation] of Object.entries(completedPurges)) {
    const localGeneration = localPendingPurgeWorkspaces.get(workspaceId)

    if (localGeneration !== undefined && localGeneration <= generation) {
      localPendingPurgeWorkspaces.delete(workspaceId)
    }

    const lifecycle =
      readStoredShoppingListOfflineWorkspaceLifecycleState(workspaceId)
    const persistedGeneration = lifecycle.pendingPurgeGeneration

    if (persistedGeneration !== null && persistedGeneration <= generation) {
      completed =
        writeStoredShoppingListOfflineWorkspaceLifecycleState(workspaceId, {
          pendingPurgeGeneration: null,
          writeGeneration: Math.max(lifecycle.writeGeneration, generation),
        }) && completed
    }
  }

  return completed
}

function readStoredShoppingListOfflineLifecycleState(): ShoppingListOfflineLifecycleState {
  const lifecycle: ShoppingListOfflineLifecycleState = {
    pendingPurges: {},
    writeGenerations: {},
  }

  for (const key of listStoredShoppingListOfflineLifecycleKeys()) {
    const workspaceId = parseShoppingListOfflineLifecycleStorageKey(key)

    if (!workspaceId) {
      continue
    }

    const workspaceLifecycle =
      readStoredShoppingListOfflineWorkspaceLifecycleState(workspaceId)
    lifecycle.writeGenerations[workspaceId] = workspaceLifecycle.writeGeneration

    if (workspaceLifecycle.pendingPurgeGeneration !== null) {
      lifecycle.pendingPurges[workspaceId] =
        workspaceLifecycle.pendingPurgeGeneration
    }
  }

  return lifecycle
}

function readStoredShoppingListOfflineWorkspaceLifecycleState(
  workspaceId: string,
): ShoppingListOfflineWorkspaceLifecycleState {
  if (typeof window === 'undefined') {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }

  try {
    return parseShoppingListOfflineWorkspaceLifecycleState(
      window.localStorage.getItem(
        createShoppingListOfflineLifecycleStorageKey(workspaceId),
      ),
    )
  } catch {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }
}

function parseShoppingListOfflineWorkspaceLifecycleState(
  rawValue: string | null,
): ShoppingListOfflineWorkspaceLifecycleState {
  if (!rawValue) {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { pendingPurgeGeneration: null, writeGeneration: 0 }
    }

    const value = parsed as Record<string, unknown>
    const writeGeneration = sanitizeShoppingListOfflineGeneration(
      value.writeGeneration,
    )
    const pendingPurgeGeneration =
      value.pendingPurgeGeneration === null
        ? null
        : sanitizeOptionalShoppingListOfflineGeneration(
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

function sanitizeShoppingListOfflineGeneration(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0
}

function sanitizeOptionalShoppingListOfflineGeneration(
  value: unknown,
): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function writeStoredShoppingListOfflineWorkspaceLifecycleState(
  workspaceId: string,
  lifecycle: ShoppingListOfflineWorkspaceLifecycleState,
): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const serialized = JSON.stringify(lifecycle)
    const storageKey = createShoppingListOfflineLifecycleStorageKey(workspaceId)
    window.localStorage.setItem(storageKey, serialized)
    return window.localStorage.getItem(storageKey) === serialized
  } catch {
    return false
  }
}

function removeStoredShoppingListOfflineLifecycleState(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    for (const key of listStoredShoppingListOfflineLifecycleKeys()) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Test cleanup remains best-effort when localStorage is unavailable.
  }
}

function ensureShoppingListOfflineLifecycleStorageListener(): void {
  if (lifecycleStorageListenerAttached || typeof window === 'undefined') {
    return
  }

  window.addEventListener('storage', handleShoppingListOfflineLifecycleStorage)
  lifecycleStorageListenerAttached = true
}

function handleShoppingListOfflineLifecycleStorage(event: StorageEvent): void {
  const workspaceId = parseShoppingListOfflineLifecycleStorageKey(event.key)

  if (!workspaceId) {
    return
  }

  const lifecycle = parseShoppingListOfflineWorkspaceLifecycleState(
    event.newValue,
  )
  const generation = lifecycle.writeGeneration
  const runtimeGeneration = workspaceWriteGenerations.get(workspaceId) ?? 0
  const baselineGeneration =
    runtimeLifecycleBaseline.writeGenerations[workspaceId] ?? 0

  if (generation > runtimeGeneration) {
    workspaceWriteGenerations.set(workspaceId, generation)
  }

  if (generation > baselineGeneration) {
    runtimeInvalidatedWorkspaces.set(workspaceId, generation)
  }
}

function createShoppingListOfflineLifecycleStorageKey(
  workspaceId: string,
): string {
  return `${SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
}

function parseShoppingListOfflineLifecycleStorageKey(
  storageKey: string | null,
): string | null {
  if (
    !storageKey?.startsWith(SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)
  ) {
    return null
  }

  const encodedWorkspaceId = storageKey.slice(
    SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX.length,
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

function listStoredShoppingListOfflineLifecycleKeys(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const keys: string[] = []

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)

      if (key?.startsWith(SHOPPING_LIST_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)) {
        keys.push(key)
      }
    }

    return keys
  } catch {
    return []
  }
}

function createCachedShoppingListItemKey(
  workspaceId: string,
  itemId: string,
): string {
  return `${workspaceId}:${itemId}`
}

function compareOfflineMutations(
  left: ShoppingListOfflineMutationRecord,
  right: ShoppingListOfflineMutationRecord,
): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? -1 : 1
  }

  if (left.id === right.id) {
    return 0
  }

  return left.id < right.id ? -1 : 1
}
