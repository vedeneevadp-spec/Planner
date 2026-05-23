import { randomUUID } from 'node:crypto'

import { defineEmojiSetRepositoryContractSuite } from './emoji-set.repository.contract.js'
import { MemoryEmojiSetRepository } from './emoji-set.repository.memory.js'

defineEmojiSetRepositoryContractSuite({
  createHarness() {
    const actorUserId = randomUUID()
    const otherActorUserId = randomUUID()

    return Promise.resolve({
      cleanup: () => Promise.resolve(),
      context: {
        actorUserId,
        appRole: 'owner' as const,
        auth: null,
        workspaceId: randomUUID(),
      },
      otherContext: {
        actorUserId: otherActorUserId,
        appRole: 'owner' as const,
        auth: null,
        workspaceId: randomUUID(),
      },
      repository: new MemoryEmojiSetRepository(),
    })
  },
  name: 'MemoryEmojiSetRepository contract',
})
