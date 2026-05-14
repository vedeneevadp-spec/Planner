import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'

import type { ApiConfig } from './config.js'
import { createOpenApiDocument } from './openapi-document.js'

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
