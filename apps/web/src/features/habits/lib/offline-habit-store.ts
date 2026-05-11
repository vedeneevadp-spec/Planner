import {
  generateUuidV7,
  type HabitEntryDeleteInput,
  type HabitEntryRecord,
  type HabitEntryUpsertInput,
  type HabitRecord,
  type HabitStats,
  type HabitStatsResponse,
  type HabitTodayItem,
  type HabitTodayResponse,
  type HabitUpdateInput,
  type NewHabitInput,
} from '@planner/contracts'
import Dexie, { type Table } from 'dexie'

export type HabitOfflineMutationStatus =
  | 'conflicted'
  | 'failed'
  | 'pending'
  | 'syncing'

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

export function isHabitOfflineStorageAvailable(): boolean {
  return typeof indexedDB !== 'undefined'
}

export async function resetHabitOfflineDatabaseForTests(): Promise<void> {
  database?.close()
  database = null

  if (isHabitOfflineStorageAvailable()) {
    await Dexie.delete(HABIT_OFFLINE_DATABASE_NAME)
  }
}

export async function loadCachedHabitRecords(
  workspaceId: string,
): Promise<HabitRecord[]> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.cachedHabits
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()

  return rows.map((row) => row.habit)
}

export async function replaceCachedHabitRecords(
  workspaceId: string,
  habits: HabitRecord[],
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  const updatedAt = new Date().toISOString()
  const rows = habits.map(
    (habit): HabitCachedHabitRow => ({
      habit,
      habitId: habit.id,
      key: createCachedHabitKey(workspaceId, habit.id),
      updatedAt,
      workspaceId,
    }),
  )

  await db.transaction('rw', db.cachedHabits, async () => {
    await db.cachedHabits.where('workspaceId').equals(workspaceId).delete()

    if (rows.length > 0) {
      await db.cachedHabits.bulkPut(rows)
    }
  })
}

export async function upsertCachedHabitRecord(
  workspaceId: string,
  habit: HabitRecord,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedHabits.put({
    habit,
    habitId: habit.id,
    key: createCachedHabitKey(workspaceId, habit.id),
    updatedAt: new Date().toISOString(),
    workspaceId,
  })
}

export async function removeCachedHabitRecord(
  workspaceId: string,
  habitId: string,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedHabits.delete(createCachedHabitKey(workspaceId, habitId))
}

export async function loadCachedHabitTodayResponse(
  workspaceId: string,
  date: string,
): Promise<HabitTodayResponse | null> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return null
  }

  const row = await db.cachedTodayResponses.get(
    createCachedTodayKey(workspaceId, date),
  )

  return row?.response ?? null
}

export async function replaceCachedHabitTodayResponse(
  workspaceId: string,
  date: string,
  response: HabitTodayResponse,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedTodayResponses.put({
    date,
    key: createCachedTodayKey(workspaceId, date),
    response,
    updatedAt: new Date().toISOString(),
    workspaceId,
  })
}

export async function upsertCachedHabitInTodayResponses(
  workspaceId: string,
  habit: HabitRecord,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  const rows = await db.cachedTodayResponses
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()
  const updatedAt = new Date().toISOString()

  await db.transaction('rw', db.cachedTodayResponses, async () => {
    for (const row of rows) {
      await db.cachedTodayResponses.put({
        ...row,
        response: upsertHabitInTodayResponse(row.response, habit),
        updatedAt,
      })
    }
  })
}

export async function removeCachedHabitFromTodayResponses(
  workspaceId: string,
  habitId: string,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  const rows = await db.cachedTodayResponses
    .where('workspaceId')
    .equals(workspaceId)
    .toArray()
  const updatedAt = new Date().toISOString()

  await db.transaction('rw', db.cachedTodayResponses, async () => {
    for (const row of rows) {
      await db.cachedTodayResponses.put({
        ...row,
        response: removeHabitFromTodayResponse(row.response, habitId),
        updatedAt,
      })
    }
  })
}

export async function upsertCachedHabitTodayEntry(
  workspaceId: string,
  habitId: string,
  date: string,
  entry: HabitEntryRecord,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

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
}

export async function removeCachedHabitTodayEntry(
  workspaceId: string,
  habitId: string,
  date: string,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

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
}

export async function loadCachedHabitStatsResponse(
  workspaceId: string,
  from: string,
  to: string,
): Promise<HabitStatsResponse | null> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return null
  }

  const row = await db.cachedStatsResponses.get(
    createCachedStatsKey(workspaceId, from, to),
  )

  return row?.response ?? null
}

export async function replaceCachedHabitStatsResponse(
  workspaceId: string,
  from: string,
  to: string,
  response: HabitStatsResponse,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  await db.cachedStatsResponses.put({
    from,
    key: createCachedStatsKey(workspaceId, from, to),
    rangeKey: createStatsRangeKey(from, to),
    response,
    to,
    updatedAt: new Date().toISOString(),
    workspaceId,
  })
}

export async function enqueueHabitOfflineMutation(
  input: HabitOfflineMutationInput,
): Promise<HabitOfflineMutationRecord | null> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return null
  }

  const now = new Date().toISOString()

  return db.transaction('rw', db.mutationQueue, async () => {
    const existingMutations = await db.mutationQueue
      .where('workspaceId')
      .equals(input.workspaceId)
      .filter((mutation) => RETRYABLE_QUEUE_STATUSES.includes(mutation.status))
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
  })
}

