import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createApiConfig } from './config.js'

void describe('createApiConfig', () => {
  void it('defaults to postgres storage driver', () => {
    const config = createApiConfig({
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv)

    assert.equal(config.storageDriver, 'postgres')
  })

  void it('allows memory storage only in test runtime', () => {
    const testConfig = createApiConfig({
      API_STORAGE_DRIVER: 'memory',
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv)

    assert.equal(testConfig.storageDriver, 'memory')
    assert.throws(
      () =>
        createApiConfig({
          API_STORAGE_DRIVER: 'memory',
          NODE_ENV: 'development',
        } as NodeJS.ProcessEnv),
      /Postgres is the only application storage driver/,
    )
  })
})
