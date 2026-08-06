import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createSelfCareReadGenerationKey,
  SelfCareReadGenerationCoordinator,
} from './self-care-read-generation-coordinator.js'

void test('self-care read-generation keys share scopes but isolate time zones', () => {
  const base = {
    actorUserId: 'user-1',
    workspaceId: 'workspace-1',
  }

  assert.equal(
    createSelfCareReadGenerationKey(base),
    createSelfCareReadGenerationKey({ ...base, clientTimeZone: 'UTC' }),
  )
  assert.notEqual(
    createSelfCareReadGenerationKey(base),
    createSelfCareReadGenerationKey({
      ...base,
      clientTimeZone: 'Europe/Samara',
    }),
  )
})

void test('SelfCareReadGenerationCoordinator merges concurrent read ranges for the same user', async () => {
  const coordinator = new SelfCareReadGenerationCoordinator<string>(0)
  const calls: Array<{ context: string; from: string; to: string }> = []
  const generate = (context: string, from: string, to: string) => {
    calls.push({ context, from, to })
    return Promise.resolve()
  }

  await Promise.all([
    coordinator.schedule(
      'workspace-1:user-1',
      'first-context',
      '2026-08-06',
      '2026-08-06',
      generate,
    ),
    coordinator.schedule(
      'workspace-1:user-1',
      'second-context',
      '2026-08-06',
      '2026-09-20',
      generate,
    ),
  ])

  assert.deepEqual(calls, [
    {
      context: 'first-context',
      from: '2026-08-06',
      to: '2026-09-20',
    },
  ])
})

void test('SelfCareReadGenerationCoordinator keeps users isolated', async () => {
  const coordinator = new SelfCareReadGenerationCoordinator<string>(0)
  const calls: string[] = []
  const generate = (context: string) => {
    calls.push(context)
    return Promise.resolve()
  }

  await Promise.all([
    coordinator.schedule(
      'workspace-1:user-1',
      'user-1',
      '2026-08-06',
      '2026-08-06',
      generate,
    ),
    coordinator.schedule(
      'workspace-1:user-2',
      'user-2',
      '2026-08-06',
      '2026-09-20',
      generate,
    ),
  ])

  assert.deepEqual(calls.sort(), ['user-1', 'user-2'])
})

void test('SelfCareReadGenerationCoordinator shares a covering in-flight generation', async () => {
  let finishGeneration!: () => void
  let markGenerationStarted!: () => void
  const generationFinished = new Promise<void>((resolve) => {
    finishGeneration = resolve
  })
  const generationStarted = new Promise<void>((resolve) => {
    markGenerationStarted = resolve
  })
  const coordinator = new SelfCareReadGenerationCoordinator<string>(0)
  let callCount = 0
  const generate = () => {
    callCount += 1
    markGenerationStarted()
    return generationFinished
  }
  const plan = coordinator.schedule(
    'workspace-1:user-1',
    'context',
    '2026-08-06',
    '2026-09-20',
    generate,
  )

  await generationStarted
  const dashboard = coordinator.schedule(
    'workspace-1:user-1',
    'context',
    '2026-08-06',
    '2026-08-06',
    generate,
  )
  finishGeneration()
  await Promise.all([plan, dashboard])

  assert.equal(callCount, 1)
})

void test('SelfCareReadGenerationCoordinator clears a rejected batch before retry', async () => {
  const coordinator = new SelfCareReadGenerationCoordinator<string>(0)
  let callCount = 0
  const generate = () => {
    callCount += 1
    return callCount === 1
      ? Promise.reject(new Error('generation failed'))
      : Promise.resolve()
  }

  await assert.rejects(
    coordinator.schedule(
      'workspace-1:user-1',
      'context',
      '2026-08-06',
      '2026-08-06',
      generate,
    ),
  )
  await coordinator.schedule(
    'workspace-1:user-1',
    'context',
    '2026-08-06',
    '2026-08-06',
    generate,
  )

  assert.equal(callCount, 2)
})
