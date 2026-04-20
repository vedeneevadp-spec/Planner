import { isUuidV7 } from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import { createPlannerApiClient, PlannerApiError } from './planner-api'

const TEST_CONFIG = {
  actorUserId: 'user-1',
  apiBaseUrl: 'http://127.0.0.1:3001',
  workspaceId: 'workspace-1',
}

function parseJsonRequestBody<T>(requestInit: RequestInit | undefined): T {
  const body = requestInit?.body

  if (typeof body !== 'string') {
    throw new TypeError('Expected request body to be a JSON string.')
  }

  return JSON.parse(body) as T
}

describe('plannerApi', () => {
  it('requests task list with workspace header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            completedAt: null,
            createdAt: '2026-04-15T10:00:00.000Z',
            deletedAt: null,
            dueDate: null,
            id: 'task-1',
            note: '',
            plannedDate: '2026-04-15',
            plannedEndTime: null,
            plannedStartTime: null,
            project: '',
            status: 'todo',
            title: 'Inbox',
            updatedAt: '2026-04-15T10:00:00.000Z',
            version: 1,
            workspaceId: 'workspace-1',
          },
        ]),
        {
          status: 200,
        },
      ),
    )
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)

    const tasks = await api.listTasks({ plannedDate: '2026-04-15' })

    expect(tasks).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, requestInit] = fetchMock.mock.calls[0]!
    const requestUrl = url instanceof URL ? url.href : url

    expect(requestUrl).toBe(
      'http://127.0.0.1:3001/api/v1/tasks?plannedDate=2026-04-15',
    )
    expect(new Headers(requestInit?.headers).get('x-workspace-id')).toBe(
      'workspace-1',
    )
    expect(new Headers(requestInit?.headers).get('x-actor-user-id')).toBeNull()
  })

  it('forwards abort signals for query-driven task fetches', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
      }),
    )
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)
    const signal = new AbortController().signal

    await api.listTasks({}, signal)

    const [, requestInit] = fetchMock.mock.calls[0]!

    expect(requestInit?.signal).toBe(signal)
  })

  it('requests task event cursor with workspace header', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          events: [],
          nextEventId: 42,
        }),
        {
          status: 200,
        },
      ),
    )
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)

    const result = await api.listTaskEvents({
      afterEventId: 41,
      limit: 100,
    })

    expect(result.nextEventId).toBe(42)

    const [url, requestInit] = fetchMock.mock.calls[0]!
    const requestUrl = url instanceof URL ? url.href : url

    expect(requestUrl).toBe(
      'http://127.0.0.1:3001/api/v1/task-events?afterEventId=41&limit=100',
    )
    expect(new Headers(requestInit?.headers).get('x-workspace-id')).toBe(
      'workspace-1',
    )
    expect(new Headers(requestInit?.headers).get('x-actor-user-id')).toBeNull()
  })

  it('throws structured API error for failed writes', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'invalid_body',
            message: 'Title is required.',
          },
        }),
        {
          status: 400,
        },
      ),
    )
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)

    await expect(
      api.createTask({
        dueDate: null,
        note: '',
        plannedDate: null,
        plannedEndTime: null,
        plannedStartTime: null,
        project: '',
        title: 'Task title',
      }),
    ).rejects.toThrow(PlannerApiError)

    const [, requestInit] = fetchMock.mock.calls[0]!
    expect(new Headers(requestInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
  })

  it('generates a stable UUIDv7 for task creation requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          completedAt: null,
          createdAt: '2026-04-16T03:00:00.000Z',
          deletedAt: null,
          dueDate: null,
          id: '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b2',
          note: '',
          plannedDate: null,
          plannedEndTime: null,
          plannedStartTime: null,
          project: '',
          status: 'todo',
          title: 'Task title',
          updatedAt: '2026-04-16T03:00:00.000Z',
          version: 1,
          workspaceId: 'workspace-1',
        }),
        { status: 201 },
      ),
    )
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)

    await api.createTask({
      dueDate: null,
      note: '',
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
      project: '',
      title: 'Task title',
    })

    const [, requestInit] = fetchMock.mock.calls[0]!
    const body = parseJsonRequestBody<{ id: string }>(requestInit)

    expect(isUuidV7(body.id)).toBe(true)
  })

  it('sends expectedVersion for versioned task mutations', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            completedAt: '2026-04-16T03:00:00.000Z',
            createdAt: '2026-04-16T02:00:00.000Z',
            deletedAt: null,
            dueDate: null,
            id: 'task-1',
            note: '',
            plannedDate: null,
            plannedEndTime: null,
            plannedStartTime: null,
            project: '',
            status: 'done',
            title: 'Task title',
            updatedAt: '2026-04-16T03:00:00.000Z',
            version: 2,
            workspaceId: 'workspace-1',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)

    await api.setTaskStatus('task-1', {
      expectedVersion: 1,
      status: 'done',
    })
    await api.removeTask('task-1', 2)

    const [, statusRequestInit] = fetchMock.mock.calls[0]!
    const statusBody = parseJsonRequestBody<{
      expectedVersion: number
      status: string
    }>(statusRequestInit)
    const [deleteUrl] = fetchMock.mock.calls[1]!
    const deleteRequestUrl =
      deleteUrl instanceof URL ? deleteUrl.href : deleteUrl

    expect(statusBody).toEqual({
      expectedVersion: 1,
      status: 'done',
    })
    expect(deleteRequestUrl).toBe(
      'http://127.0.0.1:3001/api/v1/tasks/task-1?expectedVersion=2',
    )
  })
})
