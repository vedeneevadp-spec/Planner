import type { AdminUserRecord } from '@planner/contracts'
import { describe, expect, it } from 'vitest'

import { sortAdminUsers } from './admin-user-sort'

const USERS: AdminUserRecord[] = [
  createUser({
    displayName: 'Без входа',
    id: 'never',
    lastSeenAt: null,
    taskCount: 5,
  }),
  createUser({
    displayName: 'Недавний',
    id: 'recent',
    lastSeenAt: '2026-08-03T12:00:00.000Z',
    taskCount: 2,
  }),
  createUser({
    displayName: 'Давний',
    id: 'old',
    lastSeenAt: '2026-07-01T12:00:00.000Z',
    taskCount: 9,
  }),
]

describe('sortAdminUsers', () => {
  it('sorts by task count in both directions without mutating the source', () => {
    expect(sortAdminUsers(USERS, 'tasks-desc').map((user) => user.id)).toEqual([
      'old',
      'never',
      'recent',
    ])
    expect(sortAdminUsers(USERS, 'tasks-asc').map((user) => user.id)).toEqual([
      'recent',
      'never',
      'old',
    ])
    expect(USERS.map((user) => user.id)).toEqual(['never', 'recent', 'old'])
  })

  it('sorts by last visit and always keeps users without visits last', () => {
    expect(
      sortAdminUsers(USERS, 'last-seen-desc').map((user) => user.id),
    ).toEqual(['recent', 'old', 'never'])
    expect(
      sortAdminUsers(USERS, 'last-seen-asc').map((user) => user.id),
    ).toEqual(['old', 'recent', 'never'])
  })
})

function createUser(
  input: Pick<
    AdminUserRecord,
    'displayName' | 'id' | 'lastSeenAt' | 'taskCount'
  >,
): AdminUserRecord {
  return {
    appRole: 'user',
    email: `${input.id}@example.test`,
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...input,
  }
}
