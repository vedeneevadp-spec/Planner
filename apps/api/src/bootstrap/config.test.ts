import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createApiConfig } from './config.js'

void describe('createApiConfig', () => {
  void it('resolves the API port from API_PORT, PORT, or the local default', () => {
    const defaultConfig = createApiConfig({
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv)
    const platformPortConfig = createApiConfig({
      NODE_ENV: 'production',
      PORT: '10000',
    } as NodeJS.ProcessEnv)
    const explicitPortConfig = createApiConfig({
      API_PORT: '3001',
      NODE_ENV: 'production',
      PORT: '10000',
    } as NodeJS.ProcessEnv)

    assert.equal(defaultConfig.port, 3001)
    assert.equal(platformPortConfig.port, 10000)
    assert.equal(explicitPortConfig.port, 3001)
  })

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

  void it('builds Firebase push config from explicit env vars', () => {
    const config = createApiConfig({
      FIREBASE_CLIENT_EMAIL: 'firebase-admin@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'line1\\nline2',
      FIREBASE_PROJECT_ID: 'planner-mobile',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv)

    assert.deepEqual(config.firebasePush, {
      clientEmail: 'firebase-admin@example.iam.gserviceaccount.com',
      privateKey: 'line1\nline2',
      projectId: 'planner-mobile',
    })
  })

  void it('requires a complete Firebase env var set when push config is enabled', () => {
    assert.throws(
      () =>
        createApiConfig({
          FIREBASE_PROJECT_ID: 'planner-mobile',
          NODE_ENV: 'production',
        } as NodeJS.ProcessEnv),
      /must be configured together/,
    )
  })
})
