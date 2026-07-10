import assert from 'node:assert/strict'

import {
  cleaningFrequencyTypeSchema,
  cleaningTaskScopeSchema,
  habitFrequencySchema,
  habitTargetTypeSchema,
  selfCareCategorySchema,
  selfCareFlexiblePeriodSchema,
  selfCareImportanceSchema,
  selfCareIntervalUnitSchema,
  selfCareItemTypeSchema,
  selfCareReminderToneSchema,
  selfCareRepeatKindSchema,
  selfCareTimeOfDaySchema,
} from '@planner/contracts'

import { getRegisteredApiRoutes } from '../apps/api/src/bootstrap/route-registry.ts'
import { createApiKernel, destroyApiKernel } from '../apps/api/src/main.ts'

const DOCUMENTATION_ROUTES = new Set([routeKey('get', '/api/openapi.json')])

const DOCUMENTATION_ROUTE_PREFIXES = ['get /api/docs']

const OPTIONAL_DOCUMENTED_ROUTES = new Set([
  routeKey('patch', '/api/v1/auth/password'),
  routeKey('post', '/api/v1/auth/password-reset/confirm'),
  routeKey('post', '/api/v1/auth/password-reset/request'),
  routeKey('post', '/api/v1/auth/refresh'),
  routeKey('post', '/api/v1/auth/sign-in'),
  routeKey('post', '/api/v1/auth/sign-out'),
  routeKey('post', '/api/v1/auth/sign-up'),
  routeKey('get', '/api/v1/oauth/alice/authorize'),
  routeKey('post', '/api/v1/oauth/alice/authorize'),
  routeKey('post', '/api/v1/oauth/alice/token'),
])

