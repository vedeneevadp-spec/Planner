import type {
  CleaningListResponse,
  CleaningTaskActionResponse,
  CleaningTaskHistoryAction,
  CleaningZoneRecord,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import type { CleaningOfflineMutationRecord } from './offline-cleaning-mutation'
import { applyCleaningServerConfirmation } from './offline-cleaning-projection'

describe('cleaning offline projection', () => {
  it('retains sequential actions of different types on the same date', () => {
    const confirmed: CleaningListResponse = {
      history: [],
      states: [],
      tasks: [],
      zones: [],
    }
    const afterComplete = applyCleaningServerConfirmation(
      confirmed,
      actionMutation('completed', 'operation-1', 1),
      { kind: 'action', value: actionResponse('completed', 'history-1', 2) },
    )
    const afterPostpone = applyCleaningServerConfirmation(
      afterComplete,
      actionMutation('postponed', 'operation-2', 2),
      { kind: 'action', value: actionResponse('postponed', 'history-2', 3) },
    )

    expect(
      afterPostpone.history.map((item) => ({
        action: item.action,
        id: item.id,
      })),
    ).toEqual([
      { action: 'postponed', id: 'history-2' },
      { action: 'completed', id: 'history-1' },
    ])
  })

  it('does not downgrade a newer cached entity with an older confirmation', () => {
    const confirmed: CleaningListResponse = {
      history: [],
      states: [],
      tasks: [],
      zones: [zoneRecord(3, 'Кухня после нового обновления')],
    }

    const reconciled = applyCleaningServerConfirmation(
      confirmed,
      zoneUpdateMutation(),
      { kind: 'zone', value: zoneRecord(2, 'Устаревшее подтверждение') },
    )

    expect(reconciled.zones).toEqual([
      zoneRecord(3, 'Кухня после нового обновления'),
    ])
  })

  it('does not resurrect an updated entity absent from a newer full snapshot', () => {
    const reconciled = applyCleaningServerConfirmation(
      { history: [], states: [], tasks: [], zones: [] },
      zoneUpdateMutation(),
      { kind: 'zone', value: zoneRecord(2, 'Устаревшее подтверждение') },
    )

    expect(reconciled.zones).toEqual([])
  })
})

function zoneUpdateMutation(): CleaningOfflineMutationRecord {
  return {
    actorUserId: 'user-1',
    attemptCount: 1,
    conflictActualVersion: null,
    conflictExpectedVersion: null,
    createdAt: '2026-08-06T08:00:00.000Z',
    dependsOnOperationIds: [],
    entityKeys: ['zone:zone-1'],
    expectedVersion: 1,
    input: { title: 'Новое название' },
    lastError: null,
    operationId: 'operation-zone-update',
    status: 'syncing',
    type: 'zone.update',
    updatedAt: '2026-08-06T08:00:00.000Z',
    workspaceId: 'workspace-1',
    zoneId: 'zone-1',
  }
}

function zoneRecord(version: number, title: string): CleaningZoneRecord {
  return {
    createdAt: '2026-08-06T08:00:00.000Z',
    dayOfWeek: 4,
    deletedAt: null,
    description: '',
    id: 'zone-1',
    isActive: true,
    sortOrder: 0,
    title,
    updatedAt: '2026-08-06T08:00:00.000Z',
    userId: 'user-1',
    version,
    workspaceId: 'workspace-1',
  }
}

function actionMutation(
  action: CleaningTaskHistoryAction,
  operationId: string,
  expectedStateVersion: number,
): CleaningOfflineMutationRecord {
  return {
    action,
    actorUserId: 'user-1',
    attemptCount: 1,
    conflictActualVersion: null,
    conflictExpectedVersion: null,
    createdAt: '2026-08-06T08:00:00.000Z',
    dependsOnOperationIds: [],
    entityKeys: ['task:task-1'],
    expectedStateVersion,
    expectedTaskVersion: 1,
    input: {
      date: '2026-08-06',
      mode: 'next_cycle',
      note: '',
      occurredAt: '2026-08-06T08:00:00.000Z',
      targetDate: null,
    },
    lastError: null,
    operationId,
    status: 'syncing',
    taskId: 'task-1',
    type: 'task.action',
    updatedAt: '2026-08-06T08:00:00.000Z',
    workspaceId: 'workspace-1',
  }
}

function actionResponse(
  action: CleaningTaskHistoryAction,
  id: string,
  version: number,
): CleaningTaskActionResponse {
  return {
    historyItem: {
      action,
      createdAt: '2026-08-06T08:00:00.000Z',
      date: '2026-08-06',
      id,
      note: '',
      targetDate: null,
      taskId: 'task-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      zoneId: null,
    },
    state: {
      lastCompletedAt: null,
      lastPostponedAt: null,
      lastSkippedAt: null,
      nextDueAt: null,
      postponeCount: 0,
      taskId: 'task-1',
      updatedAt: '2026-08-06T08:00:00.000Z',
      version,
      workspaceId: 'workspace-1',
    },
  }
}
