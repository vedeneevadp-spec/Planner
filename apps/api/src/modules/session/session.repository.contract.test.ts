import { randomUUID } from 'node:crypto'

import {
  createAuthenticatedSessionContext,
  defineSessionRepositoryContractSuite,
} from './session.repository.contract.js'
import { MemorySessionRepository } from './session.repository.memory.js'

defineSessionRepositoryContractSuite({
  async createHarness() {
    const repository = new MemorySessionRepository()
    const ownerSession = await repository.resolve({
      actorUserId: undefined,
      auth: null,
      workspaceId: undefined,
    })
    const memberUserId = randomUUID()
    const memberSession = await repository.resolve(
      createAuthenticatedSessionContext({
        email: `contract-member-${memberUserId}@example.test`,
        userId: memberUserId,
      }),
    )

    return {
      cleanup: () => Promise.resolve(),
      createAuthenticatedSession: (input) =>
        repository.resolve(createAuthenticatedSessionContext(input)),
      immutableOwnerUserId: ownerSession.actorUserId,
      memberSession,
      ownerSession,
      repository,
      resolveActorSession: (input) =>
        repository.resolve({
          actorUserId: input.userId,
          auth: null,
          workspaceId: input.workspaceId,
        }),
    }
  },
  name: 'MemorySessionRepository contract',
})
