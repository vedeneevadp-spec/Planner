import assert from 'node:assert/strict'
import test from 'node:test'

import {
  selfCareItemInputSchema,
  selfCareOfflineCommandRequestSchema,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { SelfCareRepository } from './self-care.repository.js'
import { MemorySelfCareRepository } from './self-care.repository.memory.js'
import { SelfCareService } from './self-care.service.js'

void test('SelfCareService rejects offline commands for shared workspaces before repository access', () => {
  let repositoryCalled = false
  const repository = {
    executeOfflineCommand() {
      repositoryCalled = true
      throw new Error('Repository must not be called for a shared workspace.')
    },
  } as unknown as SelfCareRepository
  const service = new SelfCareService(repository)
  const request = selfCareOfflineCommandRequestSchema.parse({
    command: {
      expectedVersion: 1,
      itemId: '0198f4c0-7340-7a20-aadf-09db0ee49122',
      type: 'archive_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49123',
  })

  assert.throws(
    () =>
      service.executeOfflineCommand(
        {
          actorUserId: 'user-1',
          auth: null,
          groupRole: 'member',
          role: 'user',
          workspaceId: 'workspace-1',
          workspaceKind: 'shared',
        },
        request,
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 403 &&
      error.code === 'self_care_private_workspace',
  )
  assert.equal(repositoryCalled, false)
})

void test('SelfCareService normalizes nested offline-command schedules to the client timezone', async () => {
  let captured:
    Parameters<SelfCareRepository['executeOfflineCommand']>[0] | undefined
  const repository = {
    executeOfflineCommand(
      command: Parameters<SelfCareRepository['executeOfflineCommand']>[0],
    ) {
      captured = command
      return Promise.resolve({} as never)
    },
  } as unknown as SelfCareRepository
  const readCaptured = () => captured
  const service = new SelfCareService(repository)
  const context = {
    actorUserId: 'user-1',
    auth: null,
    clientTimeZone: 'Europe/Samara',
    groupRole: null,
    role: 'owner' as const,
    workspaceId: 'workspace-1',
    workspaceKind: 'personal' as const,
  }
  const createRequest = selfCareOfflineCommandRequestSchema.parse({
    command: {
      initialSchedule: {
        input: {
          scheduledFor: '2026-08-06',
          scheduledTime: '10:00',
        },
        occurrenceId: '0198f4c0-7340-7a20-aadf-09db0ee49132',
      },
      input: {
        category: 'relax',
        id: '0198f4c0-7340-7a20-aadf-09db0ee49131',
        scheduleRule: {
          preferredTime: '09:00',
          repeatKind: 'daily',
        },
        title: 'Пауза',
        type: 'rest_action',
      },
      type: 'create_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49130',
  })

  await service.executeOfflineCommand(context, createRequest)

  const capturedCreate = readCaptured()
  assert.deepEqual(capturedCreate?.request, createRequest)
  assert.equal(capturedCreate?.dispatchCommand?.type, 'create_item')
  if (capturedCreate?.dispatchCommand?.type !== 'create_item') return
  assert.equal(
    capturedCreate.dispatchCommand.input.scheduleRule?.timezone,
    'Europe/Samara',
  )
  assert.equal(
    capturedCreate.dispatchCommand.initialSchedule?.input.timezone,
    'Europe/Samara',
  )

  const updateRequest = selfCareOfflineCommandRequestSchema.parse({
    command: {
      expectedVersion: 1,
      input: {
        scheduleRule: {
          preferredTime: '11:00',
          repeatKind: 'daily',
        },
      },
      itemId: '0198f4c0-7340-7a20-aadf-09db0ee49131',
      scheduleChange: {
        actedAt: '2026-08-06T09:00:00.000Z',
        completionId: '0198f4c0-7340-7a20-aadf-09db0ee49134',
        expectedVersion: 1,
        input: { newDate: '2026-08-07' },
        occurrenceId: '0198f4c0-7340-7a20-aadf-09db0ee49132',
        replacementInput: {
          scheduledFor: '2026-08-07',
          scheduledTime: '11:00',
        },
        replacementOccurrenceId: '0198f4c0-7340-7a20-aadf-09db0ee49135',
        type: 'reschedule',
      },
      type: 'update_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49133',
  })

  await service.executeOfflineCommand(context, updateRequest)

  const capturedUpdate = readCaptured()
  assert.deepEqual(capturedUpdate?.request, updateRequest)
  assert.equal(capturedUpdate?.dispatchCommand?.type, 'update_item')
  if (capturedUpdate?.dispatchCommand?.type !== 'update_item') return
  assert.equal(
    capturedUpdate.dispatchCommand.input.scheduleRule?.timezone,
    'Europe/Samara',
  )
  assert.equal(
    capturedUpdate.dispatchCommand.scheduleChange?.type === 'reschedule'
      ? capturedUpdate.dispatchCommand.scheduleChange.replacementInput.timezone
      : null,
    'Europe/Samara',
  )
})

void test('SelfCareService replays the same offline body after the client timezone changes', async () => {
  const service = new SelfCareService(new MemorySelfCareRepository())
  const request = selfCareOfflineCommandRequestSchema.parse({
    command: {
      initialSchedule: {
        input: {
          scheduledFor: '2026-08-06',
          scheduledTime: '09:00',
        },
        occurrenceId: '0198f4c0-7340-7a20-aadf-09db0ee49142',
      },
      input: {
        category: 'relax',
        id: '0198f4c0-7340-7a20-aadf-09db0ee49141',
        title: 'Пауза',
        type: 'rest_action',
      },
      type: 'create_item',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49140',
  })
  const context = {
    actorUserId: 'user-1',
    auth: null,
    clientTimeZone: 'Europe/Samara',
    groupRole: null,
    role: 'owner' as const,
    workspaceId: 'workspace-1',
    workspaceKind: 'personal' as const,
  }

  const first = await service.executeOfflineCommand(context, request)
  const replay = await service.executeOfflineCommand(
    { ...context, clientTimeZone: 'Europe/London' },
    request,
  )

  assert.equal(first.replayed, false)
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.result, first.result)
  assert.equal(
    first.result.kind === 'item' ? first.result.occurrence?.dueAt : null,
    '2026-08-06T05:00:00.000Z',
  )
})

void test('SelfCareService preserves the action timezone for delayed completion and replay', async () => {
  const service = new SelfCareService(new MemorySelfCareRepository())
  const context = {
    actorUserId: 'user-1',
    auth: null,
    clientTimeZone: 'Europe/London',
    groupRole: null,
    role: 'owner' as const,
    workspaceId: 'workspace-1',
    workspaceKind: 'personal' as const,
  }
  const item = await service.createItem(
    context,
    selfCareItemInputSchema.parse({
      category: 'relax',
      title: 'Поздняя пауза',
      type: 'rest_action',
    }),
  )
  const request = selfCareOfflineCommandRequestSchema.parse({
    clientTimeZone: 'Europe/Samara',
    command: {
      completionId: '0198f4c0-7340-7a20-aadf-09db0ee49151',
      expectedVersion: item.version,
      input: {
        completedAt: '2020-08-06T21:30:00.000Z',
        status: 'done',
      },
      itemId: item.id,
      type: 'complete_item_now',
    },
    operationId: '0198f4c0-7340-7a20-aadf-09db0ee49150',
  })

  const first = await service.executeOfflineCommand(context, request)
  const replay = await service.executeOfflineCommand(
    { ...context, clientTimeZone: 'America/New_York' },
    request,
  )

  assert.equal(first.result.kind, 'completion')
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.result, first.result)
  if (first.result.kind !== 'completion' || !first.result.item) return
  assert.equal(first.result.completion.scheduledFor, '2020-08-07')
  assert.notEqual(
    first.result.completion.createdAt,
    first.result.completion.completedAt,
  )
  assert.equal(
    first.result.completion.updatedAt,
    first.result.completion.createdAt,
  )

  const duplicate = await service.executeOfflineCommand(
    { ...context, clientTimeZone: 'America/New_York' },
    selfCareOfflineCommandRequestSchema.parse({
      clientTimeZone: 'Europe/Samara',
      command: {
        completionId: '0198f4c0-7340-7a20-aadf-09db0ee49153',
        expectedVersion: first.result.item.version,
        input: {
          completedAt: '2020-08-06T22:00:00.000Z',
          status: 'done',
        },
        itemId: item.id,
        type: 'complete_item_now',
      },
      operationId: '0198f4c0-7340-7a20-aadf-09db0ee49152',
    }),
  )

  assert.equal(duplicate.result.kind, 'completion')
  if (duplicate.result.kind === 'completion') {
    assert.equal(duplicate.result.completion.id, first.result.completion.id)
    assert.equal(duplicate.result.completion.scheduledFor, '2020-08-07')
  }

  await assert.rejects(
    service.executeOfflineCommand(
      context,
      selfCareOfflineCommandRequestSchema.parse({
        ...request,
        clientTimeZone: 'Europe/London',
      }),
    ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.statusCode === 409 &&
      error.code === 'self_care_operation_id_reused',
  )

  assert.equal(
    selfCareOfflineCommandRequestSchema.safeParse({
      ...request,
      clientTimeZone: 'Mars/Olympus',
    }).success,
    false,
  )
})
