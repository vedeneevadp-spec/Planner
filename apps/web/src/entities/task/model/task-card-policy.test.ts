import { describe, expect, it } from 'vitest'

import type { Task } from './task.types'
import { resolveTaskCardActionPolicy } from './task-card-policy'

function createPolicyTask(overrides: Partial<Task> = {}) {
  return {
    assigneeUserId: null,
    authorUserId: null,
    plannedDate: null,
    requiresConfirmation: false,
    status: 'todo',
    ...overrides,
  } satisfies Pick<
    Task,
    | 'assigneeUserId'
    | 'authorUserId'
    | 'plannedDate'
    | 'requiresConfirmation'
    | 'status'
  >
}

describe('resolveTaskCardActionPolicy', () => {
  it('resolves schedule actions without relying on an always-true date condition', () => {
    const todayPolicy = resolveTaskCardActionPolicy({
      isSharedWorkspace: false,
      task: createPolicyTask({ plannedDate: '2026-04-23' }),
      todayKey: '2026-04-23',
      tomorrowKey: '2026-04-24',
    })

    expect(todayPolicy.hasMoveToTodayAction).toBe(false)
    expect(todayPolicy.hasMoveToTomorrowAction).toBe(true)
    expect(todayPolicy.hasPostponeAction).toBe(true)
    expect(todayPolicy.hasScheduleActions).toBe(true)

    const inboxPolicy = resolveTaskCardActionPolicy({
      isSharedWorkspace: false,
      task: createPolicyTask({ plannedDate: null }),
      todayKey: '2026-04-23',
      tomorrowKey: '2026-04-24',
    })

    expect(inboxPolicy.hasMoveToTodayAction).toBe(true)
    expect(inboxPolicy.hasMoveToTomorrowAction).toBe(true)
    expect(inboxPolicy.hasPostponeAction).toBe(false)
    expect(inboxPolicy.hasScheduleActions).toBe(true)
  })

  it('keeps unrelated shared workspace members read-only', () => {
    const policy = resolveTaskCardActionPolicy({
      currentActorUserId: 'user-3',
      isSharedWorkspace: true,
      sharedWorkspaceGroupRole: 'member',
      task: createPolicyTask({
        assigneeUserId: 'user-2',
        authorUserId: 'user-1',
      }),
      todayKey: '2026-04-23',
      tomorrowKey: '2026-04-24',
    })

    expect(policy.hasActionMenu).toBe(false)
    expect(policy.canCompleteTask).toBe(false)
    expect(policy.canEditTask).toBe(false)
    expect(policy.canDeleteTask).toBe(false)
  })
})
