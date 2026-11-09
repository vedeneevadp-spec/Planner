import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import type { FastifyInstance } from 'fastify'

import type { ApiConfig } from './config.js'
import { createOpenApiDocument } from './openapi-document.js'
import { createPublicOpenApiDocument } from './openapi-public.js'

// noinspection SqlNoDataSourceInspection
export function registerOpenApi(app: FastifyInstance, config: ApiConfig): void {
  const document = createOpenApiDocument(config)
  const publicDocument = createPublicOpenApiDocument(document)
  app.register(swagger, {
    mode: 'static',
    specification: {
      document,
    },
  })

  app.register(swaggerUi, {
    routePrefix: '/api/docs',
    staticCSP: true,
    transformSpecification: () => publicDocument,
    transformSpecificationClone: false,
    uiConfig: {
      deepLinking: true,
      docExpansion: 'list',
    },
  })

  app.get('/api/openapi.json', () => publicDocument)
}
