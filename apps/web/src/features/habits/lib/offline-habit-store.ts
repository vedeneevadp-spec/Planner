import {
  generateUuidV7,
  type HabitEntryDeleteInput,
  type HabitEntryRecord,
  type HabitEntryUpsertInput,
  type HabitRecord,
  type HabitStatsResponse,
  type HabitTodayResponse,
  type HabitUpdateInput,
  type NewHabitInput,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

import {
  removeEntryInTodayResponse,
  removeHabitFromTodayResponse,
  upsertEntryInTodayResponse,
  upsertHabitInTodayResponse,
} from './habit-projection-model'

export type HabitOfflineMutationStatus =
  'conflicted' | 'failed' | 'pending' | 'syncing'

interface HabitCachedHabitRow {
  habit: HabitRecord
  habitId: string
  key: string
  updatedAt: string
  workspaceId: string
}

interface HabitCachedTodayRow {
  date: string
  key: string
  response: HabitTodayResponse
  updatedAt: string
  workspaceId: string
}

interface HabitCachedStatsRow {
  from: string
  key: string
  rangeKey: string
  response: HabitStatsResponse
  to: string
  updatedAt: string
  workspaceId: string
}

interface HabitOfflineMutationBase {
  actorUserId: string
  attemptCount: number
  clientMutationId: string
  conflictActualVersion: number | null
  conflictExpectedVersion: number | null
  createdAt: string
  habitId: string
  id: string
  lastError: string | null
  status: HabitOfflineMutationStatus
  updatedAt: string
  workspaceId: string
}

export type HabitOfflineMutationRecord =
  | (HabitOfflineMutationBase & {
      input: NewHabitInput
      type: 'habit.create'
    })
  | (HabitOfflineMutationBase & {
      input: HabitUpdateInput
      type: 'habit.update'
    })
  | (HabitOfflineMutationBase & {
      type: 'habit.delete'
    })
  | (HabitOfflineMutationBase & {
      date: string
      input: HabitEntryUpsertInput
      type: 'habit.entry.upsert'
    })
  | (HabitOfflineMutationBase & {
      date: string
      input: HabitEntryDeleteInput
      type: 'habit.entry.delete'
    })

export type HabitOfflineMutationInput =
  | {
      actorUserId: string
      habitId: string
      input: NewHabitInput
      type: 'habit.create'
      workspaceId: string
    }
  | {
      actorUserId: string
      habitId: string
      input: HabitUpdateInput
      type: 'habit.update'
      workspaceId: string
    }
  | {
      actorUserId: string
      habitId: string
      type: 'habit.delete'
      workspaceId: string
    }
  | {
      actorUserId: string
      date: string
      habitId: string
      input: HabitEntryUpsertInput
      type: 'habit.entry.upsert'
      workspaceId: string
    }
  | {
      actorUserId: string
      date: string
      habitId: string
      input?: HabitEntryDeleteInput | undefined
      type: 'habit.entry.delete'
      workspaceId: string
    }

const RETRYABLE_QUEUE_STATUSES: HabitOfflineMutationStatus[] = [
  'failed',
  'pending',
  'syncing',
]
export const HABIT_OFFLINE_DATABASE_NAME = 'habit-offline'
export const HABIT_OFFLINE_SCHEMA_VERSION = 1
export const HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX =
  'planner.habitOfflineLifecycle:'

interface HabitOfflineLifecycleState {
  pendingPurges: Record<string, number>
  writeGenerations: Record<string, number>
}

interface HabitOfflineWorkspaceLifecycleState {
  pendingPurgeGeneration: number | null
  writeGeneration: number
}

export class HabitOfflinePurgeUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'Не удалось безопасно очистить локальные данные привычек. Повторите действие после перезапуска приложения.',
      options,
    )
    this.name = 'HabitOfflinePurgeUnavailableError'
  }
}

class HabitOfflineDatabase extends Dexie {
  cachedHabits!: Table<HabitCachedHabitRow, string>
  cachedStatsResponses!: Table<HabitCachedStatsRow, string>
  cachedTodayResponses!: Table<HabitCachedTodayRow, string>
  mutationQueue!: Table<HabitOfflineMutationRecord, string>

  constructor() {
    super(HABIT_OFFLINE_DATABASE_NAME)

    this.version(HABIT_OFFLINE_SCHEMA_VERSION).stores({
      cachedHabits: 'key, workspaceId, habitId, updatedAt',
      cachedStatsResponses: 'key, workspaceId, rangeKey, updatedAt',
      cachedTodayResponses: 'key, workspaceId, date, updatedAt',
      mutationQueue:
        'id, workspaceId, status, createdAt, updatedAt, clientMutationId',
    })
  }
}

let database: HabitOfflineDatabase | null = null
let lifecycleFlush: Promise<void> | null = null
let lifecycleStorageListenerAttached = false
const pendingWorkspaceWrites = new Map<string, Set<Promise<unknown>>>()
const workspaceWriteGenerations = new Map<string, number>()
const localPendingPurgeWorkspaces = new Map<string, number>()
const runtimeInvalidatedWorkspaces = new Map<string, number>()
let runtimeLifecycleBaseline = readStoredHabitOfflineLifecycleState()

