import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compactArrayForAi, compactForAi } from './ai-context.compact.js'

void describe('compactForAi', () => {
  void it('removes technical and auth fields while preserving source', () => {
    const compacted = compactForAi({
      accessToken: 'plain-token',
      id: 'internal-id',
      items: [
        {
          note: 'x'.repeat(700),
          passwordHash: 'secret',
          source: 'tasks',
          status: 'todo',
          title: 'Important task',
          userId: 'user-1',
        },
      ],
      sessionId: 'session',
    })

    assert.deepEqual(Object.keys(compacted).sort(), ['items'])
    assert.equal(compacted.items[0]?.source, 'tasks')
    assert.equal('passwordHash' in compacted.items[0], false)
    assert.equal('userId' in compacted.items[0], false)
    assert.equal(compacted.items[0]?.note.length, 500)
  })

  void it('limits arrays and adds array counts through compactArrayForAi', () => {
    const items = Array.from({ length: 40 }, (_, index) => ({
      source: 'tasks' as const,
      status: index === 39 ? 'overdue' : 'todo',
      title: `Task ${index}`,
    }))
    const compacted = compactArrayForAi(items, {
      maxArrayItems: 30,
      mode: 'search',
    })

    assert.equal(compacted.totalCount, 40)
    assert.equal(compacted.returnedCount, 30)
    assert.equal(compacted.items.length, 30)
    assert.equal(compacted.items[0]?.status, 'overdue')
  })
})
