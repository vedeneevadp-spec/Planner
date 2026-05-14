import type { OpenAPIV3 } from 'openapi-types'

import type { ApiConfig } from './config.js'

export function createOpenApiDocument(config: ApiConfig): OpenAPIV3.Document {
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
        description: 'Life sphere catalog and weekly balance statistics.',
        name: 'lifeSpheres',
      },
      {
        description: 'Daily planning state and automatic planning helpers.',
        name: 'dailyPlan',
      },
      {
        description: 'Habit routines, daily entries and statistics.',
        name: 'habits',
      },
      {
        description: 'Cleaning zones, routines and completion history.',
        name: 'cleaning',
      },
      {
        description: 'Capture inbox and shared shopping list items.',
        name: 'chaosInbox',
      },
      {
        description: 'Native push notification device registration.',
        name: 'push',
      },
      {
        description: 'Alice skill webhook and account linking.',
        name: 'alice',
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
      delete: createJsonOperation({
        noContentDescription: 'Shared workspace deleted.',
        operationId: 'deleteSharedWorkspace',
        parameters: workspaceWriteParameters(),
        security: authenticatedSecurity(),
        summary: 'Delete the current shared workspace',
        tags: ['session'],
      }),
      patch: createJsonOperation({
        operationId: 'updateSharedWorkspace',
        parameters: workspaceWriteParameters(),
        requestSchema: 'UpdateSharedWorkspaceInput',
        responseSchema: 'SessionWorkspaceMembership',
        security: authenticatedSecurity(),
        summary: 'Rename the current shared workspace',
        tags: ['session'],
      }),
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
      patch: {
        operationId: 'updateTask',
        parameters: [
          taskIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('TaskDetailsUpdateInput'),
        responses: {
          200: jsonResponse('TaskRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Update task details',
        tags: ['tasks'],
      },
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
    ...createBacklogPaths(),
  }
}

type ApiParameter = OpenAPIV3.ParameterObject | OpenAPIV3.ReferenceObject

interface JsonOperationInput {
  noContentDescription?: string
  operationId: string
  parameters?: ApiParameter[]
  requestSchema?: string
  responseSchema?: string
  responseStatus?: 200 | 201
  security?: OpenAPIV3.SecurityRequirementObject[]
  summary: string
  tags: string[]
}

function createBacklogPaths(): OpenAPIV3.PathsObject {
  return {
    '/api/v1/alice/webhook': {
      post: createJsonOperation({
        operationId: 'handleAliceWebhook',
        requestSchema: 'AliceWebhookRequest',
        responseSchema: 'AliceWebhookResponse',
        summary: 'Handle an Alice skill webhook request',
        tags: ['alice'],
      }),
    },
    '/api/v1/auth/password': {
      patch: createJsonOperation({
        operationId: 'updatePassword',
        requestSchema: 'AuthPasswordUpdateInput',
        responseSchema: 'AuthTokenResponse',
        security: authenticatedSecurity(),
        summary: 'Update the authenticated user password',
        tags: ['auth'],
      }),
    },
    '/api/v1/auth/password-reset/confirm': {
      post: createJsonOperation({
        operationId: 'confirmPasswordReset',
        requestSchema: 'AuthPasswordResetConfirmInput',
        responseSchema: 'AuthTokenResponse',
        summary: 'Complete password reset and issue a new session',
        tags: ['auth'],
      }),
    },
    '/api/v1/auth/password-reset/request': {
      post: createJsonOperation({
        noContentDescription: 'Password reset request accepted.',
        operationId: 'requestPasswordReset',
        requestSchema: 'AuthPasswordResetRequestInput',
        summary: 'Request a password reset email',
        tags: ['auth'],
      }),
    },
    '/api/v1/auth/sign-out': {
      post: createJsonOperation({
        noContentDescription: 'Auth session revoked.',
        operationId: 'signOut',
        requestSchema: 'AuthSignOutInput',
        summary: 'Sign out and revoke a refresh session',
        tags: ['auth'],
      }),
    },
    '/api/v1/chaos-inbox': {
      get: createJsonOperation({
        operationId: 'listChaosInboxItems',
        parameters: [
          ...workspaceReadParameters(),
          optionalStringQueryParameter('status'),
          optionalStringQueryParameter('kind'),
          optionalStringQueryParameter('sphereId'),
          optionalIntegerQueryParameter('page', 1),
          optionalIntegerQueryParameter('limit', 1, 200),
        ],
        responseSchema: 'ChaosInboxListRecordResponse',
        security: authenticatedSecurity(),
        summary: 'List capture inbox items',
        tags: ['chaosInbox'],
      }),
      post: createJsonOperation({
        operationId: 'createChaosInboxItems',
        parameters: workspaceWriteParameters(),
        requestSchema: 'CreateChaosInboxItemsInput',
        responseSchema: 'ChaosInboxCreatedRecordResponse',
        responseStatus: 201,
        security: authenticatedSecurity(),
        summary: 'Create capture inbox items',
        tags: ['chaosInbox'],
      }),
    },
    '/api/v1/chaos-inbox/{id}': {
      delete: createJsonOperation({
        noContentDescription: 'Capture inbox item deleted.',
        operationId: 'deleteChaosInboxItem',
        parameters: [idPathParameter('id'), ...workspaceWriteParameters()],
        security: authenticatedSecurity(),
        summary: 'Delete a capture inbox item',
        tags: ['chaosInbox'],
      }),
      patch: createJsonOperation({
        operationId: 'updateChaosInboxItem',
        parameters: [idPathParameter('id'), ...workspaceWriteParameters()],
        requestSchema: 'ChaosInboxItemUpdateInput',
        responseSchema: 'ChaosInboxItemRecord',
        security: authenticatedSecurity(),
        summary: 'Update capture inbox item metadata',
        tags: ['chaosInbox'],
      }),
    },
    '/api/v1/chaos-inbox/{id}/convert-to-task': {
      post: createJsonOperation({
        operationId: 'convertChaosInboxItemToTask',
        parameters: [idPathParameter('id'), ...workspaceWriteParameters()],
        responseSchema: 'ChaosInboxConvertToTaskRecordResponse',
        security: authenticatedSecurity(),
        summary: 'Convert a capture inbox item to a task',
        tags: ['chaosInbox'],
      }),
    },
    '/api/v1/chaos-inbox/bulk-convert-to-tasks': {
      post: createJsonOperation({
        operationId: 'bulkConvertChaosInboxItemsToTasks',
        parameters: workspaceWriteParameters(),
        requestSchema: 'IdListInput',
        responseSchema: 'ChaosInboxConvertToTaskRecordResponseList',
        security: authenticatedSecurity(),
        summary: 'Convert multiple capture inbox items to tasks',
        tags: ['chaosInbox'],
      }),
    },
    '/api/v1/chaos-inbox/bulk-delete': {
      post: createJsonOperation({
        noContentDescription: 'Capture inbox items deleted.',
        operationId: 'bulkDeleteChaosInboxItems',
        parameters: workspaceWriteParameters(),
        requestSchema: 'IdListInput',
        security: authenticatedSecurity(),
        summary: 'Delete multiple capture inbox items',
        tags: ['chaosInbox'],
      }),
    },
    '/api/v1/chaos-inbox/bulk-update': {
      post: createJsonOperation({
        operationId: 'bulkUpdateChaosInboxItems',
        parameters: workspaceWriteParameters(),
        requestSchema: 'ChaosInboxBulkUpdateInput',
        responseSchema: 'ChaosInboxCreatedRecordResponse',
        security: authenticatedSecurity(),
        summary: 'Update multiple capture inbox items',
        tags: ['chaosInbox'],
      }),
    },
    '/api/v1/cleaning': {
      get: createJsonOperation({
        operationId: 'listCleaningPlan',
        parameters: workspaceReadParameters(),
        responseSchema: 'CleaningListResponse',
        security: authenticatedSecurity(),
        summary: 'List cleaning zones, tasks, state and history',
        tags: ['cleaning'],
      }),
    },
    '/api/v1/cleaning/today': {
      get: createJsonOperation({
        operationId: 'getCleaningToday',
        parameters: [
          ...workspaceReadParameters(),
          optionalStringQueryParameter('date'),
        ],
        responseSchema: 'CleaningTodayResponse',
        security: authenticatedSecurity(),
        summary: 'Get due cleaning tasks for a date',
        tags: ['cleaning'],
      }),
    },
    '/api/v1/cleaning/tasks': {
      post: createJsonOperation({
        operationId: 'createCleaningTask',
        parameters: workspaceWriteParameters(),
        requestSchema: 'NewCleaningTaskInput',
        responseSchema: 'CleaningTaskRecord',
        responseStatus: 201,
        security: authenticatedSecurity(),
        summary: 'Create a cleaning task',
        tags: ['cleaning'],
      }),
    },
    '/api/v1/cleaning/tasks/{taskId}': {
      delete: createJsonOperation({
        noContentDescription: 'Cleaning task deleted.',
        operationId: 'deleteCleaningTask',
        parameters: [taskIdParameter(), ...workspaceWriteParameters()],
        security: authenticatedSecurity(),
        summary: 'Delete a cleaning task',
        tags: ['cleaning'],
      }),
      patch: createJsonOperation({
        operationId: 'updateCleaningTask',
        parameters: [taskIdParameter(), ...workspaceWriteParameters()],
        requestSchema: 'CleaningTaskUpdateInput',
        responseSchema: 'CleaningTaskRecord',
        security: authenticatedSecurity(),
        summary: 'Update a cleaning task',
        tags: ['cleaning'],
      }),
    },
    '/api/v1/cleaning/tasks/{taskId}/complete': {
      post: cleaningTaskActionOperation('completeCleaningTask', 'Complete'),
    },
    '/api/v1/cleaning/tasks/{taskId}/postpone': {
      post: cleaningTaskActionOperation('postponeCleaningTask', 'Postpone'),
    },
    '/api/v1/cleaning/tasks/{taskId}/skip': {
      post: cleaningTaskActionOperation('skipCleaningTask', 'Skip'),
    },
    '/api/v1/cleaning/zones': {
      post: createJsonOperation({
        operationId: 'createCleaningZone',
        parameters: workspaceWriteParameters(),
        requestSchema: 'NewCleaningZoneInput',
        responseSchema: 'CleaningZoneRecord',
        responseStatus: 201,
        security: authenticatedSecurity(),
        summary: 'Create a cleaning zone',
        tags: ['cleaning'],
      }),
    },
    '/api/v1/cleaning/zones/{zoneId}': {
      delete: createJsonOperation({
        noContentDescription: 'Cleaning zone deleted.',
        operationId: 'deleteCleaningZone',
        parameters: [zoneIdParameter(), ...workspaceWriteParameters()],
        security: authenticatedSecurity(),
        summary: 'Delete a cleaning zone',
        tags: ['cleaning'],
      }),
      patch: createJsonOperation({
        operationId: 'updateCleaningZone',
        parameters: [zoneIdParameter(), ...workspaceWriteParameters()],
        requestSchema: 'CleaningZoneUpdateInput',
        responseSchema: 'CleaningZoneRecord',
        security: authenticatedSecurity(),
        summary: 'Update a cleaning zone',
        tags: ['cleaning'],
      }),
    },
    '/api/v1/daily-plan': {
      get: createJsonOperation({
        operationId: 'getDailyPlan',
        parameters: [
          ...workspaceReadParameters(),
          requiredStringQueryParameter('date'),
        ],
        responseSchema: 'DailyPlanRecord',
        security: authenticatedSecurity(),
        summary: 'Get daily plan for a date',
        tags: ['dailyPlan'],
      }),
      put: createJsonOperation({
        operationId: 'saveDailyPlan',
        parameters: [
          ...workspaceWriteParameters(),
          requiredStringQueryParameter('date'),
        ],
        requestSchema: 'DailyPlanUpsertInput',
        responseSchema: 'DailyPlanRecord',
        security: authenticatedSecurity(),
        summary: 'Save daily plan for a date',
        tags: ['dailyPlan'],
      }),
    },
    '/api/v1/daily-plan/auto-build': {
      post: createJsonOperation({
        operationId: 'autoBuildDailyPlan',
        parameters: workspaceWriteParameters(),
        requestSchema: 'DailyPlanAutoBuildInput',
        responseSchema: 'DailyPlanRecord',
        security: authenticatedSecurity(),
        summary: 'Build a daily plan automatically',
        tags: ['dailyPlan'],
      }),
    },
    '/api/v1/daily-plan/unload': {
      post: createJsonOperation({
        operationId: 'unloadDailyPlan',
        parameters: workspaceReadParameters(),
        requestSchema: 'DailyPlanUnloadInput',
        responseSchema: 'DailyPlanUnloadResponse',
        security: authenticatedSecurity(),
        summary: 'Suggest daily plan unload actions',
        tags: ['dailyPlan'],
      }),
    },
    '/api/v1/habits': {
      get: createJsonOperation({
        operationId: 'listHabits',
        parameters: workspaceReadParameters(),
        responseSchema: 'HabitListResponse',
        security: authenticatedSecurity(),
        summary: 'List habits in a workspace',
        tags: ['habits'],
      }),
      post: createJsonOperation({
        operationId: 'createHabit',
        parameters: workspaceWriteParameters(),
        requestSchema: 'NewHabitInput',
        responseSchema: 'HabitRecord',
        responseStatus: 201,
        security: authenticatedSecurity(),
        summary: 'Create a habit',
        tags: ['habits'],
      }),
    },
    '/api/v1/habits/stats': {
      get: createJsonOperation({
        operationId: 'getHabitStats',
        parameters: [
          ...workspaceReadParameters(),
          requiredStringQueryParameter('from'),
          requiredStringQueryParameter('to'),
        ],
        responseSchema: 'HabitStatsResponse',
        security: authenticatedSecurity(),
        summary: 'Get habit statistics for a date range',
        tags: ['habits'],
      }),
    },
    '/api/v1/habits/today': {
      get: createJsonOperation({
        operationId: 'getHabitsToday',
        parameters: [
          ...workspaceReadParameters(),
          optionalStringQueryParameter('date'),
        ],
        responseSchema: 'HabitTodayResponse',
        security: authenticatedSecurity(),
        summary: 'Get habits due for a date',
        tags: ['habits'],
      }),
    },
    '/api/v1/habits/{habitId}': {
      delete: createJsonOperation({
        noContentDescription: 'Habit deleted.',
        operationId: 'deleteHabit',
        parameters: [habitIdParameter(), ...workspaceWriteParameters()],
        security: authenticatedSecurity(),
        summary: 'Delete a habit',
        tags: ['habits'],
      }),
      patch: createJsonOperation({
        operationId: 'updateHabit',
        parameters: [habitIdParameter(), ...workspaceWriteParameters()],
        requestSchema: 'HabitUpdateInput',
        responseSchema: 'HabitRecord',
        security: authenticatedSecurity(),
        summary: 'Update a habit',
        tags: ['habits'],
      }),
    },
    '/api/v1/habits/{habitId}/entries/{date}': {
      delete: createJsonOperation({
        noContentDescription: 'Habit entry deleted.',
        operationId: 'deleteHabitEntry',
        parameters: [
          habitIdParameter(),
          datePathParameter(),
          ...workspaceWriteParameters(),
        ],
        requestSchema: 'HabitEntryDeleteInput',
        security: authenticatedSecurity(),
        summary: 'Delete a habit entry',
        tags: ['habits'],
      }),
      put: createJsonOperation({
        operationId: 'upsertHabitEntry',
        parameters: [
          habitIdParameter(),
          datePathParameter(),
          ...workspaceWriteParameters(),
        ],
        requestSchema: 'HabitEntryUpsertInput',
        responseSchema: 'HabitEntryRecord',
        security: authenticatedSecurity(),
        summary: 'Create or update a habit entry',
        tags: ['habits'],
      }),
    },
    '/api/v1/icon-assets/{fileName}': {
      get: createBinaryAssetOperation(
        'getIconAsset',
        'Get an uploaded icon asset',
      ),
    },
    '/api/v1/life-spheres': {
      get: createJsonOperation({
        operationId: 'listLifeSpheres',
        parameters: workspaceReadParameters(),
        responseSchema: 'LifeSphereListResponse',
        security: authenticatedSecurity(),
        summary: 'List life spheres in a workspace',
        tags: ['lifeSpheres'],
      }),
      post: createJsonOperation({
        operationId: 'createLifeSphere',
        parameters: workspaceWriteParameters(),
        requestSchema: 'NewLifeSphereInput',
        responseSchema: 'LifeSphereRecord',
        responseStatus: 201,
        security: authenticatedSecurity(),
        summary: 'Create a life sphere',
        tags: ['lifeSpheres'],
      }),
    },
    '/api/v1/life-spheres/{sphereId}': {
      get: createJsonOperation({
        operationId: 'getLifeSphere',
        parameters: [sphereIdParameter(), ...workspaceReadParameters()],
        responseSchema: 'LifeSphereRecord',
        security: authenticatedSecurity(),
        summary: 'Get a life sphere',
        tags: ['lifeSpheres'],
      }),
      delete: createJsonOperation({
        noContentDescription: 'Life sphere deleted.',
        operationId: 'deleteLifeSphere',
        parameters: [sphereIdParameter(), ...workspaceWriteParameters()],
        security: authenticatedSecurity(),
        summary: 'Delete a life sphere',
        tags: ['lifeSpheres'],
      }),
      patch: createJsonOperation({
        operationId: 'updateLifeSphere',
        parameters: [sphereIdParameter(), ...workspaceWriteParameters()],
        requestSchema: 'LifeSphereUpdateInput',
        responseSchema: 'LifeSphereRecord',
        security: authenticatedSecurity(),
        summary: 'Update a life sphere',
        tags: ['lifeSpheres'],
      }),
    },
    '/api/v1/life-spheres/weekly-stats': {
      get: createJsonOperation({
        operationId: 'getLifeSphereWeeklyStats',
        parameters: [
          ...workspaceReadParameters(),
          requiredStringQueryParameter('from'),
          requiredStringQueryParameter('to'),
        ],
        responseSchema: 'WeeklySphereStatsRecordResponse',
        security: authenticatedSecurity(),
        summary: 'Get weekly life sphere statistics',
        tags: ['lifeSpheres'],
      }),
    },
    '/api/v1/oauth/alice/authorize': {
      get: createHtmlOperation(
        'getAliceOAuthAuthorizePage',
        'Render Alice OAuth authorization page',
      ),
      post: createHtmlOperation(
        'submitAliceOAuthAuthorizePage',
        'Submit Alice OAuth authorization form',
        {
          requestSchema: 'AliceOAuthAuthorizeForm',
        },
      ),
    },
    '/api/v1/oauth/alice/token': {
      post: createJsonOperation({
        operationId: 'exchangeAliceOAuthToken',
        requestSchema: 'AliceOAuthTokenRequest',
        responseSchema: 'AliceOAuthTokenResponse',
        summary: 'Exchange Alice OAuth authorization code or refresh token',
        tags: ['alice'],
      }),
    },
    '/api/v1/profile': {
      patch: createJsonOperation({
        operationId: 'updateUserProfile',
        parameters: workspaceWriteParameters(),
        requestSchema: 'UpdateUserProfileInput',
        responseSchema: 'UserProfile',
        security: authenticatedSecurity(),
        summary: 'Update current user profile',
        tags: ['session'],
      }),
    },
    '/api/v1/profile-assets/{fileName}': {
      get: createBinaryAssetOperation(
        'getProfileAvatarAsset',
        'Get an uploaded profile avatar asset',
      ),
    },
    '/api/v1/push/devices': {
      put: createJsonOperation({
        operationId: 'upsertPushDevice',
        parameters: workspaceWriteParameters(),
        requestSchema: 'PushDeviceUpsertInput',
        responseSchema: 'PushDeviceRecord',
        security: authenticatedSecurity(),
        summary: 'Register or update a native push device',
        tags: ['push'],
      }),
    },
    '/api/v1/push/devices/{installationId}': {
      delete: createJsonOperation({
        noContentDescription: 'Push device deleted.',
        operationId: 'deletePushDevice',
        parameters: [installationIdParameter(), ...workspaceWriteParameters()],
        security: authenticatedSecurity(),
        summary: 'Delete a native push device',
        tags: ['push'],
      }),
    },
    '/api/v1/push/test': {
      post: createJsonOperation({
        operationId: 'sendTestPushNotification',
        parameters: workspaceWriteParameters(),
        requestSchema: 'PushTestNotificationInput',
        responseSchema: 'PushTestNotificationResponse',
        security: authenticatedSecurity(),
        summary: 'Send a test push notification',
        tags: ['push'],
      }),
    },
  }
}

function createJsonOperation(
  input: JsonOperationInput,
): OpenAPIV3.OperationObject {
  const successResponses: OpenAPIV3.ResponsesObject =
    input.noContentDescription !== undefined
      ? {
          204: emptyResponse(input.noContentDescription),
        }
      : {
          [input.responseStatus ?? 200]: jsonResponse(
            input.responseSchema ?? 'JsonObject',
          ),
        }

  return {
    operationId: input.operationId,
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestSchema
      ? { requestBody: jsonRequestBody(input.requestSchema) }
      : {}),
    responses: {
      ...successResponses,
      400: errorResponse(),
      401: errorResponse(),
      403: errorResponse(),
      404: errorResponse(),
      409: errorResponse(),
      429: errorResponse(),
      503: errorResponse(),
    },
    ...(input.security ? { security: input.security } : {}),
    summary: input.summary,
    tags: input.tags,
  }
}

function createHtmlOperation(
  operationId: string,
  summary: string,
  input: { requestSchema?: string } = {},
): OpenAPIV3.OperationObject {
  return {
    operationId,
    ...(input.requestSchema
      ? { requestBody: jsonRequestBody(input.requestSchema) }
      : {}),
    responses: {
      200: {
        content: {
          'text/html': {
            schema: {
              type: 'string',
            },
          },
        },
        description: 'HTML response.',
      },
      302: emptyResponse('Redirect to the OAuth callback URL.'),
      400: {
        content: {
          'text/html': {
            schema: {
              type: 'string',
            },
          },
        },
        description: 'HTML validation error response.',
      },
      401: {
        content: {
          'text/html': {
            schema: {
              type: 'string',
            },
          },
        },
        description: 'HTML authentication error response.',
      },
      409: {
        content: {
          'text/html': {
            schema: {
              type: 'string',
            },
          },
        },
        description: 'HTML conflict response.',
      },
    },
    summary,
    tags: ['alice'],
  }
}

function createBinaryAssetOperation(
  operationId: string,
  summary: string,
): OpenAPIV3.OperationObject {
  return {
    operationId,
    parameters: [fileNameParameter()],
    responses: {
      200: {
        content: {
          'image/*': {
            schema: {
              format: 'binary',
              type: 'string',
            },
          },
        },
        description: 'Binary image asset.',
      },
      400: errorResponse(),
      404: errorResponse(),
    },
    summary,
    tags: ['emojiSets'],
  }
}

function cleaningTaskActionOperation(
  operationId: string,
  verb: string,
): OpenAPIV3.OperationObject {
  return createJsonOperation({
    operationId,
    parameters: [taskIdParameter(), ...workspaceWriteParameters()],
    requestSchema: 'CleaningTaskActionInput',
    responseSchema: 'CleaningTaskActionResponse',
    security: authenticatedSecurity(),
    summary: `${verb} a cleaning task`,
    tags: ['cleaning'],
  })
}

function authenticatedSecurity(): OpenAPIV3.SecurityRequirementObject[] {
  return [{ bearerAuth: [] }, {}]
}

function workspaceReadParameters(): ApiParameter[] {
  return [parameter('requiredWorkspaceIdHeader')]
}

function workspaceWriteParameters(): ApiParameter[] {
  return [
    parameter('requiredWorkspaceIdHeader'),
    parameter('actorUserIdHeader'),
  ]
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
    JsonObject: genericJsonObjectSchema(),
    AliceOAuthAuthorizeForm: genericJsonObjectSchema(),
    AliceOAuthTokenRequest: genericJsonObjectSchema(),
    AliceOAuthTokenResponse: genericJsonObjectSchema(),
    AliceWebhookRequest: genericJsonObjectSchema(),
    AliceWebhookResponse: genericJsonObjectSchema(),
    AuthPasswordResetConfirmInput: {
      additionalProperties: false,
      properties: {
        password: {
          maxLength: 128,
          minLength: 6,
          type: 'string',
        },
        token: {
          minLength: 1,
          type: 'string',
        },
      },
      required: ['password', 'token'],
      type: 'object',
    },
    AuthPasswordResetRequestInput: {
      additionalProperties: false,
      properties: {
        email: {
          format: 'email',
          maxLength: 320,
          type: 'string',
        },
      },
      required: ['email'],
      type: 'object',
    },
    AuthPasswordUpdateInput: {
      additionalProperties: false,
      properties: {
        currentPassword: {
          maxLength: 128,
          minLength: 1,
          type: 'string',
        },
        password: {
          maxLength: 128,
          minLength: 6,
          type: 'string',
        },
      },
      required: ['currentPassword', 'password'],
      type: 'object',
    },
    AuthSignOutInput: {
      allOf: [
        {
          $ref: '#/components/schemas/AuthRefreshInput',
        },
      ],
    },
    ChaosInboxBulkUpdateInput: genericJsonObjectSchema(),
    ChaosInboxConvertToTaskRecordResponse: genericJsonObjectSchema(),
    ChaosInboxConvertToTaskRecordResponseList: genericJsonArraySchema(
      'ChaosInboxConvertToTaskRecordResponse',
    ),
    ChaosInboxCreatedRecordResponse: genericJsonObjectSchema(),
    ChaosInboxItemRecord: genericJsonObjectSchema(),
    ChaosInboxItemUpdateInput: genericJsonObjectSchema(),
    ChaosInboxListRecordResponse: genericJsonObjectSchema(),
    CleaningListResponse: genericJsonObjectSchema(),
    CleaningTaskActionInput: genericJsonObjectSchema(),
    CleaningTaskActionResponse: genericJsonObjectSchema(),
    CleaningTaskRecord: genericJsonObjectSchema(),
    CleaningTaskUpdateInput: genericJsonObjectSchema(),
    CleaningTodayResponse: genericJsonObjectSchema(),
    CleaningZoneRecord: genericJsonObjectSchema(),
    CleaningZoneUpdateInput: genericJsonObjectSchema(),
    CreateChaosInboxItemsInput: genericJsonObjectSchema(),
    DailyPlanAutoBuildInput: genericJsonObjectSchema(),
    DailyPlanRecord: genericJsonObjectSchema(),
    DailyPlanUnloadInput: genericJsonObjectSchema(),
    DailyPlanUnloadResponse: genericJsonObjectSchema(),
    DailyPlanUpsertInput: genericJsonObjectSchema(),
    HabitEntryDeleteInput: genericJsonObjectSchema(),
    HabitEntryRecord: genericJsonObjectSchema(),
    HabitEntryUpsertInput: genericJsonObjectSchema(),
    HabitListResponse: genericJsonArraySchema('HabitRecord'),
    HabitRecord: genericJsonObjectSchema(),
    HabitStatsResponse: genericJsonObjectSchema(),
    HabitTodayResponse: genericJsonObjectSchema(),
    HabitUpdateInput: genericJsonObjectSchema(),
    IdListInput: {
      additionalProperties: false,
      properties: {
        ids: {
          items: {
            minLength: 1,
            type: 'string',
          },
          maxItems: 200,
          minItems: 1,
          type: 'array',
        },
      },
      required: ['ids'],
      type: 'object',
    },
    LifeSphereListResponse: genericJsonArraySchema('LifeSphereRecord'),
    LifeSphereRecord: genericJsonObjectSchema(),
    LifeSphereUpdateInput: genericJsonObjectSchema(),
    NewCleaningTaskInput: genericJsonObjectSchema(),
    NewCleaningZoneInput: genericJsonObjectSchema(),
    NewHabitInput: genericJsonObjectSchema(),
    NewLifeSphereInput: genericJsonObjectSchema(),
    PushDeviceRecord: genericJsonObjectSchema(),
    PushDeviceUpsertInput: genericJsonObjectSchema(),
    PushTestNotificationInput: genericJsonObjectSchema(),
    PushTestNotificationResponse: genericJsonObjectSchema(),
    UpdateSharedWorkspaceInput: {
      additionalProperties: false,
      properties: {
        name: {
          maxLength: 80,
          minLength: 1,
          type: 'string',
        },
      },
      required: ['name'],
      type: 'object',
    },
    UpdateUserProfileInput: genericJsonObjectSchema(),
    UserProfile: genericJsonObjectSchema(),
    WeeklySphereStatsRecordResponse: genericJsonObjectSchema(),
    AuthRefreshInput: {
      additionalProperties: false,
      properties: {
        refreshToken: {
          description:
            'Optional for browser clients that use the HttpOnly refresh cookie.',
          minLength: 1,
          type: 'string',
        },
      },
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
          description:
            'Returned only for native clients that request body token transport.',
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
      required: ['accessToken', 'expiresAt', 'user'],
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
        resource: {
          $ref: '#/components/schemas/TaskResource',
        },
        requiresConfirmation: {
          type: 'boolean',
        },
        sphereId: nullableStringSchema(),
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
        resource: {
          $ref: '#/components/schemas/TaskResource',
        },
        requiresConfirmation: {
          type: 'boolean',
        },
        sphereId: nullableStringSchema(),
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
        'resource',
        'requiresConfirmation',
        'sphereId',
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
    TaskResource: {
      maximum: 5,
      minimum: -5,
      nullable: true,
      type: 'integer',
    },
    TaskDetailsUpdateInput: {
      allOf: [
        {
          $ref: '#/components/schemas/NewTaskInput',
        },
        {
          additionalProperties: false,
          properties: {
            expectedVersion: positiveIntegerSchema(),
          },
          type: 'object',
        },
      ],
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

function genericJsonObjectSchema(): OpenAPIV3.SchemaObject {
  return {
    additionalProperties: true,
    type: 'object',
  }
}

function genericJsonArraySchema(
  itemSchemaName: string,
): OpenAPIV3.SchemaObject {
  return {
    items: {
      $ref: `#/components/schemas/${itemSchemaName}`,
    },
    type: 'array',
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

function idPathParameter(name: string): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name,
    required: true,
    schema: {
      type: 'string',
    },
  }
}

function datePathParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('date')
}

function fileNameParameter(): OpenAPIV3.ParameterObject {
  return {
    in: 'path',
    name: 'fileName',
    required: true,
    schema: {
      maxLength: 260,
      pattern: '^[a-z0-9][a-z0-9._-]*$',
      type: 'string',
    },
  }
}

function habitIdParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('habitId')
}

function installationIdParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('installationId')
}

function sphereIdParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('sphereId')
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

function zoneIdParameter(): OpenAPIV3.ParameterObject {
  return idPathParameter('zoneId')
}

function requiredStringQueryParameter(name: string): OpenAPIV3.ParameterObject {
  return {
    in: 'query',
    name,
    required: true,
    schema: {
      minLength: 1,
      type: 'string',
    },
  }
}

function optionalStringQueryParameter(name: string): OpenAPIV3.ParameterObject {
  return {
    in: 'query',
    name,
    required: false,
    schema: {
      type: 'string',
    },
  }
}

function optionalIntegerQueryParameter(
  name: string,
  minimum: number,
  maximum?: number,
): OpenAPIV3.ParameterObject {
  return {
    in: 'query',
    name,
    required: false,
    schema: {
      ...(maximum !== undefined ? { maximum } : {}),
      minimum,
      type: 'integer',
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