export function isHabitOfflineStorageAvailable(): boolean {
  ensureHabitOfflineLifecycleStorageListener()
  return typeof indexedDB !== 'undefined'
}

export async function resetHabitOfflineDatabaseForTests(): Promise<void> {
  database?.close()
  database = null
  lifecycleFlush = null
  pendingWorkspaceWrites.clear()
  workspaceWriteGenerations.clear()
  localPendingPurgeWorkspaces.clear()
  runtimeInvalidatedWorkspaces.clear()

  if (isHabitOfflineStorageAvailable()) {
    await Dexie.delete(HABIT_OFFLINE_DATABASE_NAME)
  }

  removeStoredHabitOfflineLifecycleState()
  runtimeLifecycleBaseline = readStoredHabitOfflineLifecycleState()
}

export function resetHabitOfflineRuntimeForTests(): void {
  database?.close()
  database = null
  lifecycleFlush = null
  pendingWorkspaceWrites.clear()
  workspaceWriteGenerations.clear()
  localPendingPurgeWorkspaces.clear()
  runtimeInvalidatedWorkspaces.clear()
  runtimeLifecycleBaseline = readStoredHabitOfflineLifecycleState()
}

export async function clearHabitOfflineWorkspaceData(
  workspaceId: string,
): Promise<void> {
  const generation = getHabitOfflineWorkspaceWriteGeneration(workspaceId) + 1
  const markerPersisted = beginHabitOfflineWorkspacePurge(
    workspaceId,
    generation,
  )
  await waitForHabitWorkspaceWrites(workspaceId)
  const db = getHabitOfflineDatabaseForMaintenance()

  if (!db) {
    if (markerPersisted) {
      return
    }

    throw new HabitOfflinePurgeUnavailableError()
  }

  try {
    await purgeHabitOfflineWorkspaces(db, [workspaceId])
  } catch (error) {
    if (markerPersisted) {
      return
    }

    throw new HabitOfflinePurgeUnavailableError({ cause: error })
  }

  if (
    !markerPersisted ||
    !completeHabitOfflineWorkspacePurges({ [workspaceId]: generation })
  ) {
    throw new HabitOfflinePurgeUnavailableError()
  }
}

export async function loadCachedHabitRecords(
  workspaceId: string,
): Promise<HabitRecord[]> {
  const readGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getHabitOfflineDatabaseForAccess(workspaceId)

  if (!db) {
    return []
  }

  const rows = await db.cachedHabits
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  if (
    !isHabitOfflineWorkspaceWriteGenerationCurrent(workspaceId, readGeneration)
  ) {
    return []
  }

  return rows.map((row) => row.habit)
}

export async function replaceCachedHabitRecords(
  workspaceId: string,
  habits: HabitRecord[],
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  const updatedAt = new Date().toISOString()
  const rows = habits.map((habit): HabitCachedHabitRow => ({
    habit,
    habitId: habit.id,
    key: createCachedHabitKey(workspaceId, habit.id),
    updatedAt,
    workspaceId,
  }))

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.transaction('rw', db.cachedHabits, async () => {
      await db.cachedHabits.where('workspaceId').equals(workspaceId).delete()

      if (rows.length > 0) {
        await db.cachedHabits.bulkPut(rows)
      }
    }),
  )
}

export async function upsertCachedHabitRecord(
  workspaceId: string,
  habit: HabitRecord,
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.cachedHabits.put({
      habit,
      habitId: habit.id,
      key: createCachedHabitKey(workspaceId, habit.id),
      updatedAt: new Date().toISOString(),
      workspaceId,
    }),
  )
}

export async function removeCachedHabitRecord(
  workspaceId: string,
  habitId: string,
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.cachedHabits.delete(createCachedHabitKey(workspaceId, habitId)),
  )
}

export async function loadCachedHabitTodayResponse(
  workspaceId: string,
  date: string,
): Promise<HabitTodayResponse | null> {
  const readGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getHabitOfflineDatabaseForAccess(workspaceId)

  if (!db) {
    return null
  }

  const row = await db.cachedTodayResponses.get(
    createCachedTodayKey(workspaceId, date),
  )

  return isHabitOfflineWorkspaceWriteGenerationCurrent(
    workspaceId,
    readGeneration,
  )
    ? (row?.response ?? null)
    : null
}

export async function replaceCachedHabitTodayResponse(
  workspaceId: string,
  date: string,
  response: HabitTodayResponse,
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.cachedTodayResponses.put({
      date,
      key: createCachedTodayKey(workspaceId, date),
      response,
      updatedAt: new Date().toISOString(),
      workspaceId,
    }),
  )
}

