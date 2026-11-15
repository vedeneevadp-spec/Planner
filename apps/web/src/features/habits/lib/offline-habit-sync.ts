import type { HabitEntryRecord, HabitRecord } from '@planner/contracts'

import {
  createOfflineDrainErrorHandler,
  createOfflineDrainResult,
  drainOfflineQueue,
  getOfflineErrorMessage,
  isBrowserRetryableOfflineError,
  readOfflineConflictDetails,
  trackOfflineMutation,
  withWorkspaceMutationLock,
} from '@/shared/lib/offline-sync'

import { type HabitsApiClient, HabitsApiError } from './habits-api'
import {
  claimHabitOfflineMutation,
  completeHabitOfflineMutation,
  getHabitOfflineWorkspaceWriteGeneration,
  type HabitOfflineMutationRecord,
  isHabitOfflineWorkspaceWriteGenerationCurrent,
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
  actorUserId: string
  api: HabitsApiClient
  onEntryDeleted?: (input: { date: string; habitId: string }) => void
  onEntrySynced?: (entry: HabitEntryRecord) => void
  onHabitDeleted?: (habitId: string) => void
  onHabitSynced?: (habit: HabitRecord) => void
  workspaceId: string
}

interface OfflineMutationCallbacks {
  onEntryDeleted?: (input: { date: string; habitId: string }) => void
  onEntrySynced?: (entry: HabitEntryRecord) => void
  onHabitDeleted?: (habitId: string) => void
  onHabitSynced?: (habit: HabitRecord) => void
}

export function drainHabitOfflineQueue(
  options: DrainHabitOfflineQueueOptions,
): Promise<HabitOfflineDrainResult> {
  return withWorkspaceMutationLock(
    `offline:habits:${options.workspaceId}`,
    () => drainHabitOfflineQueueUnlocked(options),
  )
}

async function drainHabitOfflineQueueUnlocked({
  actorUserId,
  api,
  onEntryDeleted,
  onEntrySynced,
  onHabitDeleted,
  onHabitSynced,
  workspaceId,
}: DrainHabitOfflineQueueOptions): Promise<HabitOfflineDrainResult> {
  const generation = getHabitOfflineWorkspaceWriteGeneration(workspaceId)
  const isCurrent = () =>
    isHabitOfflineWorkspaceWriteGenerationCurrent(workspaceId, generation)
  const result = createOfflineDrainResult<HabitOfflineDrainResult>({
    conflicted: 0,
  })
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

  return drainOfflineQueue({
    isCurrent,
    adapter: {
      claimMutation: claimHabitOfflineMutation,
      completeMutation: completeHabitOfflineMutation,
      getMutationId: (mutation) => mutation.id,
      listRetryableMutations: () =>
        listRetryableHabitOfflineMutations(workspaceId, actorUserId),
      markMutationSyncing: markHabitOfflineMutationSyncing,
    },
    apply: (mutation) =>
      applyOfflineMutation(api, mutation, callbacks, isCurrent),
    result,
    onError: createOfflineDrainErrorHandler<HabitOfflineDrainResult>({
      getErrorMessage,
      isTerminalError: isTerminalHabitSyncError,
      markConflicted: markHabitOfflineMutationConflicted,
      markFailed: markHabitOfflineMutationFailed,
      readConflict: (error) =>
        error instanceof HabitsApiError
          ? readOfflineConflictDetails(error.details)
          : { actualVersion: null, expectedVersion: null },
    }),
  })
}

export function isQueueableHabitMutationError(error: unknown): boolean {
  if (error instanceof HabitsApiError) {
    return false
  }

  return isBrowserRetryableOfflineError(error)
}

async function applyOfflineMutation(
  api: HabitsApiClient,
  mutation: HabitOfflineMutationRecord,
  callbacks: OfflineMutationCallbacks,
  isCurrent: () => boolean,
): Promise<void> {
  if (mutation.type === 'habit.create') {
    const habit = await trackOfflineMutation(
      mutation.workspaceId,
      mutation.id,
      () => api.createHabit(mutation.input),
    )

    if (!isCurrent()) return
    await upsertCachedHabitRecord(mutation.workspaceId, habit)
    await upsertCachedHabitInTodayResponses(mutation.workspaceId, habit)
    if (isCurrent()) callbacks.onHabitSynced?.(habit)

    return
  }

  if (mutation.type === 'habit.update') {
    const habit = await trackOfflineMutation(
      mutation.workspaceId,
      mutation.id,
      () => api.updateHabit(mutation.habitId, mutation.input),
    )

    if (!isCurrent()) return
    await upsertCachedHabitRecord(mutation.workspaceId, habit)
    await upsertCachedHabitInTodayResponses(mutation.workspaceId, habit)
    if (isCurrent()) callbacks.onHabitSynced?.(habit)

    return
  }

  if (mutation.type === 'habit.delete') {
    await trackOfflineMutation(mutation.workspaceId, mutation.id, () =>
      api.removeHabit(mutation.habitId),
    )
    if (!isCurrent()) return
    await removeCachedHabitRecord(mutation.workspaceId, mutation.habitId)
    await removeCachedHabitFromTodayResponses(
      mutation.workspaceId,
      mutation.habitId,
    )
    if (isCurrent()) callbacks.onHabitDeleted?.(mutation.habitId)

    return
  }

  if (mutation.type === 'habit.entry.upsert') {
    const entry = await trackOfflineMutation(
      mutation.workspaceId,
      mutation.id,
      () => api.upsertEntry(mutation.habitId, mutation.date, mutation.input),
    )

    if (!isCurrent()) return
    await upsertCachedHabitTodayEntry(
      mutation.workspaceId,
      mutation.habitId,
      mutation.date,
      entry,
    )
    if (isCurrent()) callbacks.onEntrySynced?.(entry)

    return
  }

  await trackOfflineMutation(mutation.workspaceId, mutation.id, () =>
    api.removeEntry(mutation.habitId, mutation.date, mutation.input),
  )
  if (!isCurrent()) return
  await removeCachedHabitTodayEntry(
    mutation.workspaceId,
    mutation.habitId,
    mutation.date,
  )
  if (!isCurrent()) return
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

function getErrorMessage(error: unknown): string {
  return getOfflineErrorMessage(
    error,
    'Не удалось синхронизировать offline-привычку.',
  )
}