const OPENAPI_DOCUMENTATION_BACKLOG = new Set([
  // Follow-up: document the ChatGPT MCP/OAuth root endpoints once public API docs
  // include non-/api integration surfaces. Current MCP docs live in
  // docs/mcp-haotika-chatgpt.md and /docs/mcp-haotika.
  routeKey('get', '/.well-known/oauth-authorization-server'),
  routeKey('get', '/.well-known/oauth-protected-resource'),
  routeKey('get', '/docs/mcp-haotika'),
  routeKey('get', '/oauth/authorize'),
  routeKey('post', '/mcp'),
  routeKey('post', '/oauth/authorize'),
  routeKey('post', '/oauth/revoke'),
  routeKey('post', '/oauth/token'),
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
    '/api/ready',
    '/api/metrics',
    '/api/v1/auth/sign-in',
    '/api/v1/auth/sign-up',
    '/api/v1/session',
    '/api/v1/emoji-sets',
    '/api/v1/life-spheres',
    '/api/v1/tasks',
    '/api/v1/tasks/page',
    '/api/v1/tasks/{taskId}/status',
    '/api/v1/task-templates',
    '/api/v1/self-care',
    '/api/v1/self-care/dashboard',
    '/api/v1/self-care/plan',
  ]
  const requiredSchemas = [
    'ApiError',
    'HealthResponse',
    'SessionResponse',
    'TaskRecord',
    'TaskListPageResponse',
    'TaskTemplateRecord',
    'EmojiSetRecord',
    'LifeSphereRecord',
    'SelfCareDashboardResponse',
    'SelfCareItem',
    'SelfCareListResponse',
    'SelfCareOccurrence',
    'SelfCareRitualStepDraftListResponse',
    'SelfCareSettingsResponse',
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
  assertSchemaProperties(document, 'CleaningTaskRecord', [
    'frequencyType',
    'workspaceId',
    'zoneId',
  ])
  assertSchemaProperties(document, 'CleaningTodayResponse', [
    'items',
    'summary',
    'zones',
  ])
  assertSchemaProperties(document, 'CleaningZoneRecord', [
    'dayOfWeek',
    'title',
    'workspaceId',
  ])
  assertSchemaProperties(document, 'NewCleaningTaskInput', ['title', 'zoneId'])
  assertSchemaProperties(document, 'NewCleaningZoneInput', [
    'dayOfWeek',
    'title',
  ])
  assertSchemaProperties(document, 'HabitEntryRecord', [
    'date',
    'habitId',
    'workspaceId',
  ])
  assertSchemaProperties(document, 'HabitRecord', [
    'frequency',
    'targetType',
    'workspaceId',
  ])
  assertSchemaProperties(document, 'HabitStatsResponse', [
    'habits',
    'stats',
    'to',
  ])
  assertSchemaProperties(document, 'HabitTodayResponse', ['date', 'items'])
  assertSchemaProperties(document, 'NewHabitInput', ['title'])
  assertSchemaProperties(document, 'SelfCareAnalyticsResponse', [
    'balanceByCategory',
    'completionsByDay',
    'selectedSelfCareCount',
  ])
  assertSchemaProperties(document, 'SelfCareCompletion', [
    'completedAt',
    'itemId',
    'status',
  ])
  assertSchemaProperties(document, 'SelfCareDashboardResponse', [
    'date',
    'settings',
    'todayItems',
  ])
  assertSchemaProperties(document, 'SelfCareItem', [
    'category',
    'id',
    'title',
    'type',
    'version',
    'workspaceId',
  ])
  assertSchemaProperties(document, 'SelfCareItemInput', [
    'category',
    'scheduleRule',
    'title',
    'type',
  ])
  assertSchemaProperties(document, 'SelfCareListResponse', [
    'items',
    'scheduleRules',
    'steps',
  ])
  assertSchemaProperties(document, 'SelfCareOccurrence', [
    'itemId',
    'scheduledFor',
    'status',
  ])
  assertSchemaProperties(document, 'SelfCarePlanResponse', [
    'from',
    'occurrences',
    'to',
  ])
  assertSchemaProperties(document, 'SelfCareRitualStepDraftListResponse', [
    'date',
    'drafts',
  ])
  assertSchemaProperties(document, 'SelfCareSettingsResponse', [
    'minimumItems',
    'settings',
  ])
  assertSchemaPropertyEnumMatches(
    document,
    'CleaningTaskRecord',
    'frequencyType',
    cleaningFrequencyTypeSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'CleaningTaskRecord',
    'scope',
    cleaningTaskScopeSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'HabitRecord',
    'frequency',
    habitFrequencySchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'HabitRecord',
    'targetType',
    habitTargetTypeSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareItem',
    'category',
    selfCareCategorySchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareItem',
    'importance',
    selfCareImportanceSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareItem',
    'preferredTimeOfDay',
    selfCareTimeOfDaySchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareItem',
    'type',
    selfCareItemTypeSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareItemInput',
    'category',
    selfCareCategorySchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareItemInput',
    'type',
    selfCareItemTypeSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareScheduleRule',
    'flexiblePeriod',
    selfCareFlexiblePeriodSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareScheduleRule',
    'intervalUnit',
    selfCareIntervalUnitSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareScheduleRule',
    'repeatKind',
    selfCareRepeatKindSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareScheduleRuleInput',
    'repeatKind',
    selfCareRepeatKindSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareSettings',
    'defaultReminderTone',
    selfCareReminderToneSchema.options,
  )
  assertSchemaPropertyEnumMatches(
    document,
    'SelfCareTodayItem',
    'timeGroup',
    selfCareTimeOfDaySchema.options,
  )

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

function assertSchemaPropertyEnumMatches(
  document,
  schemaName,
  property,
  expectedValues,
) {
  const schema = document.components?.schemas?.[schemaName]

  assert.ok(schema, `OpenAPI schema is missing: ${schemaName}`)

  const propertySchema = schema.properties?.[property]

  assert.ok(
    isRecord(propertySchema),
    `OpenAPI schema ${schemaName}.${property} is missing an object schema.`,
  )
  assert.deepEqual(
    propertySchema.enum,
    [...expectedValues],
    `OpenAPI enum ${schemaName}.${property} must match @planner/contracts.`,
  )
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
