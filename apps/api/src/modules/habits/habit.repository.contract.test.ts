import { randomUUID } from 'node:crypto'

import { defineHabitRepositoryContractSuite } from './habit.repository.contract.js'
import { MemoryHabitRepository } from './habit.repository.memory.js'

defineHabitRepositoryContractSuite({
  createHarness() {
    const actorUserId = randomUUID()
    const otherActorUserId = randomUUID()

    return Promise.resolve({
      cleanup: () => Promise.resolve(),
      context: {
        actorUserId,
        auth: null,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: randomUUID(),
        workspaceKind: 'personal' as const,
      },
      otherContext: {
        actorUserId: otherActorUserId,
        auth: null,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: randomUUID(),
        workspaceKind: 'personal' as const,
      },
      repository: new MemoryHabitRepository(),
    })
  },
  name: 'MemoryHabitRepository contract',
})
