import type { AdminUserRecord } from '@planner/contracts'

export type AdminUserSort =
  'name' | 'tasks-asc' | 'tasks-desc' | 'last-seen-asc' | 'last-seen-desc'

export function sortAdminUsers(
  users: readonly AdminUserRecord[],
  sort: AdminUserSort,
): AdminUserRecord[] {
  return [...users].sort((left, right) => {
    if (sort === 'tasks-asc' || sort === 'tasks-desc') {
      const direction = sort === 'tasks-asc' ? 1 : -1
      const taskComparison = (left.taskCount - right.taskCount) * direction

      return taskComparison || compareUserIdentity(left, right)
    }

    if (sort === 'last-seen-asc' || sort === 'last-seen-desc') {
      const lastSeenComparison = compareNullableTimestamps(
        left.lastSeenAt,
        right.lastSeenAt,
        sort === 'last-seen-asc' ? 1 : -1,
      )

      return lastSeenComparison || compareUserIdentity(left, right)
    }

    return compareOwnerFirst(left, right) || compareUserIdentity(left, right)
  })
}

function compareNullableTimestamps(
  left: string | null,
  right: string | null,
  direction: 1 | -1,
): number {
  if (!left && !right) {
    return 0
  }

  if (!left) {
    return 1
  }

  if (!right) {
    return -1
  }

  return (new Date(left).getTime() - new Date(right).getTime()) * direction
}

function compareOwnerFirst(
  left: AdminUserRecord,
  right: AdminUserRecord,
): number {
  return Number(right.appRole === 'owner') - Number(left.appRole === 'owner')
}

function compareUserIdentity(
  left: AdminUserRecord,
  right: AdminUserRecord,
): number {
  return (
    left.displayName.localeCompare(right.displayName, 'ru') ||
    left.email.localeCompare(right.email, 'ru')
  )
}
