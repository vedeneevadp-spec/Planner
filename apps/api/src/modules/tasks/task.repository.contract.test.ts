import { randomUUID } from 'node:crypto'

import { defineTaskRepositoryContractSuite } from './task.repository.contract.js'
import { MemoryTaskRepository } from './task.repository.memory.js'

defineTaskRepositoryContractSuite({
  createHarness() {
    const actorUserId = randomUUID()
    const personalWorkspace = {
      id: randomUUID(),
      name: 'Contract Personal',
    }
    const personalContext = {
      actorDisplayName: 'Contract User',
      actorUserId,
      auth: null,
      groupRole: null,
      personalWorkspace,
      role: 'owner' as const,
      workspaceId: personalWorkspace.id,
      workspaceKind: 'personal' as const,
      workspaceName: personalWorkspace.name,
    }
    const sharedContext = {
      ...personalContext,
      groupRole: 'group_admin' as const,
      personalWorkspace,
      role: 'owner' as const,
      workspaceId: randomUUID(),
      workspaceKind: 'shared' as const,
      workspaceName: 'Contract Shared',
    }

    return Promise.resolve({
      cleanup: () => Promise.resolve(),
      personalContext,
      personalWorkspace,
      projectId: randomUUID(),
      repository: new MemoryTaskRepository(),
      sharedContext,
      transferPersonalContext: personalContext,
    })
  },
  name: 'MemoryTaskRepository contract',
})