export async function listRetryableHabitOfflineMutations(
  workspaceId: string,
): Promise<HabitOfflineMutationRecord[]> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return []
  }

  const rows = await db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter((mutation) => RETRYABLE_QUEUE_STATUSES.includes(mutation.status))
    .toArray()

  return rows.sort(compareOfflineMutations)
}

export async function countRetryableHabitOfflineMutations(
  workspaceId: string,
): Promise<number> {
  const mutations = await listRetryableHabitOfflineMutations(workspaceId)

  return mutations.length
}

export async function countConflictedHabitOfflineMutations(
  workspaceId: string,
): Promise<number> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return 0
  }

  return db.mutationQueue
    .where('workspaceId')
    .equals(workspaceId)
    .filter((mutation) => mutation.status === 'conflicted')
    .count()
}

export async function markHabitOfflineMutationSyncing(
  mutationId: string,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  const mutation = await db.mutationQueue.get(mutationId)

  if (!mutation) {
    return
  }

  await db.mutationQueue.update(mutationId, {
    attemptCount: mutation.attemptCount + 1,
    conflictActualVersion: null,
    conflictExpectedVersion: null,
    lastError: null,
    status: 'syncing',
    updatedAt: new Date().toISOString(),
  })
}

export async function completeHabitOfflineMutation(
  mutationId: string,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  await db.mutationQueue.delete(mutationId)
}

export async function markHabitOfflineMutationFailed(
  mutationId: string,
  errorMessage: string,
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  await db.mutationQueue.update(mutationId, {
    lastError: errorMessage,
    status: 'failed',
    updatedAt: new Date().toISOString(),
  })
}

export async function markHabitOfflineMutationConflicted(
  mutationId: string,
  conflict: {
    actualVersion: number | null
    expectedVersion: number | null
    message: string
  },
): Promise<void> {
  const db = getHabitOfflineDatabase()

  if (!db) {
    return
  }

  await db.mutationQueue.update(mutationId, {
    conflictActualVersion: conflict.actualVersion,
    conflictExpectedVersion: conflict.expectedVersion,
    lastError: conflict.message,
    status: 'conflicted',
    updatedAt: new Date().toISOString(),
  })
}

function getHabitOfflineDatabase(): HabitOfflineDatabase | null {
  if (!isHabitOfflineStorageAvailable()) {
    return null
  }

  database ??= new HabitOfflineDatabase()

  return database
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

function upsertHabitInTodayResponse(
  response: HabitTodayResponse,
  habit: HabitRecord,
): HabitTodayResponse {
  const item = response.items.find((entry) => entry.habit.id === habit.id)

  if (!isHabitScheduledOnDate(habit, response.date)) {
    return removeHabitFromTodayResponse(response, habit.id)
  }

  if (!item) {
    return {
      ...response,
      items: [
        ...response.items,
        createHabitTodayItem({
          date: response.date,
          entry: null,
          habit,
        }),
      ],
    }
  }

  return {
    ...response,
    items: response.items.map((entry) =>
      entry.habit.id === habit.id
        ? {
            ...entry,
            habit,
            progressPercent: getEntryProgressPercent(habit, entry.entry),
          }
        : entry,
    ),
  }
}

function removeHabitFromTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.filter((item) => item.habit.id !== habitId),
  }
}

function upsertEntryInTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
  entry: HabitEntryRecord,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.map((item) =>
      item.habit.id === habitId
        ? {
            ...item,
            entry,
            progressPercent: getEntryProgressPercent(item.habit, entry),
          }
        : item,
    ),
  }
}

function removeEntryInTodayResponse(
  response: HabitTodayResponse,
  habitId: string,
): HabitTodayResponse {
  return {
    ...response,
    items: response.items.map((item) =>
      item.habit.id === habitId
        ? {
            ...item,
            entry: null,
            progressPercent: 0,
          }
        : item,
    ),
  }
}

function createHabitTodayItem(input: {
  date: string
  entry: HabitEntryRecord | null
  habit: HabitRecord
}): HabitTodayItem {
  return {
    entry: input.entry,
    habit: input.habit,
    isDueToday: true,
    progressPercent: getEntryProgressPercent(input.habit, input.entry),
    stats: createEmptyHabitStats(input.habit.id),
  }
}

function createEmptyHabitStats(habitId: string): HabitStats {
  return {
    bestStreak: 0,
    completedCount: 0,
    completionRate: 0,
    currentStreak: 0,
    habitId,
    lastCompletedDate: null,
    missedCount: 0,
    monthCompleted: 0,
    monthScheduled: 0,
    scheduledCount: 0,
    skippedCount: 0,
    weekCompleted: 0,
    weekScheduled: 0,
  }
}

function getEntryProgressPercent(
  habit: Pick<HabitRecord, 'targetValue'>,
  entry: Pick<HabitEntryRecord, 'status' | 'value'> | null,
): number {
  if (!entry || entry.status === 'skipped') {
    return 0
  }

  return Math.min(100, Math.round((entry.value / habit.targetValue) * 100))
}

function isHabitScheduledOnDate(habit: HabitRecord, dateKey: string): boolean {
  if (!habit.isActive || dateKey < habit.startDate) {
    return false
  }

  if (habit.endDate && dateKey > habit.endDate) {
    return false
  }

  return habit.daysOfWeek.includes(getIsoWeekday(dateKey))
}

function getIsoWeekday(dateKey: string): number {
  const day = new Date(`${dateKey}T00:00:00`).getDay()

  return day === 0 ? 7 : day
}
