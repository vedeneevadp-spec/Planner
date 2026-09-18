import assert from 'node:assert/strict'
import test from 'node:test'

import {
  userPreferencesSchema,
  userPreferencesUpdateInputSchema,
  workspaceSettingsSchema,
} from '@planner/contracts'

import { buildApiApp } from '../../bootstrap/build-app.js'
import { createApiConfig } from '../../bootstrap/config.js'
import { MemoryTaskRepository, TaskService } from '../tasks/index.js'
import {
  legacyUserPreferencesUpdateInputSchema,
  legacyWorkspaceSettingsUpdateInputSchema,
  withLegacySessionPreferences,
} from './session.legacy-preferences.js'
import { MemorySessionRepository } from './session.repository.memory.js'
import { SessionService } from './session.service.js'

void test('legacy wire settings stay disabled while domain settings omit them', async () => {
  const repository = new MemorySessionRepository()
  const snapshot = await repository.resolve({
    actorUserId: undefined,
    auth: null,
    workspaceId: undefined,
  })
  const wire = withLegacySessionPreferences(snapshot)

  assert.equal(wire.userPreferences.voiceAssistantEnabled, false)
  assert.equal(wire.workspaceSettings.wakeWordTrainingModeEnabled, false)
  assert.equal('voiceAssistantEnabled' in snapshot.userPreferences, false)
  assert.equal(
    'wakeWordTrainingModeEnabled' in snapshot.workspaceSettings,
    false,
  )
  assert.deepEqual(
    userPreferencesSchema.parse(wire.userPreferences),
    snapshot.userPreferences,
  )
  assert.deepEqual(
    workspaceSettingsSchema.parse(wire.workspaceSettings),
    snapshot.workspaceSettings,
  )
})

void test('legacy user setting is validated and discarded without dropping ordinary preferences', () => {
  const ordinary = {
    calendarViewMode: 'month',
    defaultTimeZone: 'Asia/Novosibirsk',
    energyMode: 'minimum',
    sharedTaskAssignedNotificationsEnabled: false,
    timeZoneMode: 'manual',
  }

  assert.deepEqual(
    legacyUserPreferencesUpdateInputSchema.parse({
      ...ordinary,
      voiceAssistantEnabled: true,
    }),
    ordinary,
  )
  assert.deepEqual(
    legacyUserPreferencesUpdateInputSchema.parse({
      voiceAssistantEnabled: true,
    }),
    {},
  )
  assert.deepEqual(
    legacyUserPreferencesUpdateInputSchema.parse({
      voiceAssistantEnabled: false,
    }),
    {},
  )
  assert.equal(
    legacyUserPreferencesUpdateInputSchema.safeParse({
      voiceAssistantEnabled: 'true',
    }).success,
    false,
  )
  assert.equal(
    legacyUserPreferencesUpdateInputSchema.safeParse({
      unknownPreference: true,
    }).success,
    false,
  )
  assert.equal(
    legacyUserPreferencesUpdateInputSchema.safeParse({}).success,
    false,
  )
  assert.equal(
    userPreferencesUpdateInputSchema.safeParse({ voiceAssistantEnabled: true })
      .success,
    false,
  )
})

void test('legacy workspace setting is validated and discarded while confetti and timezone remain', () => {
  const ordinary = {
    defaultTimeZone: 'Asia/Novosibirsk',
    taskCompletionConfettiEnabled: false,
  }

  assert.deepEqual(
    legacyWorkspaceSettingsUpdateInputSchema.parse({
      ...ordinary,
      wakeWordTrainingModeEnabled: true,
    }),
    ordinary,
  )
  assert.equal(
    legacyWorkspaceSettingsUpdateInputSchema.safeParse({
      ...ordinary,
      wakeWordTrainingModeEnabled: 'true',
    }).success,
    false,
  )
})

void test('session routes disable legacy clients and ignore a voice-only patch without mutation', async (context) => {
  const repository = new MemorySessionRepository()
  const updates = context.mock.method(repository, 'updateUserPreferences')
  const app = buildApiApp({
    config: createApiConfig({
      NODE_ENV: 'test',
      API_AUTH_MODE: 'disabled',
      API_STORAGE_DRIVER: 'memory',
    }),
    database: null,
    sessionService: new SessionService(repository),
    taskService: new TaskService(new MemoryTaskRepository()),
  })
  const headers = {
    'x-actor-user-id': '11111111-1111-4111-8111-111111111111',
    'x-workspace-id': '22222222-2222-4222-8222-222222222222',
  }
  try {
    const session = await app.inject({ url: '/api/v1/session', headers })
    assert.equal(session.statusCode, 200)
    const wire = session.json<{
      userPreferences: { voiceAssistantEnabled: boolean }
      workspaceSettings: { wakeWordTrainingModeEnabled: boolean }
    }>()
    assert.equal(wire.userPreferences.voiceAssistantEnabled, false)
    assert.equal(wire.workspaceSettings.wakeWordTrainingModeEnabled, false)
    const noOp = await app.inject({
      url: '/api/v1/preferences',
      method: 'PATCH',
      headers,
      payload: { voiceAssistantEnabled: true },
    })
    assert.equal(noOp.statusCode, 200)
    assert.equal(
      noOp.json<{ voiceAssistantEnabled: boolean }>().voiceAssistantEnabled,
      false,
    )
    assert.equal(updates.mock.callCount(), 0)
    const updated = await app.inject({
      url: '/api/v1/preferences',
      method: 'PATCH',
      headers,
      payload: {
        calendarViewMode: 'month',
        energyMode: 'minimum',
        defaultTimeZone: 'Asia/Novosibirsk',
        voiceAssistantEnabled: true,
      },
    })
    assert.equal(updated.statusCode, 200)
    assert.equal(
      updated.json<{ voiceAssistantEnabled: boolean }>().voiceAssistantEnabled,
      false,
    )
    assert.equal(
      userPreferencesSchema.parse(updated.json()).calendarViewMode,
      'month',
    )
    assert.equal(updates.mock.callCount(), 1)
    assert.equal(
      'voiceAssistantEnabled' in updates.mock.calls[0]!.arguments[2],
      false,
    )
    const workspace = await app.inject({
      url: '/api/v1/admin/workspace-settings',
      method: 'PATCH',
      headers,
      payload: {
        taskCompletionConfettiEnabled: false,
        defaultTimeZone: 'UTC',
        wakeWordTrainingModeEnabled: true,
      },
    })
    assert.equal(workspace.statusCode, 200)
    assert.equal(
      workspace.json<{ wakeWordTrainingModeEnabled: boolean }>()
        .wakeWordTrainingModeEnabled,
      false,
    )
    assert.deepEqual(workspaceSettingsSchema.parse(workspace.json()), {
      taskCompletionConfettiEnabled: false,
      defaultTimeZone: 'UTC',
    })
    for (const payload of [
      { voiceAssistantEnabled: 'true' },
      { unrelated: true },
      {},
    ]) {
      const invalid = await app.inject({
        url: '/api/v1/preferences',
        method: 'PATCH',
        headers,
        payload,
      })
      assert.equal(invalid.statusCode, 400)
    }
    assert.equal(updates.mock.callCount(), 1)
  } finally {
    await app.close()
  }
})