export async function upsertCachedHabitInTodayResponses(
  workspaceId: string,
  habit: HabitRecord,
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.transaction('rw', db.cachedTodayResponses, async () => {
      const rows = await db.cachedTodayResponses
        .where('workspaceId')
        .equals(workspaceId)
        .toArray()
      const updatedAt = new Date().toISOString()

      for (const row of rows) {
        await db.cachedTodayResponses.put({
          ...row,
          response: upsertHabitInTodayResponse(row.response, habit),
          updatedAt,
        })
      }
    }),
  )
}

export async function removeCachedHabitFromTodayResponses(
  workspaceId: string,
  habitId: string,
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.transaction('rw', db.cachedTodayResponses, async () => {
      const rows = await db.cachedTodayResponses
        .where('workspaceId')
        .equals(workspaceId)
        .toArray()
      const updatedAt = new Date().toISOString()

      for (const row of rows) {
        await db.cachedTodayResponses.put({
          ...row,
          response: removeHabitFromTodayResponse(row.response, habitId),
          updatedAt,
        })
      }
    }),
  )
}

export async function upsertCachedHabitTodayEntry(
  workspaceId: string,
  habitId: string,
  date: string,
  entry: HabitEntryRecord,
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.transaction('rw', db.cachedTodayResponses, async () => {
      const key = createCachedTodayKey(workspaceId, date)
      const row = await db.cachedTodayResponses.get(key)

      if (!row) {
        return
      }

      await db.cachedTodayResponses.put({
        ...row,
        response: upsertEntryInTodayResponse(row.response, habitId, entry),
        updatedAt: new Date().toISOString(),
      })
    }),
  )
}

export async function removeCachedHabitTodayEntry(
  workspaceId: string,
  habitId: string,
  date: string,
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.transaction('rw', db.cachedTodayResponses, async () => {
      const key = createCachedTodayKey(workspaceId, date)
      const row = await db.cachedTodayResponses.get(key)

      if (!row) {
        return
      }

      await db.cachedTodayResponses.put({
        ...row,
        response: removeEntryInTodayResponse(row.response, habitId),
        updatedAt: new Date().toISOString(),
      })
    }),
  )
}

export async function loadCachedHabitStatsResponse(
  workspaceId: string,
  from: string,
  to: string,
): Promise<HabitStatsResponse | null> {
  const readGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getHabitOfflineDatabaseForAccess(workspaceId)

  if (!db) {
    return null
  }

  const row = await db.cachedStatsResponses.get(
    createCachedStatsKey(workspaceId, from, to),
  )

  return isHabitOfflineWorkspaceWriteGenerationCurrent(
    workspaceId,
    readGeneration,
  )
    ? (row?.response ?? null)
    : null
}

export async function replaceCachedHabitStatsResponse(
  workspaceId: string,
  from: string,
  to: string,
  response: HabitStatsResponse,
): Promise<void> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)

  await runHabitWorkspaceWrite(workspaceId, writeGeneration, (db) =>
    db.cachedStatsResponses.put({
      from,
      key: createCachedStatsKey(workspaceId, from, to),
      rangeKey: createStatsRangeKey(from, to),
      response,
      to,
      updatedAt: new Date().toISOString(),
      workspaceId,
    }),
  )
}

export async function enqueueHabitOfflineMutation(
  input: HabitOfflineMutationInput,
): Promise<HabitOfflineMutationRecord | null> {
  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(
    input.workspaceId,
  )

  const now = new Date().toISOString()

  const stored = await runHabitWorkspaceWrite(
    input.workspaceId,
    writeGeneration,
    (db) =>
      db.transaction('rw', db.mutationQueue, async () => {
        const existingMutations = await db.mutationQueue
          .where('workspaceId')
          .equals(input.workspaceId)
          .filter(
            (mutation) =>
              mutation.actorUserId === input.actorUserId &&
              RETRYABLE_QUEUE_STATUSES.includes(mutation.status),
          )
          .toArray()
        const foldedMutation = await foldHabitOfflineMutation(
          db,
          input,
          existingMutations.sort(compareOfflineMutations),
          now,
        )

        if (foldedMutation) {
          await db.mutationQueue.put(foldedMutation)
        }

        return foldedMutation
      }),
  )

  return stored ?? null
}

export async function listRetryableHabitOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
): Promise<HabitOfflineMutationRecord[]> {
  const readGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getHabitOfflineDatabaseForAccess(workspaceId)

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
    !isHabitOfflineWorkspaceWriteGenerationCurrent(workspaceId, readGeneration)
  ) {
    return []
  }

  return rows.sort(compareOfflineMutations)
}

export async function countRetryableHabitOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
): Promise<number> {
  const mutations = await listRetryableHabitOfflineMutations(
    workspaceId,
    actorUserId,
  )

  return mutations.length
}

export async function countConflictedHabitOfflineMutations(
  workspaceId: string,
  actorUserId?: string,
): Promise<number> {
  const readGeneration = getHabitOfflineWorkspaceWriteGeneration(workspaceId)
  const db = await getHabitOfflineDatabaseForAccess(workspaceId)

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

  return isHabitOfflineWorkspaceWriteGenerationCurrent(
    workspaceId,
    readGeneration,
  )
    ? count
    : 0
}

