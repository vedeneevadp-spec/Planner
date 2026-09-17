import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'

import { selfCareItemUpdateInputSchema } from '@planner/contracts'

import { MemorySelfCareRepository } from './self-care.repository.memory.js'
import {
  assertAtomicRuleEditPreservesSingleSchedule,
  assertCoursePauseReconcilesGeneratedSlots,
  assertFutureScheduleReconciles,
  assertRitualHistorySurvivesEditing,
} from './self-care.repository.regression-contract.js'

void test('self-care item patches preserve omitted fields and reject empty updates', () => {
  assert.deepEqual(selfCareItemUpdateInputSchema.parse({ title: 'Renamed' }), {
    title: 'Renamed',
  })
  assert.deepEqual(selfCareItemUpdateInputSchema.parse({ steps: [] }), {
    steps: [],
  })
  assert.equal(
    selfCareItemUpdateInputSchema.safeParse({ expectedVersion: 1 }).success,
    false,
  )
})

for (const [name, verify] of [
  [
    'course pause reconciles automatic slots and preserves manual schedule',
    assertCoursePauseReconcilesGeneratedSlots,
  ],
  [
    'atomic rule and single schedule edit preserves ritual drafts',
    assertAtomicRuleEditPreservesSingleSchedule,
  ],
  [
    'ritual history survives edits and offline replay',
    assertRitualHistorySurvivesEditing,
  ],
  [
    'future rules preserve completed, skipped, and manually moved occurrences',
    assertFutureScheduleReconciles,
  ],
] as const) {
  void test(`MemorySelfCareRepository ${name}`, () =>
    verify(new MemorySelfCareRepository(), {
      actorUserId: randomUUID(),
      auth: null,
      clientTimeZone: 'UTC',
      role: 'owner',
      workspaceId: randomUUID(),
      workspaceKind: 'personal',
    }))
}
