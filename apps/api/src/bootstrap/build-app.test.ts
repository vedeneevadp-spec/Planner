import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, it } from 'node:test'

import {
  adminUserListResponseSchema,
  apiErrorSchema,
  emojiSetListResponseSchema,
  emojiSetRecordSchema,
  healthResponseSchema,
  projectListResponseSchema,
  projectRecordSchema,
  sessionResponseSchema,
  sessionWorkspaceMembershipSchema,
  taskEventListResponseSchema,
  taskListResponseSchema,
  taskRecordSchema,
  taskTemplateListResponseSchema,
  taskTemplateRecordSchema,
  workspaceInvitationListResponseSchema,
  workspaceInvitationRecordSchema,
  workspaceUserListResponseSchema,
  workspaceUserRecordSchema,
} from '@planner/contracts'

import {
  type EmojiSetRepository,
  EmojiSetService,
  LocalIconAssetStorage,
  MemoryEmojiSetRepository,
} from '../modules/emoji-sets/index.js'
import {
  MemoryProjectRepository,
  ProjectService,
} from '../modules/projects/index.js'
import {
  MemorySessionRepository,
  type SessionRepository,
  SessionService,
} from '../modules/session/index.js'
import {
  MemoryTaskTemplateRepository,
  TaskTemplateService,
} from '../modules/task-templates/index.js'
import { MemoryTaskRepository, TaskService } from '../modules/tasks/index.js'
import { buildApiApp } from './build-app.js'
import { createApiConfig } from './config.js'
import { HttpError } from './http-error.js'
import type { RequestAuthenticator } from './request-auth.js'

const AUTH_TOKEN = 'planner-test-token'
const AUTH_CONTEXT = {
  accessToken: AUTH_TOKEN,
  claims: {
    email: 'planner-auth@planner.local',
    payload: {
      email: 'planner-auth@planner.local',
      role: 'authenticated',
      sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    },
    role: 'authenticated' as const,
    sub: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  },
}

const READER_AUTH_CONTEXT = {
  accessToken: 'planner-reader-token',
  claims: {
    email: 'reader@planner.local',
    payload: {
      email: 'reader@planner.local',
      role: 'authenticated',
      sub: '44444444-4444-4444-8444-444444444444',
    },
    role: 'authenticated' as const,
    sub: '44444444-4444-4444-8444-444444444444',
  },
}

const authRequestAuthenticator: RequestAuthenticator = {
  authenticate(request) {
    if (request.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
      throw new HttpError(
        401,
        'authentication_required',
        'A valid bearer token is required for this request.',
      )
    }

    return Promise.resolve(AUTH_CONTEXT)
  },
}

const guestSessionRepository: SessionRepository = {
  resolve() {
    return Promise.resolve({
      actor: {
        displayName: 'Planner Guest',
        email: 'guest@planner.local',
        id: AUTH_CONTEXT.claims.sub,
      },
      actorUserId: AUTH_CONTEXT.claims.sub,
      appRole: 'guest',
      groupRole: null,
      role: 'guest',
      source: 'access_token',
      workspace: {
        id: 'workspace-guest',
        kind: 'personal',
        name: 'Guest Workspace',
        slug: 'guest',
      },
      workspaceId: 'workspace-guest',
      workspaces: [
        {
          groupRole: null,
          id: 'workspace-guest',
          kind: 'personal',
          name: 'Guest Workspace',
          role: 'guest',
          slug: 'guest',
        },
      ],
    })
  },
  createSharedWorkspace() {
    throw new HttpError(
      403,
      'workspace_admin_required',
      'The current workspace role cannot create shared workspaces.',
    )
  },
  listWorkspaceUsers() {
    return Promise.resolve([])
  },
  listWorkspaceInvitations() {
    return Promise.resolve([])
  },
  createWorkspaceInvitation() {
    throw new HttpError(
      403,
      'workspace_participants_manage_forbidden',
      'Only workspace owners and group admins can manage participants.',
    )
  },
  updateWorkspaceUserGroupRole() {
    throw new HttpError(
      403,
      'workspace_participants_manage_forbidden',
      'Only workspace owners and group admins can manage participants.',
    )
  },
  removeWorkspaceUser() {
    throw new HttpError(
      403,
      'workspace_participants_manage_forbidden',
      'Only workspace owners and group admins can manage participants.',
    )
  },
  revokeWorkspaceInvitation() {
    throw new HttpError(
      403,
      'workspace_participants_manage_forbidden',
      'Only workspace owners and group admins can manage participants.',
    )
  },
  listAdminUsers() {
    return Promise.resolve([])
  },
  updateAdminUserRole() {
    throw new HttpError(
      403,
      'owner_required',
      'Only the global owner can manage application users.',
    )
  },
}

