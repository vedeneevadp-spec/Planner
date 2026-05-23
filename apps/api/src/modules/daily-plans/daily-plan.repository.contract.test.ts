import { randomUUID } from 'node:crypto'

import { defineDailyPlanRepositoryContractSuite } from './daily-plan.repository.contract.js'
import { MemoryDailyPlanRepository } from './daily-plan.repository.memory.js'

defineDailyPlanRepositoryContractSuite({
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
      repository: new MemoryDailyPlanRepository(),
    })
  },
  name: 'MemoryDailyPlanRepository contract',
})
