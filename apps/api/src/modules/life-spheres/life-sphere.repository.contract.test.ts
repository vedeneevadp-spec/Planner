import { randomUUID } from 'node:crypto'

import { defineLifeSphereRepositoryContractSuite } from './life-sphere.repository.contract.js'
import { MemoryLifeSphereRepository } from './life-sphere.repository.memory.js'

defineLifeSphereRepositoryContractSuite({
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
      repository: new MemoryLifeSphereRepository(),
    })
  },
  name: 'MemoryLifeSphereRepository contract',
})
