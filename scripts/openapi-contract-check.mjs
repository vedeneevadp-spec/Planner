import assert from 'node:assert/strict'

import { createApiKernel, destroyApiKernel } from '../apps/api/src/main.ts'

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
