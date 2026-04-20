import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'
import type { OpenAPIV3 } from 'openapi-types'

import type { ApiConfig } from './config.js'

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
        description: 'Current actor/workspace resolution.',
        name: 'session',
      },
      {
        description: 'Task list and task mutations.',
        name: 'tasks',
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
    NewTaskInput: {
      additionalProperties: false,
      properties: {
        dueDate: nullableStringSchema(),
        id: {
          pattern:
            '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
          type: 'string',
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
        title: {
          minLength: 1,
          type: 'string',
        },
      },
      required: [
        'dueDate',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'title',
      ],
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
        role: {
          enum: ['admin', 'member', 'owner', 'viewer'],
          type: 'string',
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
      },
      required: [
        'actor',
        'actorUserId',
        'role',
        'source',
        'workspace',
        'workspaceId',
      ],
      type: 'object',
    },
    SessionWorkspace: {
      additionalProperties: false,
      properties: {
        id: {
          type: 'string',
        },
        name: {
          type: 'string',
        },
        slug: {
          type: 'string',
        },
      },
      required: ['id', 'name', 'slug'],
      type: 'object',
    },
    TaskListResponse: {
      items: {
        $ref: '#/components/schemas/TaskRecord',
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
    Task: {
      additionalProperties: false,
      properties: {
        completedAt: nullableStringSchema(),
        createdAt: {
          format: 'date-time',
          type: 'string',
        },
        dueDate: nullableStringSchema(),
        id: {
          type: 'string',
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
        status: {
          $ref: '#/components/schemas/TaskStatus',
        },
        title: {
          minLength: 1,
          type: 'string',
        },
      },
      required: [
        'completedAt',
        'createdAt',
        'dueDate',
        'id',
        'note',
        'plannedDate',
        'plannedEndTime',
        'plannedStartTime',
        'project',
        'status',
        'title',
      ],
      type: 'object',
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
      enum: ['done', 'todo'],
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
  }
}

function errorResponse(): OpenAPIV3.ResponseObject {
  return jsonResponse('ApiError')
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
