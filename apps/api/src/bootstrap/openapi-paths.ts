import type { OpenAPIV3 } from 'openapi-types'

import {
  datePathParameter,
  emojiSetIdParameter,
  emptyResponse,
  errorResponse,
  fileNameParameter,
  habitIdParameter,
  iconAssetIdParameter,
  idPathParameter,
  installationIdParameter,
  invitationIdParameter,
  jsonRequestBody,
  jsonResponse,
  membershipIdParameter,
  optionalIntegerQueryParameter,
  optionalStringQueryParameter,
  parameter,
  positiveIntegerSchema,
  requiredStringQueryParameter,
  sphereIdParameter,
  taskIdParameter,
  taskTemplateIdParameter,
  userIdParameter,
  zoneIdParameter,
} from './openapi-helpers.js'

export function createPaths(): OpenAPIV3.PathsObject {
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
    '/api/v1/workspaces/shared/leave': {
      post: createJsonOperation({
        noContentDescription: 'Shared workspace left.',
        operationId: 'leaveSharedWorkspace',
        parameters: workspaceWriteParameters(),
        security: authenticatedSecurity(),
        summary: 'Leave the current shared workspace',
        tags: ['session'],
      }),
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
    '/api/v1/workspace-invitations/me': {
      get: createJsonOperation({
        operationId: 'listReceivedWorkspaceInvitations',
        parameters: [
          parameter('optionalWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        responseSchema: 'ReceivedWorkspaceInvitationListResponse',
        security: authenticatedSecurity(),
        summary: 'List workspace invitations for the current actor',
        tags: ['session'],
      }),
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
    '/api/v1/workspace-invitations/{invitationId}/accept': {
      post: createJsonOperation({
        noContentDescription: 'Invitation accepted.',
        operationId: 'acceptWorkspaceInvitation',
        parameters: [
          invitationIdParameter(),
          parameter('optionalWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        security: authenticatedSecurity(),
        summary: 'Accept a workspace invitation',
        tags: ['session'],
      }),
    },
    '/api/v1/workspace-invitations/{invitationId}/decline': {
      post: createJsonOperation({
        noContentDescription: 'Invitation declined.',
        operationId: 'declineWorkspaceInvitation',
        parameters: [
          invitationIdParameter(),
          parameter('optionalWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        security: authenticatedSecurity(),
        summary: 'Decline a workspace invitation',
        tags: ['session'],
      }),
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
    '/api/v1/tasks/{taskId}/copy-to-personal': {
      post: {
        operationId: 'copyTaskToPersonal',
        parameters: [
          taskIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('TaskPersonalTransferInput'),
        responses: {
          200: jsonResponse('TaskRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Create a linked personal copy of a shared task',
        tags: ['tasks'],
      },
    },
    '/api/v1/tasks/{taskId}/move-to-personal': {
      post: {
        operationId: 'moveTaskToPersonal',
        parameters: [
          taskIdParameter(),
          parameter('requiredWorkspaceIdHeader'),
          parameter('actorUserIdHeader'),
        ],
        requestBody: jsonRequestBody('TaskPersonalTransferInput'),
        responses: {
          200: jsonResponse('TaskRecord'),
          400: errorResponse(),
          401: errorResponse(),
          403: errorResponse(),
          404: errorResponse(),
          409: errorResponse(),
        },
        security: [{ bearerAuth: [] }, {}],
        summary: 'Move an authored shared task to personal workspace',
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
    '/api/v1/preferences': {
      patch: createJsonOperation({
        operationId: 'updateUserPreferences',
        parameters: workspaceWriteParameters(),
        requestSchema: 'UserPreferencesUpdateInput',
        responseSchema: 'UserPreferences',
        security: authenticatedSecurity(),
        summary: 'Update current user preferences',
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
