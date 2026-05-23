import { randomUUID } from 'node:crypto'

import { defineChaosInboxRepositoryContractSuite } from './chaos-inbox.repository.contract.js'
import { MemoryChaosInboxRepository } from './chaos-inbox.repository.memory.js'

defineChaosInboxRepositoryContractSuite({
  createHarness() {
    const actorUserId = randomUUID()
    const otherActorUserId = randomUUID()

    return Promise.resolve({
      cleanup: () => Promise.resolve(),
      context: {
        actorDisplayName: 'Contract User',
        actorUserId,
        auth: null,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: randomUUID(),
        workspaceKind: 'personal' as const,
      },
      convertedTaskId: randomUUID(),
      otherContext: {
        actorDisplayName: 'Contract Other User',
        actorUserId: otherActorUserId,
        auth: null,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: randomUUID(),
        workspaceKind: 'personal' as const,
      },
      repository: new MemoryChaosInboxRepository(),
    })
  },
  name: 'MemoryChaosInboxRepository contract',
})
