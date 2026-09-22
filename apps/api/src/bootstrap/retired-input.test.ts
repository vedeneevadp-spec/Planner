import assert from 'node:assert/strict'
import { it } from 'node:test'

import { createApiKernel, destroyApiKernel } from '../main.js'
import { getRegisteredApiRoutes } from './route-registry.js'

void it('starts with Alice configuration and rejects retired audio and metric endpoints', async () => {
  const kernel = createApiKernel({
    ALICE_LLM_PROVIDER: 'yandex',
    API_AUTH_MODE: 'disabled',
    API_STORAGE_DRIVER: 'memory',
    NODE_ENV: 'test',
    YANDEX_API_KEY: 'test-alice-key',
    YANDEX_FOLDER_ID: 'test-alice-folder',
  })

  try {
    await kernel.app.ready()
    assert.equal(kernel.config.aliceCommandLlm?.apiKey, 'test-alice-key')
    const routes = getRegisteredApiRoutes(kernel.app)
    assert.ok(routes.some((route) => route.path === '/api/v1/alice/webhook'))

    for (const url of ['/api/voice/command', '/api/voice/metrics']) {
      assert.ok(!routes.some((route) => route.path === url))
      for (const contentType of [
        'application/json',
        'audio/wav',
        'audio/pcm',
      ]) {
        const response = await kernel.app.inject({
          headers: { 'content-type': contentType },
          method: 'POST',
          payload: contentType === 'application/json' ? '{}' : Buffer.alloc(32),
          url,
        })
        assert.equal(response.statusCode, 404)
      }
    }
    const health = await kernel.app.inject('/api/health')
    assert.equal(health.statusCode, 200)
  } finally {
    await destroyApiKernel(kernel)
  }
})
