import assert from 'node:assert/strict'
import test from 'node:test'

import {
  newTaskInputSchema,
  plannerSearchQuerySchema,
  selfCareItemInputSchema,
} from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import { createApiKernel, destroyApiKernel } from '../../main.js'
import {
  MemorySelfCareRepository,
  SelfCareService,
} from '../self-care/index.js'
import { MemoryTaskRepository, TaskService } from '../tasks/index.js'
import { searchPlanner } from './planner-search.service.js'

const context = {
  actorDisplayName: 'Search Test',
  actorUserId: 'user-1',
  auth: null,
  groupRole: null,
  role: 'owner' as const,
  workspaceId: 'workspace-1',
  workspaceKind: 'personal' as const,
}

void test('returns available matches and names failed sources instead of reporting an empty search', async () => {
  const taskService = new TaskService(new MemoryTaskRepository())
  await taskService.createTask(
    context,
    newTaskInputSchema.parse({
      title: 'Договор',
      note: 'Номер 123',
      project: '',
    }),
  )
  const result = await searchPlanner(
    { taskService },
    context,
    plannerSearchQuerySchema.parse({ query: 'номер' }),
  )
  assert.equal(result.items[0]?.title, 'Договор')
  assert.deepEqual(result.unavailableSources, ['shopping', 'cleaning', 'care'])
})

void test('does not mask authentication errors as unavailable results', async () => {
  class DeniedTasks extends TaskService {
    override listTaskPage(): never {
      throw new HttpError(403, 'forbidden', 'Denied')
    }
  }
  await assert.rejects(
    searchPlanner(
      { taskService: new DeniedTasks(new MemoryTaskRepository()) },
      context,
      plannerSearchQuerySchema.parse({ query: 'x' }),
    ),
    (error: unknown) => error instanceof HttpError && error.statusCode === 403,
  )
})

void test('includes archived care descriptions only when requested, and never queries care in shared spaces', async () => {
  const selfCareService = new SelfCareService(new MemorySelfCareRepository())
  const taskService = new TaskService(new MemoryTaskRepository())
  const item = await selfCareService.createItem(
    context,
    selfCareItemInputSchema.parse({
      category: 'relax',
      title: 'Массаж',
      description: 'Контакт специалиста',
      type: 'procedure',
      scheduleRule: { repeatKind: 'none', startDate: '2026-11-03' },
    }),
  )
  await selfCareService.archiveItem(context, item.id)
  const input = plannerSearchQuerySchema.parse({
    query: 'контакт',
    source: 'care',
  })
  assert.equal(
    (await searchPlanner({ taskService, selfCareService }, context, input))
      .items[0]?.status,
    'archived',
  )
  assert.equal(
    (
      await searchPlanner({ taskService, selfCareService }, context, {
        ...input,
        includeCompleted: false,
      })
    ).items.length,
    0,
  )
  assert.deepEqual(
    await searchPlanner(
      { taskService, selfCareService },
      { ...context, workspaceKind: 'shared' },
      input,
    ),
    { items: [], page: 1, hasMore: false, unavailableSources: [] },
  )
})

void test('serves a validated search route, rejects invalid queries and isolates workspaces', async () => {
  const kernel = createApiKernel({
    API_AUTH_MODE: 'disabled',
    API_STORAGE_DRIVER: 'memory',
    NODE_ENV: 'test',
  })
  try {
    const session = (
      await kernel.app.inject({ method: 'GET', url: '/api/v1/session' })
    ).json<{ workspace: { id: string }; actor: { id: string } }>()
    const headers = {
      'x-workspace-id': session.workspace.id,
      'x-actor-user-id': session.actor.id,
    }
    const created = await kernel.app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers,
      payload: {
        title: 'Контракт поиска',
        note: 'Нужная заметка',
        project: '',
      },
    })
    assert.equal(created.statusCode, 201, created.body)
    const response = await kernel.app.inject({
      method: 'GET',
      url:
        '/api/v1/planner-search?query=' +
        encodeURIComponent('нужная') +
        '&source=tasks&includeCompleted=false',
      headers,
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(
      response.json<{ items: Array<{ title: string }> }>().items[0]?.title,
      'Контракт поиска',
    )
    for (const query of [
      'query=',
      'query=x&includeCompleted=bad',
      'query=x&page=0',
    ]) {
      assert.equal(
        (
          await kernel.app.inject({
            method: 'GET',
            url: '/api/v1/planner-search?' + query,
            headers,
          })
        ).statusCode,
        400,
      )
    }
    const foreign = await kernel.app.inject({
      method: 'GET',
      url: '/api/v1/planner-search?query=x',
      headers: {
        ...headers,
        'x-workspace-id': '33333333-3333-4333-8333-333333333333',
      },
    })
    assert.equal(foreign.statusCode, 200)
    assert.deepEqual(foreign.json<{ items: unknown[] }>().items, [])
  } finally {
    await destroyApiKernel(kernel)
  }
})

void test('protects search with the same JWT boundary as other planner routes', async () => {
  const kernel = createApiKernel({
    API_AUTH_MODE: 'jwt',
    API_STORAGE_DRIVER: 'memory',
    NODE_ENV: 'test',
    AUTH_JWT_SECRET: 'search-test-secret-with-at-least-32-characters',
  })
  try {
    const response = await kernel.app.inject({
      method: 'GET',
      url: '/api/v1/planner-search?query=test',
    })
    assert.equal(response.statusCode, 401, response.body)
  } finally {
    await destroyApiKernel(kernel)
  }
})
