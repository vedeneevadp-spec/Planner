import type { HabitEntryRecord, HabitRecord } from '@planner/contracts'

import { type HabitsApiClient, HabitsApiError } from './habits-api'
import {
  completeHabitOfflineMutation,
  type HabitOfflineMutationRecord,
  listRetryableHabitOfflineMutations,
  markHabitOfflineMutationConflicted,
  markHabitOfflineMutationFailed,
  markHabitOfflineMutationSyncing,
  removeCachedHabitFromTodayResponses,
  removeCachedHabitRecord,
  removeCachedHabitTodayEntry,
  upsertCachedHabitInTodayResponses,
  upsertCachedHabitRecord,
  upsertCachedHabitTodayEntry,
} from './offline-habit-store'

export interface HabitOfflineDrainResult {
  conflicted: number
  failed: number
  processed: number
  synced: number
}

export interface DrainHabitOfflineQueueOptions {
  api: HabitsApiClient
  onEntryDeleted?: (input: { date: string; habitId: string }) => void
  onEntrySynced?: (entry: HabitEntryRecord) => void
  onHabitDeleted?: (habitId: string) => void
  onHabitSynced?: (habit: HabitRecord) => void
  workspaceId: string
}

interface ConflictDetails {
  actualVersion: number | null
  expectedVersion: number | null
}

interface OfflineMutationCallbacks {
  onEntryDeleted?: (input: { date: string; habitId: string }) => void
  onEntrySynced?: (entry: HabitEntryRecord) => void
  onHabitDeleted?: (habitId: string) => void
  onHabitSynced?: (habit: HabitRecord) => void
}

export async function drainHabitOfflineQueue({
  api,
  onEntryDeleted,
  onEntrySynced,
  onHabitDeleted,
  onHabitSynced,
  workspaceId,
}: DrainHabitOfflineQueueOptions): Promise<HabitOfflineDrainResult> {
  const result: HabitOfflineDrainResult = {
    conflicted: 0,
    failed: 0,
    processed: 0,
    synced: 0,
  }
  const mutations = await listRetryableHabitOfflineMutations(workspaceId)
  const callbacks: OfflineMutationCallbacks = {}

  if (onEntryDeleted) {
    callbacks.onEntryDeleted = onEntryDeleted
  }

  if (onEntrySynced) {
    callbacks.onEntrySynced = onEntrySynced
  }

  if (onHabitDeleted) {
    callbacks.onHabitDeleted = onHabitDeleted
  }

  if (onHabitSynced) {
    callbacks.onHabitSynced = onHabitSynced
  }

  for (const mutation of mutations) {
    result.processed += 1
    await markHabitOfflineMutationSyncing(mutation.id)

    try {
      await applyOfflineMutation(api, mutation, callbacks)
      await completeHabitOfflineMutation(mutation.id)
      result.synced += 1
    } catch (error) {
      if (isTerminalHabitSyncError(error)) {
        const conflict = getConflictDetails(error)

        await markHabitOfflineMutationConflicted(mutation.id, {
          actualVersion: conflict.actualVersion,
          expectedVersion: conflict.expectedVersion,
          message: getErrorMessage(error),
        })
        result.conflicted += 1
        continue
      }

      await markHabitOfflineMutationFailed(mutation.id, getErrorMessage(error))
      result.failed += 1
      break
    }
  }

  return result
}

export function isQueueableHabitMutationError(error: unknown): boolean {
  if (error instanceof HabitsApiError) {
    return false
  }

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true
  }

  return error instanceof DOMException || error instanceof TypeError
}

async function applyOfflineMutation(
  api: HabitsApiClient,
  mutation: HabitOfflineMutationRecord,
  callbacks: OfflineMutationCallbacks,
): Promise<void> {
  if (mutation.type === 'habit.create') {
    const habit = await api.createHabit(mutation.input)

    await upsertCachedHabitRecord(mutation.workspaceId, habit)
    await upsertCachedHabitInTodayResponses(mutation.workspaceId, habit)
    callbacks.onHabitSynced?.(habit)

    return
  }

  if (mutation.type === 'habit.update') {
    const habit = await api.updateHabit(mutation.habitId, mutation.input)

    await upsertCachedHabitRecord(mutation.workspaceId, habit)
    await upsertCachedHabitInTodayResponses(mutation.workspaceId, habit)
    callbacks.onHabitSynced?.(habit)

    return
  }

  if (mutation.type === 'habit.delete') {
    await api.removeHabit(mutation.habitId)
    await removeCachedHabitRecord(mutation.workspaceId, mutation.habitId)
    await removeCachedHabitFromTodayResponses(
      mutation.workspaceId,
      mutation.habitId,
    )
    callbacks.onHabitDeleted?.(mutation.habitId)

    return
  }

  if (mutation.type === 'habit.entry.upsert') {
    const entry = await api.upsertEntry(
      mutation.habitId,
      mutation.date,
      mutation.input,
    )

    await upsertCachedHabitTodayEntry(
      mutation.workspaceId,
      mutation.habitId,
      mutation.date,
      entry,
    )
    callbacks.onEntrySynced?.(entry)

    return
  }

  await api.removeEntry(mutation.habitId, mutation.date, mutation.input)
  await removeCachedHabitTodayEntry(
    mutation.workspaceId,
    mutation.habitId,
    mutation.date,
  )
  callbacks.onEntryDeleted?.({
    date: mutation.date,
    habitId: mutation.habitId,
  })
}

function isTerminalHabitSyncError(error: unknown): error is HabitsApiError {
  return (
    error instanceof HabitsApiError &&
    (error.code === 'habit_version_conflict' ||
      error.code === 'habit_entry_version_conflict' ||
      error.code === 'habit_not_found' ||
      error.code === 'habit_sphere_not_found' ||
      error.code === 'habit_not_scheduled')
  )
}

function getConflictDetails(error: HabitsApiError): ConflictDetails {
  if (!isRecord(error.details)) {
    return {
      actualVersion: null,
      expectedVersion: null,
    }
  }

  return {
    actualVersion: getNumber(error.details.actualVersion),
    expectedVersion: getNumber(error.details.expectedVersion),
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Не удалось синхронизировать offline-привычку.'
}

function getNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
