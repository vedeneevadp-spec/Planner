import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createApiConfig } from './config.js'

const VALID_PRODUCTION_ENV = {
  API_AUTH_MODE: 'jwt',
  API_CORS_ORIGIN: 'https://chaotika.ru',
  API_DB_RLS_MODE: 'transaction_local',
  AUTH_JWT_SECRET: 'planner-test-jwt-secret-with-at-least-32-chars',
  NODE_ENV: 'production',
} satisfies NodeJS.ProcessEnv

void describe('createApiConfig', () => {
  void it('resolves the API port from API_PORT, PORT, or the local default', () => {
    const defaultConfig = createApiConfig({
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv)
    const platformPortConfig = createApiConfig({
      ...VALID_PRODUCTION_ENV,
      PORT: '10000',
    } as NodeJS.ProcessEnv)
    const explicitPortConfig = createApiConfig({
      ...VALID_PRODUCTION_ENV,
      API_PORT: '3001',
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
      ...VALID_PRODUCTION_ENV,
      FIREBASE_CLIENT_EMAIL: 'firebase-admin@example.iam.gserviceaccount.com',
      FIREBASE_PRIVATE_KEY: 'line1\\nline2',
      FIREBASE_PROJECT_ID: 'planner-mobile',
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
          ...VALID_PRODUCTION_ENV,
          FIREBASE_PROJECT_ID: 'planner-mobile',
        } as NodeJS.ProcessEnv),
      /must be configured together/,
    )
  })

  void it('builds Alice OAuth config when client credentials are configured', () => {
    const config = createApiConfig({
      ...VALID_PRODUCTION_ENV,
      ALICE_OAUTH_CLIENT_ID: 'alice-client',
      ALICE_OAUTH_CLIENT_SECRET: 'alice-secret',
    } as NodeJS.ProcessEnv)

    assert.deepEqual(config.aliceOAuth, {
      authorizationCodeTtlSeconds: 300,
      clientId: 'alice-client',
      clientSecret: 'alice-secret',
      redirectUri: 'https://social.yandex.net/broker/redirect',
    })
  })

  void it('requires a complete Alice OAuth env var set when enabled', () => {
    assert.throws(
      () =>
        createApiConfig({
          ...VALID_PRODUCTION_ENV,
          ALICE_OAUTH_CLIENT_ID: 'alice-client',
        } as NodeJS.ProcessEnv),
      /ALICE_OAUTH_CLIENT_ID/,
    )
  })

  void it('rejects unsafe production runtime configuration', () => {
    assert.throws(
      () =>
        createApiConfig({
          API_CORS_ORIGIN: 'https://chaotika.ru',
          AUTH_JWT_SECRET: VALID_PRODUCTION_ENV.AUTH_JWT_SECRET,
          NODE_ENV: 'production',
        } as NodeJS.ProcessEnv),
      /API_AUTH_MODE=jwt/,
    )
    assert.throws(
      () =>
        createApiConfig({
          ...VALID_PRODUCTION_ENV,
          API_CORS_ORIGIN: '*',
        } as NodeJS.ProcessEnv),
      /API_CORS_ORIGIN/,
    )
    assert.throws(
      () =>
        createApiConfig({
          ...VALID_PRODUCTION_ENV,
          AUTH_JWT_SECRET: 'change_me_to_a_long_random_secret',
        } as NodeJS.ProcessEnv),
      /AUTH_JWT_SECRET/,
    )
    assert.throws(
      () =>
        createApiConfig({
          ...VALID_PRODUCTION_ENV,
          API_DB_RLS_MODE: 'disabled',
        } as NodeJS.ProcessEnv),
      /API_DB_RLS_MODE=disabled/,
    )
    assert.throws(
      () =>
        createApiConfig({
          ...VALID_PRODUCTION_ENV,
          API_DB_RLS_MODE: 'maybe',
        } as NodeJS.ProcessEnv),
      /Invalid API_DB_RLS_MODE/,
    )
  })

  void it('keeps disabled auth restricted to development and test runtimes', () => {
    assert.throws(
      () =>
        createApiConfig({
          API_AUTH_MODE: 'disabled',
          NODE_ENV: 'staging',
        } as NodeJS.ProcessEnv),
      /API_AUTH_MODE=disabled/,
    )
  })

  void it('parses explicit proxy trust and reminder runtime settings', () => {
    const config = createApiConfig({
      NODE_ENV: 'development',
      API_TRUST_PROXY_HOPS: '1',
      API_TASK_REMINDERS_RUNTIME: 'worker',
    } as NodeJS.ProcessEnv)

    assert.equal(config.trustedProxyHops, 1)
    assert.equal(config.taskRemindersRuntime, 'worker')

    assert.throws(
      () =>
        createApiConfig({
          NODE_ENV: 'development',
          API_TRUST_PROXY_HOPS: 'many',
        } as NodeJS.ProcessEnv),
      /API_TRUST_PROXY_HOPS/,
    )
    assert.throws(
      () =>
        createApiConfig({
          NODE_ENV: 'development',
          API_TASK_REMINDERS_RUNTIME: 'cron',
        } as NodeJS.ProcessEnv),
      /API_TASK_REMINDERS_RUNTIME/,
    )
  })
})
