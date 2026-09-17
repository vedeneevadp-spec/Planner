import type { Table } from 'dexie'

import type { PlannerOfflineMutationRecord } from './offline-planner-store'

export interface PlannerOfflineConflictGroup {
  id: string
  mutations: PlannerOfflineMutationRecord[]
}

export function getPlannerMutationTargets(
  mutation: PlannerOfflineMutationRecord,
): string[] {
  if ('sphereId' in mutation) {
    return mutation.type === 'lifeSphere.create'
      ? [`sphere:${mutation.sphereId}`, `sphere-create:${mutation.sphereId}`]
      : [`sphere:${mutation.sphereId}`]
  }
  const targets = [`task:${mutation.taskId}`]
  if (mutation.type === 'task.next-stage') {
    targets.push(`task:${mutation.nextTaskId}`)
  }
  return targets
}

export function getPlannerMutationDependencies(
  mutation: PlannerOfflineMutationRecord,
): string[] {
  const dependencies = getPlannerMutationTargets(mutation)
  if (
    (mutation.type === 'task.create' || mutation.type === 'task.update') &&
    mutation.input.sphereId
  ) {
    dependencies.push(`sphere-create:${mutation.input.sphereId}`)
  }
  return dependencies
}

// Walk in queue order: only later commands depend on an earlier refusal.
// A next-stage command joins both task identities. Tasks depend on a sphere's
// creation, not its edits; one refused task never blocks its whole sphere.
export function groupPlannerOfflineConflicts(
  mutations: PlannerOfflineMutationRecord[],
): PlannerOfflineConflictGroup[] {
  const groups: (PlannerOfflineConflictGroup & { targets: Set<string> })[] = []
  for (const mutation of mutations) {
    const dependencies = getPlannerMutationDependencies(mutation)
    const matching = groups.filter((group) =>
      dependencies.some((key) => group.targets.has(key)),
    )
    if (matching.length === 0 && mutation.status !== 'conflicted') continue
    const group = matching[0] ?? {
      id: mutation.id,
      mutations: [],
      targets: new Set<string>(),
    }
    if (matching.length === 0) groups.push(group)
    for (const joined of matching.slice(1)) {
      group.mutations.push(...joined.mutations)
      joined.targets.forEach((key) => group.targets.add(key))
      groups.splice(groups.indexOf(joined), 1)
    }
    group.mutations.push(mutation)
    getPlannerMutationTargets(mutation).forEach((key) => group.targets.add(key))
  }
  const positions = new Map(
    mutations.map((mutation, index) => [mutation.id, index]),
  )
  return groups.map(({ id, mutations: members }) => ({
    id,
    mutations: members.sort(
      (a, b) => positions.get(a.id)! - positions.get(b.id)!,
    ),
  }))
}

// Called inside the store's generation-guarded write transaction, after this
// optional module has loaded. Never await a module import inside a transaction.
export async function applyPlannerOfflineConflictResolution(
  queue: Table<PlannerOfflineMutationRecord, string>,
  workspaceId: string,
  actorUserId: string,
  mutationId: string,
  action: 'retry' | 'discard',
  compare: (
    a: PlannerOfflineMutationRecord,
    b: PlannerOfflineMutationRecord,
  ) => number,
): Promise<void> {
  const mutations = (
    await queue
      .where('workspaceId')
      .equals(workspaceId)
      .filter((mutation) => mutation.actorUserId === actorUserId)
      .toArray()
  ).sort(compare)
  const group = groupPlannerOfflineConflicts(mutations).find((candidate) =>
    candidate.mutations.some((mutation) => mutation.id === mutationId),
  )
  if (!group) return
  if (action === 'discard') {
    await queue.bulkDelete(group.mutations.map((mutation) => mutation.id))
    return
  }
  // Preserve payload, expected versions and sequence; never silently rebase.
  await queue.bulkPut(
    group.mutations.map((mutation) => ({
      ...mutation,
      conflictActualVersion: null,
      conflictExpectedVersion: null,
      conflictCode: null,
      lastError: null,
      status: 'pending' as const,
      updatedAt: new Date().toISOString(),
    })),
  )
}
