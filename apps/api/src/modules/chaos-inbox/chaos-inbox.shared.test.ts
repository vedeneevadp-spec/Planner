import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createStoredChaosInboxItemRecord } from './chaos-inbox.shared.js'

void describe('createStoredChaosInboxItemRecord', () => {
  void it('preserves shopping kind for shopping list items', () => {
    const item = createStoredChaosInboxItemRecord(
      {
        id: '0196941c-62c1-7d84-9fdb-f5fd1d7540f1',
        kind: 'shopping',
        source: 'manual',
        text: 'Milk',
      },
      {
        now: '2026-05-04T10:00:00.000Z',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      },
    )

    assert.equal(item.kind, 'shopping')
    assert.equal(item.status, 'new')
    assert.equal(item.text, 'Milk')
  })
})
