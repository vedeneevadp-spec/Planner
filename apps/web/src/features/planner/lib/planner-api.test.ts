import { isUuidV7 } from '@planner/contracts'
import { describe, expect, it, vi } from 'vitest'

import {
  createPlannerApiClient,
  isUnauthorizedPlannerApiError,
  PlannerApiError,
} from './planner-api'

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
            projectId: null,
            resource: null,
            sphereId: null,
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

  it('creates and updates spheres through the planner API', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            color: '#2f6f62',
            createdAt: '2026-04-16T02:00:00.000Z',
            deletedAt: null,
            description: '',
            icon: 'folder',
            id: '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b2',
            isActive: true,
            isDefault: false,
            name: 'Planner',
            sortOrder: 0,
            updatedAt: '2026-04-16T02:00:00.000Z',
            userId: 'user-1',
            version: 1,
            workspaceId: 'workspace-1',
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            color: '#3f5f9f',
            createdAt: '2026-04-16T02:00:00.000Z',
            deletedAt: null,
            description: 'Updated',
            icon: 'target',
            id: 'project-1',
            isActive: true,
            isDefault: false,
            name: 'Planner App',
            sortOrder: 0,
            updatedAt: '2026-04-16T03:00:00.000Z',
            userId: 'user-1',
            version: 2,
            workspaceId: 'workspace-1',
          }),
          { status: 200 },
        ),
      )
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)

    await api.createProject({
      color: '#2f6f62',
      description: '',
      icon: 'folder',
      title: 'Planner',
    })
    await api.updateProject('project-1', {
      color: '#3f5f9f',
      description: 'Updated',
      expectedVersion: 1,
      icon: 'target',
      title: 'Planner App',
    })

    const [createUrl, createRequestInit] = fetchMock.mock.calls[0]!
    const [updateUrl, updateRequestInit] = fetchMock.mock.calls[1]!
    const createRequestUrl =
      createUrl instanceof URL ? createUrl.href : createUrl
    const updateRequestUrl =
      updateUrl instanceof URL ? updateUrl.href : updateUrl
    const createBody = parseJsonRequestBody<{ id: string; name: string }>(
      createRequestInit,
    )

    expect(createRequestUrl).toBe(
      'http://127.0.0.1:3001/api/v1/life-spheres',
    )
    expect(updateRequestUrl).toBe(
      'http://127.0.0.1:3001/api/v1/life-spheres/project-1',
    )
    expect(isUuidV7(createBody.id)).toBe(true)
    expect(createBody.name).toBe('Planner')
    expect(new Headers(createRequestInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
    expect(new Headers(updateRequestInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
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
        assigneeUserId: null,
        dueDate: null,
        note: '',
        plannedDate: null,
        plannedEndTime: null,
        plannedStartTime: null,
        project: '',
        projectId: null,
        resource: null,
        sphereId: null,
        title: 'Task title',
      }),
    ).rejects.toThrow(PlannerApiError)

    const [, requestInit] = fetchMock.mock.calls[0]!
    expect(new Headers(requestInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
  })

  it('detects unauthorized planner API errors', () => {
    const error = new PlannerApiError('Unauthorized.', {
      code: 'authentication_required',
      status: 401,
    })

    expect(isUnauthorizedPlannerApiError(error)).toBe(true)
    expect(isUnauthorizedPlannerApiError(new Error('Network failed.'))).toBe(
      false,
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
          assigneeDisplayName: null,
          assigneeUserId: null,
          id: '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b2',
          note: '',
          plannedDate: null,
          plannedEndTime: null,
          plannedStartTime: null,
          project: '',
          projectId: null,
          resource: null,
          sphereId: null,
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
      assigneeUserId: null,
      dueDate: null,
      note: '',
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
      project: '',
      projectId: null,
      resource: null,
      sphereId: null,
      title: 'Task title',
    })

    const [, requestInit] = fetchMock.mock.calls[0]!
    const body = parseJsonRequestBody<{ id: string }>(requestInit)

    expect(isUuidV7(body.id)).toBe(true)
  })

  it('lists, creates and removes task templates through the planner API', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              createdAt: '2026-04-16T03:00:00.000Z',
              deletedAt: null,
              dueDate: null,
              id: 'template-1',
              note: '',
              plannedDate: null,
              plannedEndTime: null,
              plannedStartTime: null,
              project: '',
              projectId: null,
              title: 'Template title',
              updatedAt: '2026-04-16T03:00:00.000Z',
              version: 1,
              workspaceId: 'workspace-1',
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            createdAt: '2026-04-16T03:00:00.000Z',
            deletedAt: null,
            dueDate: null,
            id: '01963dd0-7f58-7de6-9c7f-9a5f7bdfd8b2',
            note: '',
            plannedDate: null,
            plannedEndTime: null,
            plannedStartTime: null,
            project: '',
            projectId: null,
            title: 'Template title',
            updatedAt: '2026-04-16T03:00:00.000Z',
            version: 1,
            workspaceId: 'workspace-1',
          }),
          { status: 201 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)

    await api.listTaskTemplates()
    await api.createTaskTemplate({
      dueDate: null,
      note: '',
      plannedDate: null,
      plannedEndTime: null,
      plannedStartTime: null,
      project: '',
      projectId: null,
      title: 'Template title',
    })
    await api.removeTaskTemplate('template-1')

    const [listUrl, listRequestInit] = fetchMock.mock.calls[0]!
    const [createUrl, createRequestInit] = fetchMock.mock.calls[1]!
    const [deleteUrl, deleteRequestInit] = fetchMock.mock.calls[2]!
    const listRequestUrl = listUrl instanceof URL ? listUrl.href : listUrl
    const createRequestUrl =
      createUrl instanceof URL ? createUrl.href : createUrl
    const deleteRequestUrl =
      deleteUrl instanceof URL ? deleteUrl.href : deleteUrl
    const createBody = parseJsonRequestBody<{ id: string }>(createRequestInit)

    expect(listRequestUrl).toBe('http://127.0.0.1:3001/api/v1/task-templates')
    expect(createRequestUrl).toBe('http://127.0.0.1:3001/api/v1/task-templates')
    expect(deleteRequestUrl).toBe(
      'http://127.0.0.1:3001/api/v1/task-templates/template-1',
    )
    expect(isUuidV7(createBody.id)).toBe(true)
    expect(new Headers(listRequestInit?.headers).get('x-actor-user-id')).toBe(
      null,
    )
    expect(new Headers(createRequestInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
    expect(new Headers(deleteRequestInit?.headers).get('x-actor-user-id')).toBe(
      'user-1',
    )
  })

  it('sends expectedVersion for versioned task mutations', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            completedAt: null,
            createdAt: '2026-04-16T02:00:00.000Z',
            deletedAt: null,
            dueDate: null,
            assigneeDisplayName: null,
            assigneeUserId: null,
            icon: '',
            id: 'task-1',
            importance: 'important',
            note: 'Updated',
            plannedDate: '2026-04-16',
            plannedEndTime: null,
            plannedStartTime: '09:00',
            project: '',
            projectId: null,
            resource: null,
            sphereId: null,
            status: 'todo',
            title: 'Updated task',
            updatedAt: '2026-04-16T02:30:00.000Z',
            urgency: 'not_urgent',
            version: 2,
            workspaceId: 'workspace-1',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            completedAt: '2026-04-16T03:00:00.000Z',
            createdAt: '2026-04-16T02:00:00.000Z',
            deletedAt: null,
            dueDate: null,
            assigneeDisplayName: null,
            assigneeUserId: null,
            icon: '',
            id: 'task-1',
            importance: 'important',
            note: '',
            plannedDate: null,
            plannedEndTime: null,
            plannedStartTime: null,
            project: '',
            projectId: null,
            resource: null,
            sphereId: null,
            status: 'done',
            title: 'Task title',
            updatedAt: '2026-04-16T03:00:00.000Z',
            urgency: 'not_urgent',
            version: 3,
            workspaceId: 'workspace-1',
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = createPlannerApiClient(TEST_CONFIG, fetchMock)

    await api.updateTask('task-1', {
      assigneeUserId: null,
      dueDate: null,
      expectedVersion: 1,
      icon: '',
      importance: 'important',
      note: 'Updated',
      plannedDate: '2026-04-16',
      plannedEndTime: null,
      plannedStartTime: '09:00',
      project: '',
      projectId: null,
      resource: null,
      sphereId: null,
      title: 'Updated task',
      urgency: 'not_urgent',
    })
    await api.setTaskStatus('task-1', {
      expectedVersion: 2,
      status: 'done',
    })
    await api.removeTask('task-1', 3)

    const [updateUrl, updateRequestInit] = fetchMock.mock.calls[0]!
    const [, statusRequestInit] = fetchMock.mock.calls[1]!
    const updateBody = parseJsonRequestBody<{ expectedVersion: number }>(
      updateRequestInit,
    )
    const statusBody = parseJsonRequestBody<{
      expectedVersion: number
      status: string
    }>(statusRequestInit)
    const updateRequestUrl =
      updateUrl instanceof URL ? updateUrl.href : updateUrl
    const [deleteUrl] = fetchMock.mock.calls[2]!
    const deleteRequestUrl =
      deleteUrl instanceof URL ? deleteUrl.href : deleteUrl

    expect(updateRequestUrl).toBe('http://127.0.0.1:3001/api/v1/tasks/task-1')
    expect(updateBody.expectedVersion).toBe(1)
    expect(statusBody).toEqual({
      expectedVersion: 2,
      status: 'done',
    })
    expect(deleteRequestUrl).toBe(
      'http://127.0.0.1:3001/api/v1/tasks/task-1?expectedVersion=3',
    )
  })
})
