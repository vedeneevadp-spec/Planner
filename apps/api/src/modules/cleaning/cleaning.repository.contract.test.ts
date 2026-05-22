import { randomUUID } from 'node:crypto'

import { defineCleaningRepositoryContractSuite } from './cleaning.repository.contract.js'
import { MemoryCleaningRepository } from './cleaning.repository.memory.js'

defineCleaningRepositoryContractSuite({
  createHarness() {
    return Promise.resolve({
      cleanup: () => Promise.resolve(),
      context: {
        actorUserId: randomUUID(),
        auth: null,
        groupRole: null,
        role: 'owner' as const,
        workspaceId: randomUUID(),
        workspaceKind: 'personal' as const,
      },
      repository: new MemoryCleaningRepository(),
    })
  },
  name: 'MemoryCleaningRepository contract',
})