function createTestConfig(env: NodeJS.ProcessEnv = {} as NodeJS.ProcessEnv) {
  return createApiConfig({
    API_STORAGE_DRIVER: 'memory',
    NODE_ENV: 'test',
    ...env,
  } as NodeJS.ProcessEnv)
}

void describe('buildApiApp', () => {
  let app: ReturnType<typeof buildApiApp> | null = null
  const temporaryDirectories: string[] = []

  void afterEach(async () => {
    if (app) {
      await app.close()
      app = null
    }

    await Promise.all(
      temporaryDirectories.splice(0).map((directory) =>
        rm(directory, {
          force: true,
          recursive: true,
        }),
      ),
    )
  })

  void it('returns health information for the configured runtime', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/health',
    })

    assert.equal(response.statusCode, 200)

    const body = healthResponseSchema.parse(response.json())

    assert.equal(body.appEnv, 'test')
    assert.equal(body.databaseStatus, 'disabled')
    assert.equal(body.storageDriver, 'memory')
  })

  void it('lists all application users for the global owner', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'x-actor-user-id': '11111111-1111-4111-8111-111111111111',
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/admin/users',
    })

    assert.equal(response.statusCode, 200)

    const body = adminUserListResponseSchema.parse(response.json())

    assert.equal(body.users.length, 2)
    assert.equal(body.users[0]?.id, '11111111-1111-4111-8111-111111111111')
    assert.equal(body.users[0]?.appRole, 'owner')
    assert.equal(body.users[1]?.appRole, 'user')
  })

  void it('forbids application user management for non-owner role', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(guestSessionRepository),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-guest',
      },
      method: 'GET',
      url: '/api/v1/admin/users',
    })

    assert.equal(response.statusCode, 403)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'owner_required')
  })

  void it('creates, updates and lists tasks via the HTTP API', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const projectResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: {
        color: '#2f6f62',
        description: 'Inbox processing',
        icon: 'folder',
        title: 'Inbox',
      },
      url: '/api/v1/projects',
    })
    const project = projectRecordSchema.parse(projectResponse.json())

    const createResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: {
        dueDate: '2026-04-15',
        icon: 'svg:calendar',
        importance: 'important',
        note: 'first note',
        plannedDate: '2026-04-15',
        plannedEndTime: '10:00',
        plannedStartTime: '09:00',
        project: 'Inbox',
        projectId: project.id,
        title: 'Prepare planner backend',
        urgency: 'urgent',
      },
      url: '/api/v1/tasks',
    })

    assert.equal(createResponse.statusCode, 201)

    const createdTask = taskRecordSchema.parse(createResponse.json())

    assert.equal(createdTask.version, 1)
    assert.equal(createdTask.icon, 'svg:calendar')
    assert.equal(createdTask.importance, 'important')
    assert.equal(createdTask.projectId, project.id)
    assert.equal(createdTask.urgency, 'urgent')
    assert.equal(createdTask.workspaceId, 'workspace-1')

    const detailsResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'PATCH',
      payload: {
        dueDate: null,
        expectedVersion: createdTask.version,
        icon: 'svg:check',
        importance: 'not_important',
        note: 'updated note',
        plannedDate: '2026-04-16',
        plannedEndTime: '12:30',
        plannedStartTime: '11:30',
        project: '',
        projectId: null,
        title: 'Prepare planner UI',
        urgency: 'not_urgent',
      },
      url: `/api/v1/tasks/${createdTask.id}`,
    })

    assert.equal(detailsResponse.statusCode, 200)

    const detailsTask = taskRecordSchema.parse(detailsResponse.json())

    assert.equal(detailsTask.version, 2)
    assert.equal(detailsTask.title, 'Prepare planner UI')
    assert.equal(detailsTask.icon, 'svg:check')
    assert.equal(detailsTask.importance, 'not_important')
    assert.equal(detailsTask.note, 'updated note')
    assert.equal(detailsTask.plannedDate, '2026-04-16')
    assert.equal(detailsTask.plannedStartTime, '11:30')
    assert.equal(detailsTask.plannedEndTime, '12:30')
    assert.equal(detailsTask.projectId, null)

    const statusResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'PATCH',
      payload: {
        expectedVersion: detailsTask.version,
        status: 'done',
      },
      url: `/api/v1/tasks/${createdTask.id}/status`,
    })

    assert.equal(statusResponse.statusCode, 200)

    const updatedTask = taskRecordSchema.parse(statusResponse.json())

    assert.equal(updatedTask.status, 'done')
    assert.equal(updatedTask.version, 3)

    const listResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/tasks?status=done',
    })

    assert.equal(listResponse.statusCode, 200)

    const tasks = taskListResponseSchema.parse(listResponse.json())

    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]?.id, createdTask.id)

    const deleteResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'DELETE',
      url: `/api/v1/tasks/${createdTask.id}?expectedVersion=${updatedTask.version}`,
    })

    assert.equal(deleteResponse.statusCode, 204)

    const eventsResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/task-events?afterEventId=0&limit=10',
    })

    assert.equal(eventsResponse.statusCode, 200)

    const eventsBody = taskEventListResponseSchema.parse(eventsResponse.json())

    assert.equal(eventsBody.nextEventId, 4)
    assert.deepEqual(
      eventsBody.events.map((event) => event.eventType),
      ['task.created', 'task.updated', 'task.status_changed', 'task.deleted'],
    )
    assert.equal(eventsBody.events[0]?.taskId, createdTask.id)

    const deletedListResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/tasks',
    })

    assert.equal(deletedListResponse.statusCode, 200)

    const deletedTasks = taskListResponseSchema.parse(
      deletedListResponse.json(),
    )

    assert.equal(deletedTasks.length, 0)
  })

  void it('rejects assignees outside shared workspaces', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const createResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: {
        assigneeUserId: '44444444-4444-4444-8444-444444444444',
        dueDate: null,
        note: '',
        plannedDate: null,
        plannedEndTime: null,
        plannedStartTime: null,
        project: '',
        projectId: null,
        resource: null,
        sphereId: null,
        title: 'Personal assignment',
      },
      url: '/api/v1/tasks',
    })

    assert.equal(createResponse.statusCode, 400)

    const body = apiErrorSchema.parse(createResponse.json())

    assert.equal(body.error.code, 'task_assignee_shared_workspace_required')
  })

  void it('creates, updates and lists projects via the HTTP API', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const createResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: {
        color: '#2f6f62',
        description: 'Planner product work',
        icon: 'folder',
        title: 'Planner',
      },
      url: '/api/v1/projects',
    })

    assert.equal(createResponse.statusCode, 201)

    const createdProject = projectRecordSchema.parse(createResponse.json())

    assert.equal(createdProject.title, 'Planner')
    assert.equal(createdProject.workspaceId, 'workspace-1')

    const updateResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'PATCH',
      payload: {
        color: '#3f5f9f',
        description: 'Updated project context',
        expectedVersion: createdProject.version,
        icon: 'target',
        title: 'Planner App',
      },
      url: `/api/v1/projects/${createdProject.id}`,
    })

    assert.equal(updateResponse.statusCode, 200)

    const updatedProject = projectRecordSchema.parse(updateResponse.json())

    assert.equal(updatedProject.title, 'Planner App')
    assert.equal(updatedProject.version, 2)

    const listResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/projects',
    })

    assert.equal(listResponse.statusCode, 200)

    const projects = projectListResponseSchema.parse(listResponse.json())

    assert.equal(projects.length, 1)
    assert.equal(projects[0]?.id, createdProject.id)
  })

  void it('creates, lists and deletes task templates via the HTTP API', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
      taskTemplateService: new TaskTemplateService(
        new MemoryTaskTemplateRepository(),
      ),
    })

    const createResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: {
        dueDate: null,
        note: 'Reusable checklist',
        plannedDate: null,
        plannedEndTime: null,
        plannedStartTime: null,
        project: '',
        projectId: null,
        title: 'Weekly review',
      },
      url: '/api/v1/task-templates',
    })

    assert.equal(createResponse.statusCode, 201)

    const createdTemplate = taskTemplateRecordSchema.parse(
      createResponse.json(),
    )

    assert.equal(createdTemplate.title, 'Weekly review')
    assert.equal(createdTemplate.workspaceId, 'workspace-1')

    const listResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/task-templates',
    })

    assert.equal(listResponse.statusCode, 200)

    const templates = taskTemplateListResponseSchema.parse(listResponse.json())

    assert.equal(templates.length, 1)
    assert.equal(templates[0]?.id, createdTemplate.id)

    const deleteResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'DELETE',
      url: `/api/v1/task-templates/${createdTemplate.id}`,
    })

    assert.equal(deleteResponse.statusCode, 204)
  })

  void it('creates, lists and manages global icon sets via the HTTP API', async () => {
    const iconAssetDirectory = await mkdtemp(
      path.join(tmpdir(), 'planner-icon-assets-'),
    )

    temporaryDirectories.push(iconAssetDirectory)

    app = buildApiApp({
      config: createTestConfig({
        API_ICON_ASSET_DIR: iconAssetDirectory,
      }),
      database: null,
      emojiSetService: new EmojiSetService(
        new MemoryEmojiSetRepository(),
        new LocalIconAssetStorage(iconAssetDirectory),
      ),
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const createResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: {
        description: 'Uploaded icons for planning markers',
        items: [
          {
            keywords: ['focus', 'target'],
            label: 'Focus',
            value: 'data:image/png;base64,iVBORw0KGgo=',
          },
          {
            label: 'Folder',
            value: 'data:image/webp;base64,UklGRg==',
          },
        ],
        title: 'Planner icons',
      },
      url: '/api/v1/emoji-sets',
    })

    assert.equal(createResponse.statusCode, 201)

    const createdEmojiSet = emojiSetRecordSchema.parse(createResponse.json())

    assert.equal(createdEmojiSet.title, 'Planner icons')
    assert.equal(createdEmojiSet.source, 'custom')
    assert.equal(createdEmojiSet.workspaceId, 'workspace-1')
    assert.equal(createdEmojiSet.items.length, 2)
    assert.equal(createdEmojiSet.items[0]?.kind, 'image')
    assert.equal(createdEmojiSet.items[0]?.shortcode, 'icon-1')
    const iconAssetUrl = createdEmojiSet.items[0]?.value

    assert.ok(iconAssetUrl)
    assert.match(iconAssetUrl, /^\/api\/v1\/icon-assets\/.+\.png$/)

    const iconAssetResponse = await app.inject({
      method: 'GET',
      url: iconAssetUrl,
    })

    assert.equal(iconAssetResponse.statusCode, 200)
    assert.match(
      String(iconAssetResponse.headers['content-type']),
      /^image\/png/,
    )

    const legacyIconAssetFileName =
      '22222222-2222-4222-8222-222222222222-019daf9c-9d3b-7c20-a85f-0004f1fbef25-000-019daf9c-9d3b-77b6-b936-887672ef6a0f.jpg'

    await writeFile(
      path.join(iconAssetDirectory, legacyIconAssetFileName),
      Buffer.from('legacy image'),
    )

    const legacyIconAssetResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/icon-assets/${legacyIconAssetFileName}`,
    })

    assert.equal(legacyIconAssetResponse.statusCode, 200)

    const listResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/emoji-sets',
    })

    assert.equal(listResponse.statusCode, 200)

    const emojiSets = emojiSetListResponseSchema.parse(listResponse.json())

    assert.equal(emojiSets.length, 1)
    assert.equal(emojiSets[0]?.id, createdEmojiSet.id)

    const crossWorkspaceListResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-2',
      },
      method: 'GET',
      url: '/api/v1/emoji-sets',
    })

    assert.equal(crossWorkspaceListResponse.statusCode, 200)

    const emojiSetsFromOtherWorkspace = emojiSetListResponseSchema.parse(
      crossWorkspaceListResponse.json(),
    )

    assert.equal(emojiSetsFromOtherWorkspace.length, 1)
    assert.equal(emojiSetsFromOtherWorkspace[0]?.id, createdEmojiSet.id)

    const addItemsResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-2',
      },
      method: 'POST',
      payload: {
        items: [
          {
            label: 'Archive',
            value: 'data:image/png;base64,iVBORw0KGgo=',
          },
        ],
      },
      url: `/api/v1/emoji-sets/${createdEmojiSet.id}/items`,
    })

    assert.equal(addItemsResponse.statusCode, 201)

    const updatedEmojiSet = emojiSetRecordSchema.parse(addItemsResponse.json())

    assert.equal(updatedEmojiSet.items.length, 3)
    assert.equal(updatedEmojiSet.items[2]?.shortcode, 'icon-3')
    assert.equal(updatedEmojiSet.items[2]?.workspaceId, createdEmojiSet.workspaceId)

    const addedIconAsset = updatedEmojiSet.items[2]

    assert.ok(addedIconAsset)

    const deleteItemResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-2',
      },
      method: 'DELETE',
      url: `/api/v1/emoji-sets/${createdEmojiSet.id}/items/${addedIconAsset.id}`,
    })

    assert.equal(deleteItemResponse.statusCode, 204)

    const deletedIconAssetResponse = await app.inject({
      method: 'GET',
      url: addedIconAsset.value,
    })

    assert.equal(deletedIconAssetResponse.statusCode, 404)

    const listAfterItemDeleteResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/emoji-sets',
    })

    assert.equal(listAfterItemDeleteResponse.statusCode, 200)

    const emojiSetsAfterItemDelete = emojiSetListResponseSchema.parse(
      listAfterItemDeleteResponse.json(),
    )

    assert.equal(emojiSetsAfterItemDelete.length, 1)
    assert.equal(emojiSetsAfterItemDelete[0]?.items.length, 2)

    const deleteSetResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-2',
      },
      method: 'DELETE',
      url: `/api/v1/emoji-sets/${createdEmojiSet.id}`,
    })

    assert.equal(deleteSetResponse.statusCode, 204)

    const deletedSetIconAssetResponse = await app.inject({
      method: 'GET',
      url: iconAssetUrl,
    })

    assert.equal(deletedSetIconAssetResponse.statusCode, 404)

    const listAfterSetDeleteResponse = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/emoji-sets',
    })

    assert.equal(listAfterSetDeleteResponse.statusCode, 200)

    const emojiSetsAfterSetDelete = emojiSetListResponseSchema.parse(
      listAfterSetDeleteResponse.json(),
    )

    assert.equal(emojiSetsAfterSetDelete.length, 0)
  })

  void it('returns a retryable error when icon set repository times out', async () => {
    const timeoutRepository: EmojiSetRepository = {
      addItems() {
        return Promise.reject(
          Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        )
      },
      create() {
        return Promise.reject(
          Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        )
      },
      deleteItem() {
        return Promise.reject(
          Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        )
      },
      deleteSet() {
        return Promise.reject(
          Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        )
      },
      getById() {
        return Promise.reject(
          Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        )
      },
      listByWorkspace() {
        return Promise.reject(
          Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        )
      },
    }

    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      emojiSetService: new EmojiSetService(timeoutRepository),
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': 'workspace-1',
      },
      method: 'POST',
      payload: {
        items: [
          {
            label: 'Archive',
            value: 'data:image/png;base64,iVBORw0KGgo=',
          },
        ],
      },
      url: '/api/v1/emoji-sets/icon-set-1/items',
    })

    assert.equal(response.statusCode, 503)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'database_unavailable')
  })

  void it('forbids icon set management for guest application role', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      emojiSetService: new EmojiSetService(new MemoryEmojiSetRepository()),
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(guestSessionRepository),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-guest',
      },
      method: 'POST',
      payload: {
        description: '',
        items: [
          {
            label: 'Focus',
            value: 'data:image/png;base64,iVBORw0KGgo=',
          },
        ],
        title: 'Guest set',
      },
      url: '/api/v1/emoji-sets',
    })

    assert.equal(response.statusCode, 403)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'app_admin_required')
  })

  void it('allows non-admin application roles to read global icon sets', async () => {
    const repository = new MemoryEmojiSetRepository()

    await repository.create({
      context: {
        actorUserId: 'user-1',
        auth: null,
        workspaceId: 'workspace-owner',
      },
      input: {
        description: 'Uploaded icons for everyone',
        items: [
          {
            label: 'Focus',
            value: 'data:image/png;base64,iVBORw0KGgo=',
          },
        ],
        title: 'Shared icons',
      },
    })

    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      emojiSetService: new EmojiSetService(repository),
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(guestSessionRepository),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-guest',
      },
      method: 'GET',
      url: '/api/v1/emoji-sets',
    })

    assert.equal(response.statusCode, 200)

    const body = emojiSetListResponseSchema.parse(response.json())

    assert.equal(body.length, 1)
    assert.equal(body[0]?.title, 'Shared icons')
    assert.equal(body[0]?.workspaceId, 'workspace-owner')
  })

  void it('reads global icon sets without resolving an authenticated session', async () => {
    const repository = new MemoryEmojiSetRepository()

    await repository.create({
      context: {
        actorUserId: 'user-1',
        auth: null,
        workspaceId: 'workspace-owner',
      },
      input: {
        description: 'Uploaded icons for everyone',
        items: [
          {
            label: 'Focus',
            value: 'data:image/png;base64,iVBORw0KGgo=',
          },
        ],
        title: 'Shared icons',
      },
    })

    const failingSessionRepository: SessionRepository = {
      resolve() {
        return Promise.reject(
          Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        )
      },
      createSharedWorkspace() {
        throw new Error('createSharedWorkspace should not be called.')
      },
      listWorkspaceUsers() {
        throw new Error('listWorkspaceUsers should not be called.')
      },
      listWorkspaceInvitations() {
        throw new Error('listWorkspaceInvitations should not be called.')
      },
      createWorkspaceInvitation() {
        throw new Error('createWorkspaceInvitation should not be called.')
      },
      updateWorkspaceUserGroupRole() {
        throw new Error('updateWorkspaceUserGroupRole should not be called.')
      },
      removeWorkspaceUser() {
        throw new Error('removeWorkspaceUser should not be called.')
      },
      revokeWorkspaceInvitation() {
        throw new Error('revokeWorkspaceInvitation should not be called.')
      },
      listAdminUsers() {
        throw new Error('listAdminUsers should not be called.')
      },
      updateAdminUserRole() {
        throw new Error('updateAdminUserRole should not be called.')
      },
    }

    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      emojiSetService: new EmojiSetService(repository),
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(failingSessionRepository),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-guest',
      },
      method: 'GET',
      url: '/api/v1/emoji-sets',
    })

    assert.equal(response.statusCode, 200)

    const body = emojiSetListResponseSchema.parse(response.json())

    assert.equal(body.length, 1)
    assert.equal(body[0]?.title, 'Shared icons')
  })

  void it('returns a typed validation error for malformed requests', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/tasks?status=invalid',
    })

    assert.equal(response.statusCode, 400)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'invalid_query')
  })

  void it('returns task event sync cursor responses', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'x-workspace-id': 'workspace-1',
      },
      method: 'GET',
      url: '/api/v1/task-events?afterEventId=5&limit=50',
    })

    assert.equal(response.statusCode, 200)

    const body = taskEventListResponseSchema.parse(response.json())

    assert.equal(body.nextEventId, 5)
    assert.deepEqual(body.events, [])
  })

  void it('allows PATCH and DELETE in CORS preflight responses', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_CORS_ORIGIN: 'http://127.0.0.1:5173',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const patchResponse = await app.inject({
      headers: {
        'access-control-request-headers':
          'content-type,x-actor-user-id,x-workspace-id',
        'access-control-request-method': 'PATCH',
        origin: 'http://127.0.0.1:5173',
      },
      method: 'OPTIONS',
      url: '/api/v1/tasks/task-1/status',
    })

    assert.equal(patchResponse.statusCode, 204)
    assert.equal(
      patchResponse.headers['access-control-allow-methods'],
      'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    )

    const deleteResponse = await app.inject({
      headers: {
        'access-control-request-method': 'DELETE',
        origin: 'http://127.0.0.1:5173',
      },
      method: 'OPTIONS',
      url: '/api/v1/tasks/task-1',
    })

    assert.equal(deleteResponse.statusCode, 204)
    assert.equal(
      deleteResponse.headers['access-control-allow-methods'],
      'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
    )
  })

  void it('allows Capacitor app origins in CORS preflight responses', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_CORS_ORIGIN: 'https://chaotika.ru',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const androidResponse = await app.inject({
      headers: {
        'access-control-request-headers': 'authorization,x-workspace-id',
        'access-control-request-method': 'GET',
        origin: 'https://localhost',
      },
      method: 'OPTIONS',
      url: '/api/v1/session',
    })

    assert.equal(androidResponse.statusCode, 204)
    assert.equal(
      androidResponse.headers['access-control-allow-origin'],
      'https://localhost',
    )

    const iosResponse = await app.inject({
      headers: {
        'access-control-request-headers': 'authorization,x-workspace-id',
        'access-control-request-method': 'GET',
        origin: 'capacitor://localhost',
      },
      method: 'OPTIONS',
      url: '/api/v1/session',
    })

    assert.equal(iosResponse.statusCode, 204)
    assert.equal(
      iosResponse.headers['access-control-allow-origin'],
      'capacitor://localhost',
    )
  })

  void it('supports multiple configured CORS origins', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_CORS_ORIGIN: 'https://chaotika.ru, https://staging.chaotika.ru',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'access-control-request-method': 'GET',
        origin: 'https://staging.chaotika.ru',
      },
      method: 'OPTIONS',
      url: '/api/v1/session',
    })

    assert.equal(response.statusCode, 204)
    assert.equal(
      response.headers['access-control-allow-origin'],
      'https://staging.chaotika.ru',
    )
  })

  void it('resolves a session without explicit headers', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(response.statusCode, 200)

    const body = sessionResponseSchema.parse(response.json())

    assert.equal(body.source, 'default')
    assert.equal(body.actor.email, 'dev@planner.local')
    assert.equal(body.workspace.slug, 'personal')
  })

  void it('returns a retryable error when session resolution times out', async () => {
    const timeoutRepository: SessionRepository = {
      resolve() {
        return Promise.reject(
          Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' }),
        )
      },
      createSharedWorkspace() {
        throw new Error('Not implemented.')
      },
      listWorkspaceUsers() {
        throw new Error('Not implemented.')
      },
      listWorkspaceInvitations() {
        throw new Error('Not implemented.')
      },
      createWorkspaceInvitation() {
        throw new Error('Not implemented.')
      },
      updateWorkspaceUserGroupRole() {
        throw new Error('Not implemented.')
      },
      removeWorkspaceUser() {
        throw new Error('Not implemented.')
      },
      revokeWorkspaceInvitation() {
        throw new Error('Not implemented.')
      },
      listAdminUsers() {
        throw new Error('Not implemented.')
      },
      updateAdminUserRole() {
        throw new Error('Not implemented.')
      },
    }

    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(timeoutRepository),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(response.statusCode, 503)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'database_unavailable')
  })

  void it('creates a shared workspace for the current actor', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': '22222222-2222-4222-8222-222222222222',
      },
      method: 'POST',
      payload: {
        name: 'Family Workspace',
      },
      url: '/api/v1/workspaces/shared',
    })

    assert.equal(response.statusCode, 201)

    const workspace = sessionWorkspaceMembershipSchema.parse(response.json())

    assert.equal(workspace.kind, 'shared')
    assert.equal(workspace.groupRole, 'group_admin')
    assert.equal(workspace.role, 'owner')
    assert.equal(workspace.name, 'Family Workspace')
  })

  void it('creates and lists workspace invitations for a shared workspace', async () => {
    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const workspaceResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': '22222222-2222-4222-8222-222222222222',
      },
      method: 'POST',
      payload: {
        name: 'Family Workspace',
      },
      url: '/api/v1/workspaces/shared',
    })

    const workspace = sessionWorkspaceMembershipSchema.parse(
      workspaceResponse.json(),
    )
    const inviteResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': workspace.id,
      },
      method: 'POST',
      payload: {
        email: 'reader@planner.local',
        groupRole: 'group_admin',
      },
      url: '/api/v1/workspace-invitations',
    })

    assert.equal(inviteResponse.statusCode, 201)

    const invitation = workspaceInvitationRecordSchema.parse(
      inviteResponse.json(),
    )

    assert.equal(invitation.email, 'reader@planner.local')
    assert.equal(invitation.groupRole, 'group_admin')

    const invitationsResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': workspace.id,
      },
      method: 'GET',
      url: '/api/v1/workspace-invitations',
    })

    assert.equal(invitationsResponse.statusCode, 200)

    const invitations = workspaceInvitationListResponseSchema.parse(
      invitationsResponse.json(),
    )

    assert.equal(invitations.invitations.length, 1)
    assert.equal(invitations.invitations[0]?.email, 'reader@planner.local')
  })

  void it('updates workspace participant group roles', async () => {
    const sessionRepository = new MemorySessionRepository()

    app = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService: new SessionService(sessionRepository),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const workspaceResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': '22222222-2222-4222-8222-222222222222',
      },
      method: 'POST',
      payload: {
        name: 'Team Workspace',
      },
      url: '/api/v1/workspaces/shared',
    })

    const workspace = sessionWorkspaceMembershipSchema.parse(
      workspaceResponse.json(),
    )

    const inviteResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': workspace.id,
      },
      method: 'POST',
      payload: {
        email: READER_AUTH_CONTEXT.claims.email,
        groupRole: 'member',
      },
      url: '/api/v1/workspace-invitations',
    })

    assert.equal(inviteResponse.statusCode, 201)

    await sessionRepository.resolve({
      actorUserId: undefined,
      auth: READER_AUTH_CONTEXT,
      workspaceId: workspace.id,
    })

    const usersResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': workspace.id,
      },
      method: 'GET',
      url: '/api/v1/workspace-users',
    })

    assert.equal(usersResponse.statusCode, 200)

    const users = workspaceUserListResponseSchema.parse(usersResponse.json())
    const readerMembership = users.users.find(
      (candidate) => candidate.email === READER_AUTH_CONTEXT.claims.email,
    )

    assert.ok(readerMembership)
    assert.equal(readerMembership.groupRole, 'member')
    assert.equal(readerMembership.isOwner, false)

    const updateResponse = await app.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': workspace.id,
      },
      method: 'PATCH',
      payload: {
        groupRole: 'senior_member',
      },
      url: `/api/v1/workspace-users/${readerMembership.membershipId}/group-role`,
    })

    assert.equal(updateResponse.statusCode, 200)

    const updatedUser = workspaceUserRecordSchema.parse(updateResponse.json())

    assert.equal(updatedUser.groupRole, 'senior_member')
    assert.equal(updatedUser.isOwner, false)
  })

  void it('claims matching workspace invitations during authenticated session resolution', async () => {
    const sessionService = new SessionService(new MemorySessionRepository())
    const setupApp = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService,
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const workspaceResponse = await setupApp.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': '22222222-2222-4222-8222-222222222222',
      },
      method: 'POST',
      payload: {
        name: 'Team Workspace',
      },
      url: '/api/v1/workspaces/shared',
    })

    const workspace = sessionWorkspaceMembershipSchema.parse(
      workspaceResponse.json(),
    )
    const inviteResponse = await setupApp.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': workspace.id,
      },
      method: 'POST',
      payload: {
        email: AUTH_CONTEXT.claims.email,
        groupRole: 'member',
      },
      url: '/api/v1/workspace-invitations',
    })

    assert.equal(inviteResponse.statusCode, 201)

    await setupApp.close()

    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService,
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const sessionResponse = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': workspace.id,
      },
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(sessionResponse.statusCode, 200)

    const session = sessionResponseSchema.parse(sessionResponse.json())

    assert.equal(session.workspaceId, workspace.id)
    assert.equal(session.actor.email, AUTH_CONTEXT.claims.email)
    assert.ok(session.workspaces.some((candidate) => candidate.id === workspace.id))

    const verifyApp = buildApiApp({
      config: createTestConfig(),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      sessionService,
      taskService: new TaskService(new MemoryTaskRepository()),
    })
    const usersResponse = await verifyApp.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': workspace.id,
      },
      method: 'GET',
      url: '/api/v1/workspace-users',
    })

    assert.equal(usersResponse.statusCode, 200)

    const users = workspaceUserListResponseSchema.parse(usersResponse.json())

    assert.ok(
      users.users.some((candidate) => candidate.email === AUTH_CONTEXT.claims.email),
    )

    const invitationsResponse = await verifyApp.inject({
      headers: {
        'x-actor-user-id': 'user-1',
        'x-workspace-id': workspace.id,
      },
      method: 'GET',
      url: '/api/v1/workspace-invitations',
    })

    assert.equal(invitationsResponse.statusCode, 200)

    const invitations = workspaceInvitationListResponseSchema.parse(
      invitationsResponse.json(),
    )

    assert.equal(invitations.invitations.length, 0)

    await verifyApp.close()
  })

  void it('serves OpenAPI JSON without request authentication', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/openapi.json',
    })

    assert.equal(response.statusCode, 200)

    const body: {
      openapi?: string
      paths?: Record<string, unknown>
    } = response.json()

    assert.equal(body.openapi, '3.0.3')
    assert.ok(body.paths?.['/api/v1/emoji-sets'])
    assert.ok(body.paths?.['/api/v1/emoji-sets/{emojiSetId}'])
    assert.ok(body.paths?.['/api/v1/emoji-sets/{emojiSetId}/items'])
    assert.ok(
      body.paths?.['/api/v1/emoji-sets/{emojiSetId}/items/{iconAssetId}'],
    )
    assert.ok(body.paths?.['/api/v1/projects'])
    assert.ok(body.paths?.['/api/v1/projects/{projectId}'])
    assert.ok(body.paths?.['/api/v1/task-events'])
    assert.ok(body.paths?.['/api/v1/task-templates'])
    assert.ok(body.paths?.['/api/v1/task-templates/{templateId}'])
    assert.ok(body.paths?.['/api/v1/tasks'])
    assert.ok(body.paths?.['/api/v1/tasks/{taskId}/status'])
    assert.ok(body.paths?.['/api/v1/workspace-invitations'])
    assert.ok(body.paths?.['/api/v1/workspace-invitations/{invitationId}'])
    assert.ok(body.paths?.['/api/v1/workspace-users'])
    assert.ok(body.paths?.['/api/v1/workspace-users/{membershipId}'])
    assert.ok(body.paths?.['/api/v1/workspace-users/{membershipId}/group-role'])
    assert.ok(body.paths?.['/api/v1/workspaces/shared'])
  })

  void it('requires a bearer token when request authentication is enabled', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(response.statusCode, 401)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'authentication_required')
  })

  void it('resolves session and task writes from authenticated requests', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(new MemorySessionRepository()),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const sessionResponse = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-auth',
      },
      method: 'GET',
      url: '/api/v1/session',
    })

    assert.equal(sessionResponse.statusCode, 200)

    const session = sessionResponseSchema.parse(sessionResponse.json())

    assert.equal(session.actor.id, AUTH_CONTEXT.claims.sub)
    assert.equal(session.source, 'access_token')
    assert.equal(session.workspace.id, 'workspace-auth')

    const createResponse = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-auth',
      },
      method: 'POST',
      payload: {
        dueDate: null,
        note: 'created under bearer auth',
        plannedDate: null,
        plannedEndTime: null,
        plannedStartTime: null,
        project: '',
        title: 'Authenticated task write',
      },
      url: '/api/v1/tasks',
    })

    assert.equal(createResponse.statusCode, 201)

    const createdTask = taskRecordSchema.parse(createResponse.json())

    assert.equal(createdTask.workspaceId, 'workspace-auth')
  })

  void it('forbids task writes for guest workspace role', async () => {
    app = buildApiApp({
      config: createTestConfig({
        API_AUTH_MODE: 'supabase',
        SUPABASE_PROJECT_REF: 'planner-test-project',
      }),
      database: null,
      projectService: new ProjectService(new MemoryProjectRepository()),
      requestAuthenticator: authRequestAuthenticator,
      sessionService: new SessionService(guestSessionRepository),
      taskService: new TaskService(new MemoryTaskRepository()),
    })

    const response = await app.inject({
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-workspace-id': 'workspace-guest',
      },
      method: 'POST',
      payload: {
        dueDate: null,
        note: '',
        plannedDate: null,
        plannedEndTime: null,
        plannedStartTime: null,
        project: '',
        title: 'Guest cannot write',
      },
      url: '/api/v1/tasks',
    })

    assert.equal(response.statusCode, 403)

    const body = apiErrorSchema.parse(response.json())

    assert.equal(body.error.code, 'workspace_write_forbidden')
  })
})
