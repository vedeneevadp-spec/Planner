import assert from 'node:assert/strict'

import { getRegisteredApiRoutes } from '../apps/api/src/bootstrap/route-registry.ts'
import { createApiKernel, destroyApiKernel } from '../apps/api/src/main.ts'

const DOCUMENTATION_ROUTES = new Set([routeKey('get', '/api/openapi.json')])

const DOCUMENTATION_ROUTE_PREFIXES = ['get /api/docs']

const OPTIONAL_DOCUMENTED_ROUTES = new Set([
  routeKey('post', '/api/v1/auth/refresh'),
  routeKey('post', '/api/v1/auth/sign-in'),
  routeKey('post', '/api/v1/auth/sign-up'),
])

const OPENAPI_DOCUMENTATION_BACKLOG = new Set([
  routeKey('post', '/api/v1/alice/webhook'),
  routeKey('patch', '/api/v1/auth/password'),
  routeKey('post', '/api/v1/auth/password-reset/confirm'),
  routeKey('post', '/api/v1/auth/password-reset/request'),
  routeKey('post', '/api/v1/auth/sign-out'),
  routeKey('post', '/api/v1/chaos-inbox'),
  routeKey('get', '/api/v1/chaos-inbox'),
  routeKey('patch', '/api/v1/chaos-inbox/{id}'),
  routeKey('delete', '/api/v1/chaos-inbox/{id}'),
  routeKey('post', '/api/v1/chaos-inbox/{id}/convert-to-task'),
  routeKey('post', '/api/v1/chaos-inbox/bulk-update'),
  routeKey('post', '/api/v1/chaos-inbox/bulk-delete'),
  routeKey('post', '/api/v1/chaos-inbox/bulk-convert-to-tasks'),
  routeKey('get', '/api/v1/daily-plan'),
  routeKey('put', '/api/v1/daily-plan'),
  routeKey('post', '/api/v1/daily-plan/auto-build'),
  routeKey('post', '/api/v1/daily-plan/unload'),
  routeKey('get', '/api/v1/icon-assets/{fileName}'),
  routeKey('get', '/api/v1/life-spheres'),
  routeKey('post', '/api/v1/life-spheres'),
  routeKey('patch', '/api/v1/life-spheres/{sphereId}'),
  routeKey('delete', '/api/v1/life-spheres/{sphereId}'),
  routeKey('get', '/api/v1/life-spheres/weekly-stats'),
  routeKey('get', '/api/v1/oauth/alice/authorize'),
  routeKey('post', '/api/v1/oauth/alice/authorize'),
  routeKey('post', '/api/v1/oauth/alice/token'),
  routeKey('get', '/api/v1/profile-assets/{fileName}'),
  routeKey('patch', '/api/v1/profile'),
  routeKey('put', '/api/v1/push/devices'),
  routeKey('delete', '/api/v1/push/devices/{installationId}'),
  routeKey('post', '/api/v1/push/test'),
  routeKey('patch', '/api/v1/workspaces/shared'),
  routeKey('delete', '/api/v1/workspaces/shared'),
])

const kernel = createApiKernel({
  API_AUTH_MODE: 'disabled',
  API_STORAGE_DRIVER: 'memory',
  NODE_ENV: 'test',
})

try {
  const response = await kernel.app.inject({
    method: 'GET',
    url: '/api/openapi.json',
  })
  assert.equal(response.statusCode, 200)

  const document = response.json()
  const registeredRoutes = getRegisteredApiRoutes(kernel.app)
  const actualRouteKeys = new Set(
    registeredRoutes.map((route) => routeKey(route.method, route.path)),
  )
  const documentedRouteKeys = collectDocumentedRouteKeys(document)
  const requiredPaths = [
    '/api/health',
    '/api/metrics',
    '/api/v1/auth/sign-in',
    '/api/v1/auth/sign-up',
    '/api/v1/session',
    '/api/v1/emoji-sets',
    '/api/v1/projects',
    '/api/v1/tasks',
    '/api/v1/tasks/page',
    '/api/v1/tasks/{taskId}/status',
    '/api/v1/task-templates',
  ]
  const requiredSchemas = [
    'ApiError',
    'HealthResponse',
    'SessionResponse',
    'TaskRecord',
    'TaskListPageResponse',
    'TaskTemplateRecord',
    'EmojiSetRecord',
    'ProjectRecord',
  ]

  for (const path of requiredPaths) {
    assert.ok(document.paths?.[path], `OpenAPI path is missing: ${path}`)
  }

  for (const schema of requiredSchemas) {
    assert.ok(
      document.components?.schemas?.[schema],
      `OpenAPI schema is missing: ${schema}`,
    )
  }

  assertSchemaProperties(document, 'NewTaskInput', ['resource', 'sphereId'])
  assertSchemaProperties(document, 'Task', ['resource', 'sphereId'])

  const missingOpenApiRoutes = registeredRoutes
    .map((route) => routeKey(route.method, route.path))
    .filter(
      (key) =>
        !DOCUMENTATION_ROUTES.has(key) &&
        !DOCUMENTATION_ROUTE_PREFIXES.some((prefix) =>
          key.startsWith(prefix),
        ) &&
        !OPENAPI_DOCUMENTATION_BACKLOG.has(key) &&
        !documentedRouteKeys.has(key),
    )
    .sort()

  assert.deepEqual(
    missingOpenApiRoutes,
    [],
    [
      'Fastify routes are missing from OpenAPI.',
      'Document the route in apps/api/src/bootstrap/openapi.ts, or add a temporary entry to OPENAPI_DOCUMENTATION_BACKLOG with an explicit follow-up.',
    ].join(' '),
  )

  const staleOpenApiRoutes = [...documentedRouteKeys]
    .filter(
      (key) =>
        !actualRouteKeys.has(key) && !OPTIONAL_DOCUMENTED_ROUTES.has(key),
    )
    .sort()

  assert.deepEqual(
    staleOpenApiRoutes,
    [],
    'OpenAPI contains routes that are no longer registered in Fastify.',
  )

  assert.equal(
    document.components.schemas.ApiError.properties.error.properties.details
      .nullable,
    true,
    'ApiError.details must remain documented for diagnostic metadata.',
  )

  console.log('OpenAPI contract check passed.')
} finally {
  await destroyApiKernel(kernel)
}

function collectDocumentedRouteKeys(document) {
  const keys = new Set()
  const paths = document.paths ?? {}

  for (const [path, pathItem] of Object.entries(paths)) {
    if (!isRecord(pathItem)) {
      continue
    }

    for (const method of ['delete', 'get', 'patch', 'post', 'put']) {
      if (method in pathItem) {
        keys.add(routeKey(method, path))
      }
    }
  }

  return keys
}

function routeKey(method, path) {
  return `${method.toLowerCase()} ${path}`
}

function assertSchemaProperties(document, schemaName, properties) {
  const schema = document.components?.schemas?.[schemaName]

  assert.ok(schema, `OpenAPI schema is missing: ${schemaName}`)

  for (const property of properties) {
    assert.ok(
      schema.properties?.[property],
      `OpenAPI schema ${schemaName} is missing property: ${property}`,
    )
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