export async function markHabitOfflineMutationSyncing(
  mutationId: string,
): Promise<void> {
  await runHabitMutationWrite(mutationId, (db, mutation) =>
    db.mutationQueue.update(mutationId, {
      attemptCount: mutation.attemptCount + 1,
      conflictActualVersion: null,
      conflictExpectedVersion: null,
      lastError: null,
      status: 'syncing',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function completeHabitOfflineMutation(
  mutationId: string,
): Promise<void> {
  await runHabitMutationWrite(mutationId, (db) =>
    db.mutationQueue.delete(mutationId),
  )
}

export async function markHabitOfflineMutationFailed(
  mutationId: string,
  errorMessage: string,
): Promise<void> {
  await runHabitMutationWrite(mutationId, (db) =>
    db.mutationQueue.update(mutationId, {
      lastError: errorMessage,
      status: 'failed',
      updatedAt: new Date().toISOString(),
    }),
  )
}

export async function markHabitOfflineMutationConflicted(
  mutationId: string,
  conflict: {
    actualVersion: number | null
    expectedVersion: number | null
    message: string
  },
): Promise<void> {
  await runHabitMutationWrite(mutationId, (db) =>
    db.mutationQueue.update(mutationId, {
      conflictActualVersion: conflict.actualVersion,
      conflictExpectedVersion: conflict.expectedVersion,
      lastError: conflict.message,
      status: 'conflicted',
      updatedAt: new Date().toISOString(),
    }),
  )
}

function getHabitOfflineDatabaseForMaintenance(): HabitOfflineDatabase | null {
  if (!isHabitOfflineStorageAvailable()) {
    return null
  }

  database ??= new HabitOfflineDatabase()

  return database
}

async function getHabitOfflineDatabaseForAccess(
  workspaceId?: string,
): Promise<HabitOfflineDatabase | null> {
  const db = getHabitOfflineDatabaseForMaintenance()

  if (!db) {
    return null
  }

  await flushPendingHabitOfflinePurges(db)

  if (workspaceId && runtimeInvalidatedWorkspaces.has(workspaceId)) {
    return null
  }

  return db
}

function getHabitOfflineWorkspaceWriteGeneration(workspaceId: string): number {
  ensureHabitOfflineLifecycleStorageListener()
  const runtimeGeneration = workspaceWriteGenerations.get(workspaceId) ?? 0
  const persistedGeneration =
    readStoredHabitOfflineWorkspaceLifecycleState(workspaceId).writeGeneration
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

function isHabitOfflineWorkspaceWriteGenerationCurrent(
  workspaceId: string,
  expectedWriteGeneration: number,
): boolean {
  return (
    expectedWriteGeneration ===
      getHabitOfflineWorkspaceWriteGeneration(workspaceId) &&
    !runtimeInvalidatedWorkspaces.has(workspaceId)
  )
}

async function runHabitWorkspaceWrite<T>(
  workspaceId: string,
  expectedWriteGeneration: number,
  write: (db: HabitOfflineDatabase) => Promise<T>,
): Promise<T | undefined> {
  const current = (async () => {
    const db = await getHabitOfflineDatabaseForAccess(workspaceId)

    if (!db) {
      return undefined
    }

    return db.transaction(
      'rw',
      [
        db.cachedHabits,
        db.cachedStatsResponses,
        db.cachedTodayResponses,
        db.mutationQueue,
      ],
      async () => {
        if (
          !isHabitOfflineWorkspaceWriteGenerationCurrent(
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

async function runHabitMutationWrite(
  mutationId: string,
  write: (
    db: HabitOfflineDatabase,
    mutation: HabitOfflineMutationRecord,
  ) => Promise<unknown>,
): Promise<void> {
  const db = await getHabitOfflineDatabaseForAccess()

  if (!db) {
    return
  }

  const mutation = await db.mutationQueue.get(mutationId)

  if (!mutation) {
    return
  }

  const writeGeneration = getHabitOfflineWorkspaceWriteGeneration(
    mutation.workspaceId,
  )

  await runHabitWorkspaceWrite(
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

async function waitForHabitWorkspaceWrites(workspaceId: string): Promise<void> {
  const writes = [...(pendingWorkspaceWrites.get(workspaceId) ?? [])]
  await Promise.allSettled(writes)
}

function beginHabitOfflineWorkspacePurge(
  workspaceId: string,
  generation: number,
): boolean {
  workspaceWriteGenerations.set(workspaceId, generation)
  runtimeInvalidatedWorkspaces.set(workspaceId, generation)
  localPendingPurgeWorkspaces.set(workspaceId, generation)
  const lifecycle = readStoredHabitOfflineWorkspaceLifecycleState(workspaceId)
  return writeStoredHabitOfflineWorkspaceLifecycleState(workspaceId, {
    pendingPurgeGeneration: Math.max(
      lifecycle.pendingPurgeGeneration ?? 0,
      generation,
    ),
    writeGeneration: Math.max(lifecycle.writeGeneration, generation),
  })
}

async function flushPendingHabitOfflinePurges(
  db: HabitOfflineDatabase,
): Promise<void> {
  lifecycleFlush ??= flushPendingHabitOfflinePurgesOnce(db).finally(() => {
    lifecycleFlush = null
  })
  await lifecycleFlush
}

async function flushPendingHabitOfflinePurgesOnce(
  db: HabitOfflineDatabase,
): Promise<void> {
  for (;;) {
    const pendingPurges = {
      ...readStoredHabitOfflineLifecycleState().pendingPurges,
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

    await purgeHabitOfflineWorkspaces(db, workspaceIds)

    if (!completeHabitOfflineWorkspacePurges(pendingPurges)) {
      throw new HabitOfflinePurgeUnavailableError()
    }
  }
}

async function purgeHabitOfflineWorkspaces(
  db: HabitOfflineDatabase,
  workspaceIds: readonly string[],
): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.cachedHabits,
      db.cachedStatsResponses,
      db.cachedTodayResponses,
      db.mutationQueue,
    ],
    async () => {
      for (const workspaceId of workspaceIds) {
        await Promise.all([
          db.cachedHabits.where('workspaceId').equals(workspaceId).delete(),
          db.cachedStatsResponses
            .where('workspaceId')
            .equals(workspaceId)
            .delete(),
          db.cachedTodayResponses
            .where('workspaceId')
            .equals(workspaceId)
            .delete(),
          db.mutationQueue.where('workspaceId').equals(workspaceId).delete(),
        ])
      }
    },
  )
}

function completeHabitOfflineWorkspacePurges(
  completedPurges: Readonly<Record<string, number>>,
): boolean {
  let completed = true

  for (const [workspaceId, generation] of Object.entries(completedPurges)) {
    const localGeneration = localPendingPurgeWorkspaces.get(workspaceId)

    if (localGeneration !== undefined && localGeneration <= generation) {
      localPendingPurgeWorkspaces.delete(workspaceId)
    }

    const lifecycle = readStoredHabitOfflineWorkspaceLifecycleState(workspaceId)
    const persistedGeneration = lifecycle.pendingPurgeGeneration

    if (persistedGeneration !== null && persistedGeneration <= generation) {
      completed =
        writeStoredHabitOfflineWorkspaceLifecycleState(workspaceId, {
          pendingPurgeGeneration: null,
          writeGeneration: Math.max(lifecycle.writeGeneration, generation),
        }) && completed
    }
  }

  return completed
}

function readStoredHabitOfflineLifecycleState(): HabitOfflineLifecycleState {
  const lifecycle: HabitOfflineLifecycleState = {
    pendingPurges: {},
    writeGenerations: {},
  }

  for (const key of listStoredHabitOfflineLifecycleKeys()) {
    const workspaceId = parseHabitOfflineLifecycleStorageKey(key)

    if (!workspaceId) {
      continue
    }

    const workspaceLifecycle =
      readStoredHabitOfflineWorkspaceLifecycleState(workspaceId)
    lifecycle.writeGenerations[workspaceId] = workspaceLifecycle.writeGeneration

    if (workspaceLifecycle.pendingPurgeGeneration !== null) {
      lifecycle.pendingPurges[workspaceId] =
        workspaceLifecycle.pendingPurgeGeneration
    }
  }

  return lifecycle
}

function readStoredHabitOfflineWorkspaceLifecycleState(
  workspaceId: string,
): HabitOfflineWorkspaceLifecycleState {
  if (typeof window === 'undefined') {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }

  try {
    return parseHabitOfflineWorkspaceLifecycleState(
      window.localStorage.getItem(
        createHabitOfflineLifecycleStorageKey(workspaceId),
      ),
    )
  } catch {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }
}

function parseHabitOfflineWorkspaceLifecycleState(
  rawValue: string | null,
): HabitOfflineWorkspaceLifecycleState {
  if (!rawValue) {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }

  try {
    const parsed = JSON.parse(rawValue) as unknown

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { pendingPurgeGeneration: null, writeGeneration: 0 }
    }

    const value = parsed as Record<string, unknown>
    const writeGeneration = sanitizeHabitOfflineGeneration(
      value.writeGeneration,
    )
    const pendingPurgeGeneration =
      value.pendingPurgeGeneration === null
        ? null
        : sanitizeOptionalHabitOfflineGeneration(value.pendingPurgeGeneration)

    return {
      pendingPurgeGeneration,
      writeGeneration,
    }
  } catch {
    return { pendingPurgeGeneration: null, writeGeneration: 0 }
  }
}

function sanitizeHabitOfflineGeneration(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0
}

function sanitizeOptionalHabitOfflineGeneration(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function writeStoredHabitOfflineWorkspaceLifecycleState(
  workspaceId: string,
  lifecycle: HabitOfflineWorkspaceLifecycleState,
): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const serialized = JSON.stringify(lifecycle)
    const storageKey = createHabitOfflineLifecycleStorageKey(workspaceId)
    window.localStorage.setItem(storageKey, serialized)
    return window.localStorage.getItem(storageKey) === serialized
  } catch {
    return false
  }
}

function removeStoredHabitOfflineLifecycleState(): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    for (const key of listStoredHabitOfflineLifecycleKeys()) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Test cleanup remains best-effort when localStorage is unavailable.
  }
}

function ensureHabitOfflineLifecycleStorageListener(): void {
  if (lifecycleStorageListenerAttached || typeof window === 'undefined') {
    return
  }

  window.addEventListener('storage', handleHabitOfflineLifecycleStorage)
  lifecycleStorageListenerAttached = true
}

function handleHabitOfflineLifecycleStorage(event: StorageEvent): void {
  const workspaceId = parseHabitOfflineLifecycleStorageKey(event.key)

  if (!workspaceId) {
    return
  }

  const lifecycle = parseHabitOfflineWorkspaceLifecycleState(event.newValue)
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

function createHabitOfflineLifecycleStorageKey(workspaceId: string): string {
  return `${HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX}${encodeURIComponent(workspaceId)}`
}

function parseHabitOfflineLifecycleStorageKey(
  storageKey: string | null,
): string | null {
  if (!storageKey?.startsWith(HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)) {
    return null
  }

  const encodedWorkspaceId = storageKey.slice(
    HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX.length,
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

function listStoredHabitOfflineLifecycleKeys(): string[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const keys: string[] = []

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)

      if (key?.startsWith(HABIT_OFFLINE_LIFECYCLE_STORAGE_KEY_PREFIX)) {
        keys.push(key)
      }
    }

    return keys
  } catch {
    return []
  }
}

async function foldHabitOfflineMutation(
  db: HabitOfflineDatabase,
  input: HabitOfflineMutationInput,
  mutations: HabitOfflineMutationRecord[],
  now: string,
): Promise<HabitOfflineMutationRecord | null> {
  if (input.type === 'habit.update') {
    return foldHabitUpdateMutation(db, input, mutations, now)
  }

  if (input.type === 'habit.delete') {
    return foldHabitDeleteMutation(db, input, mutations, now)
  }

  if (input.type === 'habit.entry.upsert') {
    return foldHabitEntryUpsertMutation(db, input, mutations, now)
  }

  if (input.type === 'habit.entry.delete') {
    return foldHabitEntryDeleteMutation(db, input, mutations, now)
  }

  return createHabitOfflineMutation(input, now)
}

async function foldHabitUpdateMutation(
  db: HabitOfflineDatabase,
  input: Extract<HabitOfflineMutationInput, { type: 'habit.update' }>,
  mutations: HabitOfflineMutationRecord[],
  now: string,
): Promise<HabitOfflineMutationRecord | null> {
  const pendingCreate = findMutation(mutations, input.habitId, 'habit.create')

  if (pendingCreate) {
    const unsupportedUpdate = getUnsupportedCreateUpdateInput(input.input)

    await db.mutationQueue.update(pendingCreate.id, (mutation) => {
      if (mutation.type !== 'habit.create') {
        return
      }

      mutation.input = mergeHabitCreateInput(mutation.input, input.input)
      mutation.status = 'pending'
      mutation.updatedAt = now
    })

    if (!hasDefinedValues(unsupportedUpdate)) {
      return null
    }

    return createHabitOfflineMutation(
      {
        ...input,
        input: unsupportedUpdate,
      },
      now,
    )
  }

  const pendingDelete = findMutation(mutations, input.habitId, 'habit.delete')

  if (pendingDelete) {
    return null
  }

  const pendingUpdate = findLastMutation(
    mutations,
    input.habitId,
    'habit.update',
  )

  if (pendingUpdate) {
    const mergedInput = mergeHabitUpdateInput(pendingUpdate.input, input.input)

    await db.mutationQueue.update(pendingUpdate.id, (mutation) => {
      if (mutation.type !== 'habit.update') {
        return
      }

      mutation.input = mergedInput
      mutation.status = 'pending'
      mutation.updatedAt = now
    })

    return null
  }

  return createHabitOfflineMutation(input, now)
}

async function foldHabitDeleteMutation(
  db: HabitOfflineDatabase,
  input: Extract<HabitOfflineMutationInput, { type: 'habit.delete' }>,
  mutations: HabitOfflineMutationRecord[],
  now: string,
): Promise<HabitOfflineMutationRecord | null> {
  const relatedMutations = mutations.filter(
    (mutation) => mutation.habitId === input.habitId,
  )
  const pendingCreate = relatedMutations.find(
    (mutation) => mutation.type === 'habit.create',
  )

  if (pendingCreate) {
    await Promise.all(
      relatedMutations.map((mutation) => db.mutationQueue.delete(mutation.id)),
    )

    return null
  }

  await Promise.all(
    relatedMutations
      .filter((mutation) => mutation.type !== 'habit.delete')
      .map((mutation) => db.mutationQueue.delete(mutation.id)),
  )

  const pendingDelete = relatedMutations.find(
    (mutation) => mutation.type === 'habit.delete',
  )

  if (pendingDelete) {
    await db.mutationQueue.update(pendingDelete.id, {
      status: 'pending',
      updatedAt: now,
    })

    return null
  }

  return createHabitOfflineMutation(input, now)
}

async function foldHabitEntryUpsertMutation(
  db: HabitOfflineDatabase,
  input: Extract<HabitOfflineMutationInput, { type: 'habit.entry.upsert' }>,
  mutations: HabitOfflineMutationRecord[],
  now: string,
): Promise<HabitOfflineMutationRecord | null> {
  const pendingHabitDelete = findMutation(
    mutations,
    input.habitId,
    'habit.delete',
  )

  if (pendingHabitDelete) {
    return null
  }

  const pendingEntryDelete = findEntryMutation(
    mutations,
    input.habitId,
    input.date,
    'habit.entry.delete',
  )

  if (pendingEntryDelete) {
    await db.mutationQueue.delete(pendingEntryDelete.id)
  }

  const pendingEntryUpsert = findEntryMutation(
    mutations,
    input.habitId,
    input.date,
    'habit.entry.upsert',
  )

  if (pendingEntryUpsert) {
    await db.mutationQueue.update(pendingEntryUpsert.id, (mutation) => {
      if (mutation.type !== 'habit.entry.upsert') {
        return
      }

      mutation.input = mergeHabitEntryUpsertInput(mutation.input, input.input)
      mutation.status = 'pending'
      mutation.updatedAt = now
    })

    return null
  }

  return createHabitOfflineMutation(input, now)
}

async function foldHabitEntryDeleteMutation(
  db: HabitOfflineDatabase,
  input: Extract<HabitOfflineMutationInput, { type: 'habit.entry.delete' }>,
  mutations: HabitOfflineMutationRecord[],
  now: string,
): Promise<HabitOfflineMutationRecord | null> {
  const pendingHabitDelete = findMutation(
    mutations,
    input.habitId,
    'habit.delete',
  )

  if (pendingHabitDelete) {
    return null
  }

  const pendingEntryUpsert = findEntryMutation(
    mutations,
    input.habitId,
    input.date,
    'habit.entry.upsert',
  )

  if (pendingEntryUpsert) {
    await db.mutationQueue.delete(pendingEntryUpsert.id)

    if (pendingEntryUpsert.input.expectedVersion === undefined) {
      return null
    }

    return createHabitOfflineMutation(
      {
        ...input,
        input: {
          expectedVersion:
            pendingEntryUpsert.input.expectedVersion ??
            input.input?.expectedVersion,
        },
      },
      now,
    )
  }

  const pendingEntryDelete = findEntryMutation(
    mutations,
    input.habitId,
    input.date,
    'habit.entry.delete',
  )

  if (pendingEntryDelete) {
    await db.mutationQueue.update(pendingEntryDelete.id, (mutation) => {
      if (mutation.type !== 'habit.entry.delete') {
        return
      }

      mutation.input = input.input ?? {}
      mutation.status = 'pending'
      mutation.updatedAt = now
    })

    return null
  }

  return createHabitOfflineMutation(input, now)
}

function createHabitOfflineMutation(
  input: HabitOfflineMutationInput,
  now: string,
): HabitOfflineMutationRecord {
  const base = {
    actorUserId: input.actorUserId,
    attemptCount: 0,
    clientMutationId: generateUuidV7(),
    conflictActualVersion: null,
    conflictExpectedVersion: null,
    createdAt: now,
    habitId: input.habitId,
    id: generateUuidV7(),
    lastError: null,
    status: 'pending',
    updatedAt: now,
    workspaceId: input.workspaceId,
  } satisfies HabitOfflineMutationBase

  if (input.type === 'habit.create') {
    return {
      ...base,
      input: input.input,
      type: input.type,
    }
  }

  if (input.type === 'habit.update') {
    return {
      ...base,
      input: input.input,
      type: input.type,
    }
  }

  if (input.type === 'habit.delete') {
    return {
      ...base,
      type: input.type,
    }
  }

  if (input.type === 'habit.entry.upsert') {
    return {
      ...base,
      date: input.date,
      input: input.input,
      type: input.type,
    }
  }

  return {
    ...base,
    date: input.date,
    input: input.input ?? {},
    type: input.type,
  }
}

function findMutation<TType extends HabitOfflineMutationRecord['type']>(
  mutations: HabitOfflineMutationRecord[],
  habitId: string,
  type: TType,
): Extract<HabitOfflineMutationRecord, { type: TType }> | undefined {
  return mutations.find(
    (
      mutation,
    ): mutation is Extract<HabitOfflineMutationRecord, { type: TType }> =>
      mutation.habitId === habitId && mutation.type === type,
  )
}

function findLastMutation<TType extends HabitOfflineMutationRecord['type']>(
  mutations: HabitOfflineMutationRecord[],
  habitId: string,
  type: TType,
): Extract<HabitOfflineMutationRecord, { type: TType }> | undefined {
  return [...mutations]
    .reverse()
    .find(
      (
        mutation,
      ): mutation is Extract<HabitOfflineMutationRecord, { type: TType }> =>
        mutation.habitId === habitId && mutation.type === type,
    )
}

function findEntryMutation<
  TType extends 'habit.entry.delete' | 'habit.entry.upsert',
>(
  mutations: HabitOfflineMutationRecord[],
  habitId: string,
  date: string,
  type: TType,
): Extract<HabitOfflineMutationRecord, { type: TType }> | undefined {
  return mutations.find(
    (
      mutation,
    ): mutation is Extract<HabitOfflineMutationRecord, { type: TType }> =>
      mutation.habitId === habitId &&
      mutation.type === type &&
      mutation.date === date,
  )
}

function mergeHabitCreateInput(
  createInput: NewHabitInput,
  updateInput: HabitUpdateInput,
): NewHabitInput {
  const nextInput = { ...createInput }

  if (updateInput.color !== undefined) {
    nextInput.color = updateInput.color
  }

  if (updateInput.daysOfWeek !== undefined) {
    nextInput.daysOfWeek = updateInput.daysOfWeek
  }

  if (updateInput.description !== undefined) {
    nextInput.description = updateInput.description
  }

  if (updateInput.endDate !== undefined) {
    nextInput.endDate = updateInput.endDate
  }

  if (updateInput.frequency !== undefined) {
    nextInput.frequency = updateInput.frequency
  }

  if (updateInput.icon !== undefined) {
    nextInput.icon = updateInput.icon
  }

  if (updateInput.reminderTime !== undefined) {
    nextInput.reminderTime = updateInput.reminderTime
  }

  if (updateInput.sortOrder !== undefined) {
    nextInput.sortOrder = updateInput.sortOrder
  }

  if (updateInput.sphereId !== undefined) {
    nextInput.sphereId = updateInput.sphereId
  }

  if (updateInput.startDate !== undefined) {
    nextInput.startDate = updateInput.startDate
  }

  if (updateInput.targetType !== undefined) {
    nextInput.targetType = updateInput.targetType
  }

  if (updateInput.targetValue !== undefined) {
    nextInput.targetValue = updateInput.targetValue
  }

  if (updateInput.title !== undefined) {
    nextInput.title = updateInput.title
  }

  if (updateInput.unit !== undefined) {
    nextInput.unit = updateInput.unit
  }

  return nextInput
}

function getUnsupportedCreateUpdateInput(
  updateInput: HabitUpdateInput,
): HabitUpdateInput {
  if (updateInput.isActive === undefined) {
    return {}
  }

  return removeUndefinedValues({
    ...(updateInput.expectedVersion !== undefined
      ? { expectedVersion: updateInput.expectedVersion }
      : {}),
    isActive: updateInput.isActive,
  })
}

function mergeHabitUpdateInput(
  currentInput: HabitUpdateInput,
  nextInput: HabitUpdateInput,
): HabitUpdateInput {
  const merged = removeUndefinedValues({
    ...currentInput,
    ...nextInput,
  })

  if (currentInput.expectedVersion !== undefined) {
    merged.expectedVersion = currentInput.expectedVersion
  }

  return merged
}

function mergeHabitEntryUpsertInput(
  currentInput: HabitEntryUpsertInput,
  nextInput: HabitEntryUpsertInput,
): HabitEntryUpsertInput {
  const merged = removeUndefinedValues({
    ...currentInput,
    ...nextInput,
  })

  if (currentInput.expectedVersion !== undefined) {
    merged.expectedVersion = currentInput.expectedVersion
  }

  return merged
}

function removeUndefinedValues<TRecord extends Record<string, unknown>>(
  value: TRecord,
): TRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as TRecord
}

function hasDefinedValues(value: Record<string, unknown>): boolean {
  return Object.values(value).some((entryValue) => entryValue !== undefined)
}

function createCachedHabitKey(workspaceId: string, habitId: string): string {
  return `${workspaceId}:${habitId}`
}

function createCachedTodayKey(workspaceId: string, date: string): string {
  return `${workspaceId}:${date}`
}

function createCachedStatsKey(
  workspaceId: string,
  from: string,
  to: string,
): string {
  return `${workspaceId}:${createStatsRangeKey(from, to)}`
}

function createStatsRangeKey(from: string, to: string): string {
  return `${from}:${to}`
}

function compareOfflineMutations(
  left: HabitOfflineMutationRecord,
  right: HabitOfflineMutationRecord,
): number {
  if (left.createdAt === right.createdAt) {
    return left.id.localeCompare(right.id)
  }

  return left.createdAt.localeCompare(right.createdAt)
}
