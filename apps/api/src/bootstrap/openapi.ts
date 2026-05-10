import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'
import type { OpenAPIV3 } from 'openapi-types'

import type { ApiConfig } from './config.js'

// noinspection SqlNoDataSourceInspection
export function registerOpenApi(app: FastifyInstance, config: ApiConfig): void {
  app.register(swagger, {
    mode: 'static',
    specification: {
      document: createOpenApiDocument(config),
    },
  })

  app.register(swaggerUi, {
    routePrefix: '/api/docs',
    staticCSP: true,
    uiConfig: {
      deepLinking: true,
      docExpansion: 'list',
    },
  })

  app.get('/api/openapi.json', () => app.swagger())
}

function createOpenApiDocument(config: ApiConfig): OpenAPIV3.Document {
  return {
    components: {
      parameters: {
        actorUserIdHeader: {
          description:
            'Legacy actor override for local non-authenticated runtime. Authenticated runtime derives actor from the bearer token.',
          in: 'header',
          name: 'x-actor-user-id',
          required: false,
          schema: {
            type: 'string',
          },
        },
        optionalWorkspaceIdHeader: {
          description:
            'Optional workspace scope. If omitted, the backend resolves the default accessible workspace.',
          in: 'header',
          name: 'x-workspace-id',
          required: false,
          schema: {
            type: 'string',
          },
        },
        requiredWorkspaceIdHeader: {
          description: 'Workspace scope for the request.',
          in: 'header',
          name: 'x-workspace-id',
          required: true,
          schema: {
            type: 'string',
          },
        },
      },
      schemas: createComponentSchemas(),
      securitySchemes: {
        bearerAuth: {
          bearerFormat: 'JWT',
          scheme: 'bearer',
          type: 'http',
        },
      },
    },
    info: {
      description:
        'Planner backend API. The frontend reads and writes through this Fastify boundary; Postgres remains the source of truth.',
      title: 'Planner API',
      version: '1.0.0',
    },
    openapi: '3.0.3',
    paths: createPaths(),
    servers: [
      {
        description: `${config.appEnv} runtime`,
        url: `http://127.0.0.1:${config.port}`,
      },
    ],
    tags: [
      {
        description: 'Runtime and dependency status.',
        name: 'health',
      },
      {
        description: 'Email/password authentication and token lifecycle.',
        name: 'auth',
      },
      {
        description: 'Current actor/workspace resolution.',
        name: 'session',
      },
      {
        description: 'Global icon sets and reusable uploaded icons.',
        name: 'emojiSets',
      },
      {
        description: 'Task list and task mutations.',
        name: 'tasks',
      },
      {
        description: 'Reusable task templates for fast task creation.',
        name: 'taskTemplates',
      },
      {
        description: 'Independent project catalog and project mutations.',
        name: 'projects',
      },
    ],
  }
}

