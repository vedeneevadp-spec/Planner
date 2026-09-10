import type {
  CleaningListResponse,
  CleaningTaskActionResponse,
  CleaningTaskHistoryAction,
  CleaningTaskRecord,
  CleaningTaskStateRecord,
  CleaningTodayResponse,
  CleaningZoneRecord,
} from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import type { CleaningOfflineMutationRecord } from './offline-cleaning-mutation'
import {
  applyCleaningServerConfirmation,
  projectCleaningPlan,
  projectCleaningToday,
} from './offline-cleaning-projection'

describe('cleaning offline projection', () => {
  it('resets the postpone counter for an offline completion', () => {
    const projected = projectCleaningPlan(
      {
        history: [],
        states: [taskStateRecord(2)],
        tasks: [taskRecord()],
        zones: [],
      },
      [actionMutation('completed', 'operation-complete', 1)],
    )

    expect(projected.states[0]?.postponeCount).toBe(0)
  })

  it('aligns an offline zone-task completion with the zone weekday', () => {
    const zone = zoneRecord(1, 'Кухня', 1)
    const task: CleaningTaskRecord = {
      ...taskRecord(),
      scope: 'zone',
      zoneId: zone.id,
    }
    const projected = projectCleaningPlan(
      {
        history: [],
        states: [taskStateRecord(0)],
        tasks: [task],
        zones: [zone],
      },
      [actionMutation('completed', 'operation-complete', 1)],
    )

    expect(projected.states[0]?.nextDueAt).toBe('2026-08-17')
  })

  it('keeps an explicitly due task from another zone in the offline today list', () => {
    const zone = zoneRecord(1, 'Кухня', 1)
    const task: CleaningTaskRecord = {
      ...taskRecord(),
      scope: 'zone',
      zoneId: zone.id,
    }
    const state: CleaningTaskStateRecord = {
      ...taskStateRecord(0),
      nextDueAt: '2026-08-12',
    }
    const projected = projectCleaningToday(emptyToday('2026-08-12'), {
      history: [],
      states: [state],
      tasks: [task],
      zones: [zone],
    })

    expect(projected.zones).toEqual([])
    expect(projected.items.map((item) => item.task.id)).toEqual([task.id])
    expect(projected.accumulatedItems).toEqual([])
    expect(projected.summary.dueCount).toBe(1)
  })

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

function zoneRecord(
  version: number,
  title: string,
  dayOfWeek = 4,
): CleaningZoneRecord {
  return {
    createdAt: '2026-08-06T08:00:00.000Z',
    dayOfWeek,
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

function emptyToday(date: string): CleaningTodayResponse {
  return {
    accumulatedItems: [],
    date,
    dayOfWeek: 3,
    generalItems: [],
    history: [],
    items: [],
    quickItems: [],
    seasonalItems: [],
    summary: {
      accumulatedCount: 0,
      activeZoneCount: 0,
      completedTodayCount: 0,
      dueCount: 0,
      generalCount: 0,
      quickCount: 0,
      seasonalCount: 0,
      urgentCount: 0,
    },
    urgentItems: [],
    zones: [],
  }
}

function taskRecord(): CleaningTaskRecord {
  return {
    assignee: 'anyone',
    createdAt: '2026-08-01T08:00:00.000Z',
    customIntervalDays: null,
    deletedAt: null,
    depth: 'regular',
    description: '',
    energy: 'normal',
    estimatedMinutes: 15,
    frequencyInterval: 1,
    frequencyType: 'weekly',
    id: 'task-1',
    impactScore: 3,
    isActive: true,
    isSeasonal: false,
    priority: 'normal',
    scope: 'general',
    seasonMonths: [],
    sortOrder: 0,
    tags: [],
    title: 'Помыть холодильник',
    updatedAt: '2026-08-01T08:00:00.000Z',
    userId: 'user-1',
    version: 1,
    workspaceId: 'workspace-1',
    zoneId: null,
  }
}

function taskStateRecord(postponeCount: number): CleaningTaskStateRecord {
  return {
    lastCompletedAt: null,
    lastPostponedAt: '2026-08-01T08:00:00.000Z',
    lastSkippedAt: null,
    nextDueAt: '2026-08-06',
    postponeCount,
    taskId: 'task-1',
    updatedAt: '2026-08-01T08:00:00.000Z',
    version: 1,
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
