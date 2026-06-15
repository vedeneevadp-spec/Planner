import type { OpenAPIV3 } from 'openapi-types'

import type { ApiConfig } from './config.js'
import { createComponentSchemas } from './openapi-components.js'
import { createPaths } from './openapi-paths.js'

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
        description:
          'Private self-care items, rituals, procedures, appointments, state tracking and analytics.',
        name: 'selfCare',
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
        description: 'Voice command STT upload and PlannerIntent parsing.',
        name: 'voice',
      },
      {
        description: 'Alice skill webhook and account linking.',
        name: 'alice',
      },
    ],
  }
}