function createPaths(): OpenAPIV3.PathsObject {
  return {
    '/api/health': {
      get: {
        operationId: 'getHealth',
        responses: {
          200: jsonResponse('HealthResponse'),
        },
        summary: 'Get API health status',
        tags: ['health'],
      },
    },
    '/api/metrics': {
      get: {
        operationId: 'getMetrics',
        responses: {
          200: {
            content: {
              'text/plain': {
                schema: {
                  type: 'string',
                },
              },
            },
            description: 'Prometheus-compatible API metrics.',
          },
        },
        summary: 'Get API runtime metrics',
        tags: ['health'],
      },
    },
    '/api/v1/auth/sign-in': {
      post: {
        operationId: 'signIn',
        requestBody: jsonRequestBody('AuthSignInInput'),
        responses: {
          200: jsonResponse('AuthTokenResponse'),
          400: errorResponse(),
          429: errorResponse(),
        },
        summary: 'Sign in with email and password',
        tags: ['auth'],
      },
    },
    '/api/v1/auth/sign-up': {
      post: {
        operationId: 'signUp',
        requestBody: jsonRequestBody('AuthSignUpInput'),
        responses: {
          201: jsonResponse('AuthTokenResponse'),
          400: errorResponse(),
          409: errorResponse(),
          429: errorResponse(),
        },
        summary: 'Create an account with email and password',
        tags: ['auth'],
      },
    },
    '/api/v1/auth/refresh': {
      post: {
        operationId: 'refreshAuthToken',
        requestBody: jsonRequestBody('AuthRefreshInput'),
        responses: {
          200: jsonResponse('AuthTokenResponse'),
          400: errorResponse(),
          401: errorResponse(),
        },
        summary: 'Refresh an auth session',
        tags: ['auth'],
      },
    },
    '/api/v1/session': {
      get: {
        operationId: 'getSession',
        parameters: [
          parameter('optionalWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          200: jsonResponse('SessionResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Resolve current planner session',
        tags: ['session'],
      },
    },
    '/api/v1/workspaces/shared': {
      post: {
        operationId: 'createSharedWorkspace',
        parameters: [
          parameter('optionalWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('CreateSharedWorkspaceInput'),
        responses: {
          201: jsonResponse('SessionWorkspaceMembership'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Create a shared workspace for the current actor',
        tags: ['session'],
      },
    },
    '/api/v1/admin/users': {
      get: {
        operationId: 'listAdminUsers',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          200: jsonResponse('AdminUserListResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List application users',
        tags: ['session'],
      },
    },
    '/api/v1/admin/users/{userId}/role': {
      patch: {
        operationId: 'updateAdminUserRole',
        parameters: [
          userIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('AdminUserRoleUpdateInput'),
        responses: {
          200: jsonResponse('AdminUserRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Update application user role',
        tags: ['session'],
      },
    },
    '/api/v1/admin/workspace-settings': {
      patch: {
        operationId: 'updateWorkspaceSettings',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('WorkspaceSettingsUpdateInput'),
        responses: {
          200: jsonResponse('WorkspaceSettings'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Update admin-configurable settings for the current workspace',
        tags: ['session'],
      },
    },
    '/api/v1/workspace-users': {
      get: {
        operationId: 'listWorkspaceUsers',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          200: jsonResponse('WorkspaceUserListResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List active participants in the current workspace',
        tags: ['session'],
      },
    },
    '/api/v1/workspace-users/{membershipId}/group-role': {
      patch: {
        operationId: 'updateWorkspaceUserGroupRole',
        parameters: [
          membershipIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('WorkspaceUserGroupRoleUpdateInput'),
        responses: {
          200: jsonResponse('WorkspaceUserRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Update an active workspace participant group role',
        tags: ['session'],
      },
    },
    '/api/v1/workspace-users/{membershipId}': {
      delete: {
        operationId: 'removeWorkspaceUser',
        parameters: [
          membershipIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          204: {
            description: 'Participant removed.',
          },
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Remove an active participant from the current workspace',
        tags: ['session'],
      },
    },
    '/api/v1/workspace-invitations': {
      get: {
        operationId: 'listWorkspaceInvitations',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          200: jsonResponse('WorkspaceInvitationListResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List pending invitations for the current workspace',
        tags: ['session'],
      },
      post: {
        operationId: 'createWorkspaceInvitation',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('WorkspaceInvitationCreateInput'),
        responses: {
          201: jsonResponse('WorkspaceInvitationRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Invite a participant to the current shared workspace',
        tags: ['session'],
      },
    },
    '/api/v1/workspace-invitations/{invitationId}': {
      delete: {
        operationId: 'revokeWorkspaceInvitation',
        parameters: [
          invitationIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          204: {
            description: 'Invitation revoked.',
          },
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Revoke a pending workspace invitation',
        tags: ['session'],
      },
    },
    '/api/v1/emoji-sets': {
      get: {
        operationId: 'listEmojiSets',
        parameters: [parameter('requiredWorkspaceIdHeader')],
        responses: {
          200: jsonResponse('EmojiSetListResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          503: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List global icon sets',
        tags: ['emojiSets'],
      },
      post: {
        operationId: 'createEmojiSet',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('NewEmojiSetInput'),
        responses: {
          201: jsonResponse('EmojiSetRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          409: errorResponse(),
          503: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Create an icon set',
        tags: ['emojiSets'],
      },
    },
    '/api/v1/emoji-sets/{emojiSetId}': {
      delete: {
        operationId: 'deleteEmojiSet',
        parameters: [
          emojiSetIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          204: emptyResponse('Icon set deleted.'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          503: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Delete an icon set',
        tags: ['emojiSets'],
      },
      get: {
        operationId: 'getEmojiSet',
        parameters: [
          emojiSetIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
        ],
        responses: {
          200: jsonResponse('EmojiSetRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          503: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Get an icon set',
        tags: ['emojiSets'],
      },
    },
    '/api/v1/emoji-sets/{emojiSetId}/items': {
      post: {
        operationId: 'addEmojiSetItems',
        parameters: [
          emojiSetIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('AddEmojiSetItemsInput'),
        responses: {
          201: jsonResponse('EmojiSetRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          409: errorResponse(),
          503: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Add icons to an icon set',
        tags: ['emojiSets'],
      },
    },
    '/api/v1/emoji-sets/{emojiSetId}/items/{iconAssetId}': {
      delete: {
        operationId: 'deleteEmojiSetItem',
        parameters: [
          emojiSetIdParameter(),
          iconAssetIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          204: emptyResponse('Icon asset deleted.'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          503: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Delete an icon from an icon set',
        tags: ['emojiSets'],
      },
    },
    '/api/v1/projects': {
      get: {
        operationId: 'listProjects',
        parameters: [parameter('requiredWorkspaceIdHeader')],
        responses: {
          200: jsonResponse('ProjectListResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List projects in a workspace',
        tags: ['projects'],
      },
      post: {
        operationId: 'createProject',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('NewProjectInput'),
        responses: {
          201: jsonResponse('ProjectRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Create a project',
        tags: ['projects'],
      },
    },
    '/api/v1/projects/{projectId}': {
      get: {
        operationId: 'getProject',
        parameters: [
          projectIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
        ],
        responses: {
          200: jsonResponse('ProjectRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Get a project',
        tags: ['projects'],
      },
      patch: {
        operationId: 'updateProject',
        parameters: [
          projectIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('ProjectUpdateInput'),
        responses: {
          200: jsonResponse('ProjectRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Update a project',
        tags: ['projects'],
      },
    },
    '/api/v1/tasks': {
      get: {
        operationId: 'listTasks',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          {
            in: 'query',
            name: 'plannedDate',
            required: false,
            schema: {
              type: 'string',
            },
          },
          {
            in: 'query',
            name: 'projectId',
            required: false,
            schema: {
              type: 'string',
            },
          },
          {
            in: 'query',
            name: 'project',
            required: false,
            schema: {
              type: 'string',
            },
          },
          {
            in: 'query',
            name: 'status',
            required: false,
            schema: {
              $ref: '#/components/schemas/TaskStatus',
            },
          },
        ],
        responses: {
          200: jsonResponse('TaskListResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List tasks in a workspace',
        tags: ['tasks'],
      },
      post: {
        operationId: 'createTask',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('NewTaskInput'),
        responses: {
          201: jsonResponse('TaskRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Create a task',
        tags: ['tasks'],
      },
    },
    '/api/v1/tasks/page': {
      get: {
        operationId: 'listTasksPage',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          {
            in: 'query',
            name: 'limit',
            required: false,
            schema: {
              maximum: 100,
              minimum: 1,
              type: 'integer',
            },
          },
          {
            in: 'query',
            name: 'offset',
            required: false,
            schema: {
              minimum: 0,
              type: 'integer',
            },
          },
          {
            in: 'query',
            name: 'plannedDate',
            required: false,
            schema: {
              type: 'string',
            },
          },
          {
            in: 'query',
            name: 'projectId',
            required: false,
            schema: {
              type: 'string',
            },
          },
          {
            in: 'query',
            name: 'sphereId',
            required: false,
            schema: {
              type: 'string',
            },
          },
          {
            in: 'query',
            name: 'status',
            required: false,
            schema: {
              $ref: '#/components/schemas/TaskStatus',
            },
          },
        ],
        responses: {
          200: jsonResponse('TaskListPageResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List tasks in a workspace with pagination metadata',
        tags: ['tasks'],
      },
    },
    '/api/v1/task-events': {
      get: {
        operationId: 'listTaskEvents',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          {
            in: 'query',
            name: 'afterEventId',
            required: false,
            schema: {
              minimum: 0,
              type: 'integer',
            },
          },
          {
            in: 'query',
            name: 'limit',
            required: false,
            schema: {
              maximum: 500,
              minimum: 1,
              type: 'integer',
            },
          },
        ],
        responses: {
          200: jsonResponse('TaskEventListResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List task events for cursor-based sync',
        tags: ['tasks'],
      },
    },
    '/api/v1/task-templates': {
      get: {
        operationId: 'listTaskTemplates',
        parameters: [parameter('requiredWorkspaceIdHeader')],
        responses: {
          200: jsonResponse('TaskTemplateListResponse'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'List task templates in a workspace',
        tags: ['taskTemplates'],
      },
      post: {
        operationId: 'createTaskTemplate',
        parameters: [
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('NewTaskTemplateInput'),
        responses: {
          201: jsonResponse('TaskTemplateRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Create a task template',
        tags: ['taskTemplates'],
      },
    },
    '/api/v1/task-templates/{templateId}': {
      delete: {
        operationId: 'deleteTaskTemplate',
        parameters: [
          taskTemplateIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responses: {
          204: {
            description: 'Task template deleted.',
          },
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Soft-delete a task template',
        tags: ['taskTemplates'],
      },
    },
    '/api/v1/tasks/{taskId}': {
      delete: {
        operationId: 'deleteTask',
        parameters: [
          taskIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
          {
            in: 'query',
            name: 'expectedVersion',
            required: false,
            schema: positiveIntegerSchema(),
          },
        ],
        responses: {
          204: {
            description: 'Task deleted.',
          },
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Soft-delete a task',
        tags: ['tasks'],
      },
    },
    '/api/v1/tasks/{taskId}/schedule': {
      patch: {
        operationId: 'updateTaskSchedule',
        parameters: [
          taskIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('TaskScheduleUpdateInput'),
        responses: {
          200: jsonResponse('TaskRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Update task schedule',
        tags: ['tasks'],
      },
    },
    '/api/v1/tasks/{taskId}/status': {
      patch: {
        operationId: 'updateTaskStatus',
        parameters: [
          taskIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('TaskStatusUpdateInput'),
        responses: {
          200: jsonResponse('TaskRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Update task status',
        tags: ['tasks'],
      },
    },
  }
}

function createComponentSchemas(): Record<string, OpenAPIV3.SchemaObject> {
  return {
    ApiError: {
      additionalProperties: false,
      properties: {
        error: {
          additionalProperties: false,
          properties: {
            code: {
              type: 'string',
            },
            details: {
              nullable: true,
            },
            message: {
              type: 'string',
            },
          },
          required: ['code', 'message'],
          type: 'object',
        },
      },
      required: ['error'],
      type: 'object',
    },
    AuthRefreshInput: {
      additionalProperties: false,
      properties: {
        refreshToken: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['refreshToken'],
      type: 'object',
    },
    AuthSignInInput: {
      additionalProperties: false,
      properties: {
        email: {
          format: 'email',
          type: 'string',
        },
        password: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['email', 'password'],
      type: 'object',
    },
    AuthSignUpInput: {
      additionalProperties: false,
      properties: {
        displayName: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
        email: {
          format: 'email',
          type: 'string',
        },
        password: {
          maxLength: 128,
          minLength: 6,
          type: 'string',
        },
      },
      required: ['email', 'password'],
      type: 'object',
    },
    AuthTokenResponse: {
      additionalProperties: false,
      properties: {
        accessToken: {
          minLength: 1,
          type: 'string',
        },
        expiresAt: {
          format: 'date-time',
          type: 'string',
        },
        refreshToken: {
          minLength: 1,
          type: 'string',
        },
        user: {
          additionalProperties: false,
          properties: {
            email: {
              format: 'email',
              type: 'string',
            },
            id: {
              format: 'uuid',
              type: 'string',
            },
          },
          required: ['email', 'id'],
          type: 'object',
        },
      },
      required: ['accessToken', 'expiresAt', 'refreshToken', 'user'],
      type: 'object',
    },
    HealthResponse: {
      additionalProperties: false,
      properties: {
        appEnv: {
          type: 'string',
        },
        databaseStatus: {
          enum: ['disabled', 'down', 'up'],
          type: 'string',
        },
        status: {
          enum: ['ok'],
          type: 'string',
        },
        storageDriver: {
          enum: ['memory', 'postgres'],
          type: 'string',
        },
        timestamp: {
          format: 'date-time',
          type: 'string',
        },
      },
      required: [
        'appEnv',
        'databaseStatus',
        'status',
        'storageDriver',
        'timestamp',
      ],
      type: 'object',
    },
    NewEmojiAssetInput: {
      additionalProperties: false,
      properties: {
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        kind: {
          $ref: '#/components/schemas/EmojiAssetKind',
        },
        keywords: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        label: {
          minLength: 1,
          type: 'string',
        },
        shortcode: {
          minLength: 1,
          type: 'string',
        },
        value: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['label', 'value'],
      type: 'object',
    },
    NewEmojiSetInput: {
      additionalProperties: false,
      properties: {
        description: {
          type: 'string',
        },
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        items: {
          items: {
            $ref: '#/components/schemas/NewEmojiAssetInput',
          },
          maxItems: 200,
          minItems: 1,
          type: 'array',
        },
        source: {
          $ref: '#/components/schemas/EmojiSetSource',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['description', 'items', 'title'],
      type: 'object',
    },
    AddEmojiSetItemsInput: {
      additionalProperties: false,
      properties: {
        items: {
          items: {
            $ref: '#/components/schemas/NewEmojiAssetInput',
          },
          maxItems: 200,
          minItems: 1,
          type: 'array',
        },
      },
      required: ['items'],
      type: 'object',
    },
    NewTaskInput: {
      additionalProperties: false,
      properties: {
        assigneeUserId: nullableStringSchema(),
        dueDate: nullableStringSchema(),
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        icon: {
          type: 'string',
        },
        importance: {
          $ref: '#/components/schemas/TaskImportance',
        },
        note: {
          type: 'string',
        },
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
        project: {
          type: 'string',
        },
        projectId: nullableStringSchema(),
        remindBeforeStart: {
          type: 'boolean',
        },
        reminderTimeZone: {
          type: 'string',
        },
        requiresConfirmation: {
          type: 'boolean',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
        urgency: {
          $ref: '#/components/schemas/TaskUrgency',
        },
      },
      required: [
        'assigneeUserId',
        'dueDate',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'projectId',
        'requiresConfirmation',
        'title',
      ],
      type: 'object',
    },
    NewTaskTemplateInput: {
      additionalProperties: false,
      properties: {
        dueDate: nullableStringSchema(),
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        icon: {
          type: 'string',
        },
        importance: {
          $ref: '#/components/schemas/TaskImportance',
        },
        note: {
          type: 'string',
        },
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
        project: {
          type: 'string',
        },
        projectId: nullableStringSchema(),
        title: {
          minLength: 1,
          type: 'string',
        },
        urgency: {
          $ref: '#/components/schemas/TaskUrgency',
        },
      },
      required: [
        'dueDate',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'projectId',
        'title',
      ],
      type: 'object',
    },
    NewProjectInput: {
      additionalProperties: false,
      properties: {
        color: {
          minLength: 1,
          type: 'string',
        },
        description: {
          type: 'string',
        },
        icon: {
          minLength: 1,
          type: 'string',
        },
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['color', 'description', 'icon', 'title'],
      type: 'object',
    },
    EmojiAssetKind: {
      enum: ['image'],
      type: 'string',
    },
    EmojiAssetRecord: {
      additionalProperties: false,
      properties: {
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        deletedAt: nullableStringSchema(),
        emojiSetId: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
        keywords: {
          items: {
            type: 'string',
          },
          type: 'array',
        },
        kind: {
          $ref: '#/components/schemas/EmojiAssetKind',
        },
        label: {
          minLength: 1,
          type: 'string',
        },
        shortcode: {
          minLength: 1,
          type: 'string',
        },
        sortOrder: {
          minimum: 0,
          type: 'integer',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
        value: {
          minLength: 1,
          type: 'string',
        },
        version: positiveIntegerSchema(),
        workspaceId: {
          type: 'string',
        },
      },
      required: [
        'createdAt',
        'deletedAt',
        'emojiSetId',
        'id',
        'keywords',
        'kind',
        'label',
        'shortcode',
        'sortOrder',
        'updatedAt',
        'value',
        'version',
        'workspaceId',
      ],
      type: 'object',
    },
    EmojiSetListResponse: {
      items: {
        $ref: '#/components/schemas/EmojiSetRecord',
      },
      type: 'array',
    },
    EmojiSetRecord: {
      additionalProperties: false,
      properties: {
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        deletedAt: nullableStringSchema(),
        description: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
        items: {
          items: {
            $ref: '#/components/schemas/EmojiAssetRecord',
          },
          type: 'array',
        },
        source: {
          $ref: '#/components/schemas/EmojiSetSource',
        },
        status: {
          enum: ['active', 'archived'],
          type: 'string',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
        version: positiveIntegerSchema(),
        workspaceId: {
          type: 'string',
        },
      },
      required: [
        'createdAt',
        'deletedAt',
        'description',
        'id',
        'items',
        'source',
        'status',
        'title',
        'updatedAt',
        'version',
        'workspaceId',
      ],
      type: 'object',
    },
    EmojiSetSource: {
      enum: ['custom'],
      type: 'string',
    },
    ProjectListResponse: {
      items: {
        $ref: '#/components/schemas/ProjectRecord',
      },
      type: 'array',
    },
    ProjectRecord: {
      allOf: [
        {
          $ref: '#/components/schemas/Project',
        },
        {
          additionalProperties: false,
          properties: {
            deletedAt: nullableStringSchema(),
            updatedAt: {
              format: 'date-time',
              type: 'string',
            },
            version: positiveIntegerSchema(),
            workspaceId: {
              type: 'string',
            },
          },
          required: ['deletedAt', 'updatedAt', 'version', 'workspaceId'],
          type: 'object',
        },
      ],
    },
    Project: {
      additionalProperties: false,
      properties: {
        color: {
          minLength: 1,
          type: 'string',
        },
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        description: {
          type: 'string',
        },
        icon: {
          minLength: 1,
          type: 'string',
        },
        id: {
          type: 'string',
        },
        status: {
          enum: ['active', 'archived'],
          type: 'string',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
      },
      required: [
        'color',
        'createdAt',
        'description',
        'icon',
        'id',
        'status',
        'title',
      ],
      type: 'object',
    },
    ProjectUpdateInput: {
      additionalProperties: false,
      properties: {
        color: {
          minLength: 1,
          type: 'string',
        },
        description: {
          type: 'string',
        },
        expectedVersion: positiveIntegerSchema(),
        icon: {
          minLength: 1,
          type: 'string',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
      },
      type: 'object',
    },
    SessionActor: {
      additionalProperties: false,
      properties: {
        displayName: {
          type: 'string',
        },
        email: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
      },
      required: ['displayName', 'email', 'id'],
      type: 'object',
    },
    SessionResponse: {
      additionalProperties: false,
      properties: {
        actor: {
          $ref: '#/components/schemas/SessionActor',
        },
        actorUserId: {
          type: 'string',
        },
        appRole: {
          $ref: '#/components/schemas/AppRole',
        },
        groupRole: nullableRefSchema('WorkspaceGroupRole'),
        role: {
          $ref: '#/components/schemas/WorkspaceRole',
        },
        source: {
          enum: ['access_token', 'default', 'headers'],
          type: 'string',
        },
        workspace: {
          $ref: '#/components/schemas/SessionWorkspace',
        },
        workspaceId: {
          type: 'string',
        },
        workspaceSettings: {
          $ref: '#/components/schemas/WorkspaceSettings',
        },
        workspaces: {
          items: {
            $ref: '#/components/schemas/SessionWorkspaceMembership',
          },
          type: 'array',
        },
      },
      required: [
        'actor',
        'actorUserId',
        'appRole',
        'groupRole',
        'role',
        'source',
        'workspace',
        'workspaceId',
        'workspaceSettings',
        'workspaces',
      ],
      type: 'object',
    },
    SessionWorkspace: {
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
        },
        kind: {
          $ref: '#/components/schemas/WorkspaceKind',
        },
        name: {
          type: 'string',
        },
        slug: {
          type: 'string',
        },
      },
      required: ['id', 'kind', 'name', 'slug'],
      type: 'object',
    },
    SessionWorkspaceMembership: {
      allOf: [
        {
          $ref: '#/components/schemas/SessionWorkspace',
        },
        {
          additionalProperties: false,
          properties: {
            groupRole: nullableRefSchema('WorkspaceGroupRole'),
            role: {
              $ref: '#/components/schemas/WorkspaceRole',
            },
          },
          required: ['groupRole', 'role'],
          type: 'object',
        },
      ],
    },
    WorkspaceGroupRole: {
      enum: ['group_admin', 'member', 'senior_member'],
      type: 'string',
    },
    WorkspaceKind: {
      enum: ['personal', 'shared'],
      type: 'string',
    },
    WorkspaceSettings: {
      additionalProperties: false,
      properties: {
        taskCompletionConfettiEnabled: {
          type: 'boolean',
        },
      },
      required: ['taskCompletionConfettiEnabled'],
      type: 'object',
    },
    WorkspaceRole: {
      enum: ['admin', 'guest', 'owner', 'user'],
      type: 'string',
    },
    AppRole: {
      enum: ['admin', 'guest', 'owner', 'user'],
      type: 'string',
    },
    AssignableAppRole: {
      enum: ['admin', 'guest', 'user'],
      type: 'string',
    },
    AssignableWorkspaceGroupRole: {
      enum: ['group_admin', 'member', 'senior_member'],
      type: 'string',
    },
    CreateSharedWorkspaceInput: {
      additionalProperties: false,
      properties: {
        name: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
      },
      type: 'object',
    },
    AdminUserListResponse: {
      additionalProperties: false,
      properties: {
        users: {
          items: {
            $ref: '#/components/schemas/AdminUserRecord',
          },
          type: 'array',
        },
      },
      required: ['users'],
      type: 'object',
    },
    AdminUserRecord: {
      additionalProperties: false,
      properties: {
        appRole: {
          $ref: '#/components/schemas/AppRole',
        },
        displayName: {
          type: 'string',
        },
        email: {
          type: 'string',
        },
        id: {
          type: 'string',
        },
        lastSeenAt: {
          format: 'date-time',
          nullable: true,
          type: 'string',
        },
        taskCount: {
          minimum: 0,
          type: 'integer',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
      },
      required: [
        'appRole',
        'displayName',
        'email',
        'id',
        'lastSeenAt',
        'taskCount',
        'updatedAt',
      ],
      type: 'object',
    },
    AdminUserRoleUpdateInput: {
      additionalProperties: false,
      properties: {
        role: {
          $ref: '#/components/schemas/AssignableAppRole',
        },
      },
      required: ['role'],
      type: 'object',
    },
    WorkspaceSettingsUpdateInput: {
      additionalProperties: false,
      properties: {
        taskCompletionConfettiEnabled: {
          type: 'boolean',
        },
      },
      required: ['taskCompletionConfettiEnabled'],
      type: 'object',
    },
    WorkspaceUserListResponse: {
      additionalProperties: false,
      properties: {
        users: {
          items: {
            $ref: '#/components/schemas/WorkspaceUserRecord',
          },
          type: 'array',
        },
      },
      required: ['users'],
      type: 'object',
    },
    WorkspaceUserRecord: {
      additionalProperties: false,
      properties: {
        displayName: {
          type: 'string',
        },
        email: {
          type: 'string',
        },
        groupRole: nullableRefSchema('WorkspaceGroupRole'),
        id: {
          type: 'string',
        },
        isOwner: {
          type: 'boolean',
        },
        joinedAt: {
          format: 'date-time',
          type: 'string',
        },
        membershipId: {
          type: 'string',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
      },
      required: [
        'displayName',
        'email',
        'groupRole',
        'id',
        'isOwner',
        'joinedAt',
        'membershipId',
        'updatedAt',
      ],
      type: 'object',
    },
    WorkspaceUserGroupRoleUpdateInput: {
      additionalProperties: false,
      properties: {
        groupRole: {
          $ref: '#/components/schemas/AssignableWorkspaceGroupRole',
        },
      },
      required: ['groupRole'],
      type: 'object',
    },
    WorkspaceInvitationListResponse: {
      additionalProperties: false,
      properties: {
        invitations: {
          items: {
            $ref: '#/components/schemas/WorkspaceInvitationRecord',
          },
          type: 'array',
        },
      },
      required: ['invitations'],
      type: 'object',
    },
    WorkspaceInvitationRecord: {
      additionalProperties: false,
      properties: {
        email: {
          type: 'string',
        },
        groupRole: {
          $ref: '#/components/schemas/AssignableWorkspaceGroupRole',
        },
        id: {
          type: 'string',
        },
        invitedAt: {
          format: 'date-time',
          type: 'string',
        },
        updatedAt: {
          format: 'date-time',
          type: 'string',
        },
      },
      required: ['email', 'groupRole', 'id', 'invitedAt', 'updatedAt'],
      type: 'object',
    },
    WorkspaceInvitationCreateInput: {
      additionalProperties: false,
      properties: {
        email: {
          format: 'email',
          maxLength: 320,
          type: 'string',
        },
        groupRole: {
          $ref: '#/components/schemas/AssignableWorkspaceGroupRole',
        },
      },
      required: ['email'],
      type: 'object',
    },
    TaskListResponse: {
      items: {
        $ref: '#/components/schemas/TaskRecord',
      },
      type: 'array',
    },
    TaskListPageResponse: {
      additionalProperties: false,
      properties: {
        hasMore: {
          type: 'boolean',
        },
        items: {
          items: {
            $ref: '#/components/schemas/TaskRecord',
          },
          type: 'array',
        },
        limit: {
          maximum: 100,
          minimum: 1,
          type: 'integer',
        },
        nextOffset: {
          minimum: 0,
          nullable: true,
          type: 'integer',
        },
        offset: {
          minimum: 0,
          type: 'integer',
        },
      },
      required: ['hasMore', 'items', 'limit', 'nextOffset', 'offset'],
      type: 'object',
    },
    TaskTemplateListResponse: {
      items: {
        $ref: '#/components/schemas/TaskTemplateRecord',
      },
      type: 'array',
    },
    TaskEventListResponse: {
      additionalProperties: false,
      properties: {
        events: {
          items: {
            $ref: '#/components/schemas/TaskEventRecord',
          },
          type: 'array',
        },
        nextEventId: {
          minimum: 0,
          type: 'integer',
        },
      },
      required: ['events', 'nextEventId'],
      type: 'object',
    },
    TaskEventRecord: {
      additionalProperties: false,
      properties: {
        actorUserId: nullableStringSchema(),
        eventId: {
          type: 'string',
        },
        eventType: {
          type: 'string',
        },
        id: {
          minimum: 0,
          type: 'integer',
        },
        occurredAt: {
          format: 'date-time',
          type: 'string',
        },
        payload: {
          additionalProperties: true,
          type: 'object',
        },
        taskId: nullableStringSchema(),
        workspaceId: {
          type: 'string',
        },
      },
      required: [
        'actorUserId',
        'eventId',
        'eventType',
        'id',
        'occurredAt',
        'payload',
        'taskId',
        'workspaceId',
      ],
      type: 'object',
    },
    TaskRecord: {
      allOf: [
        {
          $ref: '#/components/schemas/Task',
        },
        {
          additionalProperties: false,
          properties: {
            deletedAt: nullableStringSchema(),
            updatedAt: {
              format: 'date-time',
              type: 'string',
            },
            version: positiveIntegerSchema(),
            workspaceId: {
              type: 'string',
            },
          },
          required: ['deletedAt', 'updatedAt', 'version', 'workspaceId'],
          type: 'object',
        },
      ],
    },
    TaskTemplateRecord: {
      allOf: [
        {
          $ref: '#/components/schemas/TaskTemplate',
        },
        {
          additionalProperties: false,
          properties: {
            deletedAt: nullableStringSchema(),
            updatedAt: {
              format: 'date-time',
              type: 'string',
            },
            version: positiveIntegerSchema(),
            workspaceId: {
              type: 'string',
            },
          },
          required: ['deletedAt', 'updatedAt', 'version', 'workspaceId'],
          type: 'object',
        },
      ],
    },
    TaskTemplate: {
      additionalProperties: false,
      properties: {
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        dueDate: nullableStringSchema(),
        id: {
          type: 'string',
        },
        icon: {
          type: 'string',
        },
        importance: {
          $ref: '#/components/schemas/TaskImportance',
        },
        note: {
          type: 'string',
        },
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
        project: {
          type: 'string',
        },
        projectId: nullableStringSchema(),
        title: {
          minLength: 1,
          type: 'string',
        },
        urgency: {
          $ref: '#/components/schemas/TaskUrgency',
        },
      },
      required: [
        'createdAt',
        'dueDate',
        'id',
        'icon',
        'importance',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'projectId',
        'title',
        'urgency',
      ],
      type: 'object',
    },
    Task: {
      additionalProperties: false,
      properties: {
        assigneeDisplayName: nullableStringSchema(),
        assigneeUserId: nullableStringSchema(),
        authorDisplayName: nullableStringSchema(),
        authorUserId: nullableStringSchema(),
        completedAt: nullableStringSchema(),
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        dueDate: nullableStringSchema(),
        id: {
          type: 'string',
        },
        icon: {
          type: 'string',
        },
        importance: {
          $ref: '#/components/schemas/TaskImportance',
        },
        note: {
          type: 'string',
        },
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
        project: {
          type: 'string',
        },
        projectId: nullableStringSchema(),
        remindBeforeStart: {
          type: 'boolean',
        },
        requiresConfirmation: {
          type: 'boolean',
        },
        status: {
          $ref: '#/components/schemas/TaskStatus',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
        urgency: {
          $ref: '#/components/schemas/TaskUrgency',
        },
      },
      required: [
        'assigneeDisplayName',
        'assigneeUserId',
        'authorDisplayName',
        'authorUserId',
        'completedAt',
        'createdAt',
        'dueDate',
        'id',
        'icon',
        'importance',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'projectId',
        'requiresConfirmation',
        'status',
        'title',
        'urgency',
      ],
      type: 'object',
    },
    TaskImportance: {
      enum: ['important', 'not_important'],
      type: 'string',
    },
    TaskScheduleInput: {
      additionalProperties: false,
      properties: {
        plannedDate: nullableStringSchema(),
        plannedEndTime: nullableStringSchema(),
        plannedStartTime: nullableStringSchema(),
      },
      required: ['plannedDate', 'plannedEndTime', 'plannedStartTime'],
      type: 'object',
    },
    TaskScheduleUpdateInput: {
      additionalProperties: false,
      properties: {
        expectedVersion: positiveIntegerSchema(),
        schedule: {
          $ref: '#/components/schemas/TaskScheduleInput',
        },
      },
      required: ['schedule'],
      type: 'object',
    },
    TaskStatus: {
      enum: ['done', 'in_progress', 'ready_for_review', 'todo'],
      type: 'string',
    },
    TaskStatusUpdateInput: {
      additionalProperties: false,
      properties: {
        expectedVersion: positiveIntegerSchema(),
        status: {
          $ref: '#/components/schemas/TaskStatus',
        },
      },
      required: ['status'],
      type: 'object',
    },
    TaskUrgency: {
      enum: ['not_urgent', 'urgent'],
      type: 'string',
    },
  }
}

function errorResponse(): OpenAPIV3.ResponseObject {
  return jsonResponse('ApiError')
}

function emptyResponse(description: string): OpenAPIV3.ResponseObject {
  return {
    description,
  }
}

function jsonRequestBody(schemaName: string): OpenAPIV3.RequestBodyObject {
  return {
    content: {
      'application/json': {
        schema: {
          $ref: `#/components/schemas/${schemaName}`,
        },
      },
    },
    required: true,
  }
}

function jsonResponse(schemaName: string): OpenAPIV3.ResponseObject {
  return {
    content: {
      'application/json': {
        schema: {
          $ref: `#/components/schemas/${schemaName}`,
        },
      },
    },
    description: `${schemaName} response.`,
  }
}

function nullableStringSchema(): OpenAPIV3.SchemaObject {
  return {
    nullable: true,
    type: 'string',
  }
}

function nullableRefSchema(schemaName: string): OpenAPIV3.SchemaObject {
  return {
    allOf: [
      {
        $ref: `#/components/schemas/${schemaName}`,
      },
    ],
    nullable: true,
  }
}

function parameter(name: string): OpenAPIV3.ReferenceObject {
  return {
    $ref: `#/components/parameters/${name}`,
  }
}

function positiveIntegerSchema(): OpenAPIV3.SchemaObject {
  return {
    minimum: 1,
    type: 'integer',
  }
}

function emojiSetIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'emojiSetId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

function iconAssetIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'iconAssetId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

function projectIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'projectId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

function taskIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'taskId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

function taskTemplateIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'templateId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

function membershipIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'membershipId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

function invitationIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'invitationId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}

function userIdParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'userId',
    required: true,
    schema: {
      type: 'string',
    },
  }
}
