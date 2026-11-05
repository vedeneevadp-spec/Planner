import { randomUUID } from 'node:crypto'
import { test } from 'node:test'

import { MemorySelfCareRepository } from './self-care.repository.memory.js'
import {
  assertSelfCareAfterCompletionUsesLocalDates,
  assertSelfCareFlexibleProgressUsesLocalDates,
  assertSelfCareHistoryUsesLocalDates,
  HISTORY_TIMEZONE_CASES,
} from './self-care-history-timezone.contract.js'

for (const scenario of HISTORY_TIMEZONE_CASES) {
  void test(`memory self-care history and analytics use local dates in ${scenario.timezone}`, async () => {
    await assertSelfCareHistoryUsesLocalDates(
      new MemorySelfCareRepository(),
      {
        actorUserId: randomUUID(),
        auth: null,
        role: 'owner',
        workspaceId: randomUUID(),
        workspaceKind: 'personal',
      },
      scenario,
    )
  })
}

void test('memory flexible progress and after-completion recurrence use local completion dates', async () => {
  const repository = new MemorySelfCareRepository()
  const context = {
    actorUserId: randomUUID(),
    auth: null,
    role: 'owner' as const,
    workspaceId: randomUUID(),
    workspaceKind: 'personal' as const,
  }
  await assertSelfCareFlexibleProgressUsesLocalDates(repository, context)
  await assertSelfCareAfterCompletionUsesLocalDates(repository, context)
})
