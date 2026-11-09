import assert from 'node:assert/strict'
import { assertRouteContracts } from './openapi-route-contracts.mjs'

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

const SEPARATE_MCP_DOCUMENTATION_ROUTES = new Set([
  // The ChatGPT MCP/OAuth protocol has its own documentation in
  // docs/mcp-haotika-chatgpt.md and /docs/mcp-haotika, separate from REST.
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
  API_AUTH_MODE: 'jwt',
  API_STORAGE_DRIVER: 'postgres',
  DATABASE_URL: 'postgres://openapi:openapi@127.0.0.1:1/openapi',
  AUTH_JWT_SECRET: 'openapi-check-only-secret-at-least-32-characters',
  NODE_ENV: 'test',
})

try {
  const response = await kernel.app.inject({
    method: 'GET',
    url: '/api/openapi.json',
  })
  assert.equal(response.statusCode, 200)

  const publicDocument = response.json()
  const document = kernel.app.swagger()
  assert.deepEqual(
    [...collectDocumentedRouteKeys(publicDocument)].sort(),
    [...collectDocumentedRouteKeys(document)]
      .filter((key) => key.includes(' /api/public/v1/'))
      .sort(),
  )
  assert.equal(collectDocumentedRouteKeys(publicDocument).size, 9)
  assert.deepEqual(Object.keys(publicDocument.components.securitySchemes), [
    'apiKeyAuth',
  ])
  for (const schema of [
    'UserProfile',
    'SessionResponse',
    'UserBackupArchive',
    'CreateApiKeyInput',
  ]) {
    assert.equal(publicDocument.components.schemas[schema], undefined)
  }
  for (const spec of [document, publicDocument]) assertReferences(spec, spec)
  const routeContractCounts = await assertRouteContracts(document)
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
    '/api/v1/alice/webhook',
    '/api/v1/oauth/alice/authorize',
    '/api/v1/oauth/alice/token',
    '/api/v1/backups/export',
    '/api/v1/backups/import/preview',
    '/api/v1/backups/import/restore',
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
    'UserBackupArchive',
    'UserBackupPreviewResponse',
    'UserBackupRestoreRequest',
    'UserBackupRestoreResponse',
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

  for (const path of ['/api/voice/command', '/api/voice/metrics']) {
    assert.equal(
      document.paths?.[path],
      undefined,
      `Retired route is documented: ${path}`,
    )
    assert.ok(
      !registeredRoutes.some((route) => route.path === path),
      `Retired route is registered: ${path}`,
    )
  }

  for (const path of requiredPaths) {
    assert.ok(document.paths?.[path], `OpenAPI path is missing: ${path}`)
  }

  for (const schema of requiredSchemas) {
    assert.ok(
      document.components?.schemas?.[schema],
      `OpenAPI schema is missing: ${schema}`,
    )
  }

  assert.deepEqual(
    document.components.schemas.WorkspaceSettingsUpdateInput.required,
    ['taskCompletionConfettiEnabled'],
  )
  assertSchemaProperties(document, 'NewTaskInput', ['resource', 'sphereId'])
  assertSchemaProperties(document, 'UserBackupArchive', [
    'assets',
    'scope',
    'tables',
  ])
  assertSchemaProperties(document, 'UserBackupRestoreResponse', [
    'operationId',
    'tables',
    'totals',
  ])
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
        !SEPARATE_MCP_DOCUMENTATION_ROUTES.has(key) &&
        !documentedRouteKeys.has(key),
    )
    .sort()

  assert.deepEqual(
    missingOpenApiRoutes,
    [],
    [
      'Fastify routes are missing from OpenAPI.',
      'Document the REST route in apps/api/src/bootstrap/openapi-paths.ts.',
    ].join(' '),
  )

  const staleOpenApiRoutes = [...documentedRouteKeys]
    .filter((key) => !actualRouteKeys.has(key))
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

  console.log('OpenAPI contract check passed.', {
    operations: documentedRouteKeys.size,
    publicOperations: collectDocumentedRouteKeys(publicDocument).size,
    ...routeContractCounts,
  })
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

function assertReferences(document, value) {
  if (!value || typeof value !== 'object') return
  if (typeof value.$ref === 'string') {
    assert.ok(
      value.$ref.startsWith('#/'),
      'External schema references must be checked explicitly',
    )
    const target = value.$ref
      .split('/')
      .slice(1)
      .reduce((current, key) => current?.[key], document)
    assert.ok(target, 'Unresolved OpenAPI reference: ' + value.$ref)
  }
  for (const child of Object.values(value)) assertReferences(document, child)
}
