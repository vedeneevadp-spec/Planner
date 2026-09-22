import assert from 'node:assert/strict'
import test from 'node:test'

import { userBackupArchiveSchema } from '@planner/contracts/backup'

const userId = '00000000-0000-4000-8000-000000000001'
const workspaceId = '00000000-0000-4000-8000-000000000002'

function createArchive() {
  return {
    assets: [],
    exportedAt: '2026-09-18T00:00:00Z',
    format: 'planner.user-backup',
    scope: {
      userId,
      workspaceId,
      workspaceKind: 'personal',
      workspaceName: 'Test',
    },
    source: { appVersion: '1.1.19' },
    tables: {
      users: [
        {
          id: userId,
          display_name: 'Test',
          calendar_view_mode: 'month',
          energy_mode: 'minimum',
          default_time_zone: 'Asia/Novosibirsk',
        },
      ],
      workspaces: [
        {
          id: workspaceId,
          owner_user_id: userId,
          task_completion_confetti_enabled: false,
        },
      ],
      chaos_inbox_items: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          user_id: userId,
          workspace_id: workspaceId,
          text: 'Молоко',
          source: 'voice',
          kind: 'shopping',
        },
      ],
    },
    version: 1,
  }
}

for (const [table, column] of [
  ['users', 'voice_assistant_enabled'],
  ['workspaces', 'wake_word_training_mode_enabled'],
] as const) {
  void test(`backup accepts and strips legacy boolean ${column} without changing entities`, () => {
    const current = createArchive()
    const legacy = structuredClone(current)
    Object.assign(legacy.tables[table][0]!, { [column]: true })

    assert.deepEqual(
      userBackupArchiveSchema.parse(legacy),
      userBackupArchiveSchema.parse(current),
    )
    assert.equal(
      column in userBackupArchiveSchema.parse(legacy).tables[table]![0]!,
      false,
    )
  })

  for (const value of ['true', 1, null, {}, []]) {
    void test(`backup rejects malformed legacy ${column}: ${JSON.stringify(value)}`, () => {
      const legacy = createArchive()
      Object.assign(legacy.tables[table][0]!, { [column]: value })
      assert.equal(userBackupArchiveSchema.safeParse(legacy).success, false)
    })
  }
}

void test('new backup roundtrip preserves voice-sourced purchases and rejects unknown columns', () => {
  const current = userBackupArchiveSchema.parse(createArchive())
  assert.deepEqual(
    userBackupArchiveSchema.parse(JSON.parse(JSON.stringify(current))),
    current,
  )
  assert.equal(current.tables.chaos_inbox_items![0]!.source, 'voice')
  const malformed = createArchive()
  Object.assign(malformed.tables.users[0]!, { arbitrary_retired_setting: true })
  assert.equal(userBackupArchiveSchema.safeParse(malformed).success, false)
})
