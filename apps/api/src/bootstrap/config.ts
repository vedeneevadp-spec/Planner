import { readFileSync } from 'node:fs'

import type { StorageDriver } from '@planner/contracts'

import type { JwtAuthRuntimeConfig } from '../infrastructure/auth/jwt-request-authenticator.js'
import type { PlannerAuthRuntimeConfig } from '../modules/auth/index.js'

export type ApiAuthMode = 'disabled' | 'jwt'

export interface FirebasePushConfig {
  clientEmail: string
  privateKey: string
  projectId: string
}

export interface ApiConfig {
  appEnv: string
  authMode: ApiAuthMode
  corsOrigin: string
  firebasePush: FirebasePushConfig | null
  host: string
  iconAssetDirectory: string
  jwtAuth: JwtAuthRuntimeConfig | null
  plannerAuth: PlannerAuthRuntimeConfig | null
  port: number
  storageDriver: StorageDriver
}

function parsePort(value: string | undefined): number {
  if (!value) {
    return 3001
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid API port: ${value}`)
  }

  return parsed
}

function parseStorageDriver(
  value: string | undefined,
  appEnv: string,
): StorageDriver {
  if (!value || value === 'postgres') {
    return 'postgres'
  }

  if (value === 'memory') {
    if (appEnv === 'test') {
      return 'memory'
    }

    throw new Error(
      'API_STORAGE_DRIVER=memory is supported only in test runtime. Postgres is the only application storage driver.',
    )
  }

  throw new Error(`Invalid API storage driver: ${value}`)
}

function parseAuthMode(value: string | undefined): ApiAuthMode {
  if (!value || value === 'disabled') {
    return 'disabled'
  }

  if (value === 'jwt') {
    return 'jwt'
  }

  throw new Error(`Invalid API auth mode: ${value}`)
}

function createFirebasePushConfig(
  env: NodeJS.ProcessEnv,
): FirebasePushConfig | null {
  const jsonValue = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim()
  const pathValue = env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim()
  const directProjectId = env.FIREBASE_PROJECT_ID?.trim()
  const directClientEmail = env.FIREBASE_CLIENT_EMAIL?.trim()
  const directPrivateKey = env.FIREBASE_PRIVATE_KEY?.trim()

  if (!jsonValue && !pathValue) {
    if (!directProjectId && !directClientEmail && !directPrivateKey) {
      return null
    }

    if (!directProjectId || !directClientEmail || !directPrivateKey) {
      throw new Error(
        'FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY must be configured together.',
      )
    }

    return {
      clientEmail: directClientEmail,
      privateKey: directPrivateKey.replace(/\\n/g, '\n'),
      projectId: directProjectId,
    }
  }

  if (jsonValue && pathValue) {
    throw new Error(
      'Configure either FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_PATH, not both.',
    )
  }

  const rawValue = jsonValue ?? readFileSync(pathValue!, 'utf8')
  const parsedValue = JSON.parse(rawValue) as {
    client_email?: unknown
    private_key?: unknown
    project_id?: unknown
  }

  if (
    typeof parsedValue.project_id !== 'string' ||
    typeof parsedValue.client_email !== 'string' ||
    typeof parsedValue.private_key !== 'string' ||
    parsedValue.project_id.trim().length === 0 ||
    parsedValue.client_email.trim().length === 0 ||
    parsedValue.private_key.trim().length === 0
  ) {
    throw new Error(
      'Firebase service account credentials must include project_id, client_email, and private_key.',
    )
  }

  return {
    clientEmail: parsedValue.client_email.trim(),
    privateKey: parsedValue.private_key.replace(/\\n/g, '\n'),
    projectId: parsedValue.project_id.trim(),
  }
}

function createJwtAuthConfig(
  env: NodeJS.ProcessEnv,
  authMode: ApiAuthMode,
): JwtAuthRuntimeConfig | null {
  if (authMode !== 'jwt') {
    return null
  }

  const secret = env.AUTH_JWT_SECRET?.trim()

  if (!secret || secret.length < 32) {
    throw new Error(
      'AUTH_JWT_SECRET with at least 32 characters must be configured when API_AUTH_MODE=jwt.',
    )
  }

  return {
    audience: env.AUTH_JWT_AUDIENCE?.trim() || 'authenticated',
    issuer: env.AUTH_JWT_ISSUER?.trim() || 'planner-api',
    secret,
  }
}

function createPlannerAuthConfig(
  env: NodeJS.ProcessEnv,
  jwtAuth: JwtAuthRuntimeConfig | null,
): PlannerAuthRuntimeConfig | null {
  if (!jwtAuth) {
    return null
  }

  return {
    accessTokenTtlSeconds: parsePositiveInteger(
      env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      3600,
      'AUTH_ACCESS_TOKEN_TTL_SECONDS',
    ),
    emailFrom: env.AUTH_EMAIL_FROM?.trim() || 'Chaotika <no-reply@chaotika.ru>',
    jwt: jwtAuth,
    passwordResetTtlSeconds: parsePositiveInteger(
      env.AUTH_PASSWORD_RESET_TTL_SECONDS,
      3600,
      'AUTH_PASSWORD_RESET_TTL_SECONDS',
    ),
    publicAppUrl: (
      env.AUTH_PUBLIC_APP_URL?.trim() || 'http://localhost:5173'
    ).replace(/\/$/, ''),
    refreshTokenTtlSeconds: parsePositiveInteger(
      env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
      60 * 60 * 24 * 30,
      'AUTH_REFRESH_TOKEN_TTL_SECONDS',
    ),
    smtp: createSmtpConfig(env),
  }
}

function createSmtpConfig(
  env: NodeJS.ProcessEnv,
): PlannerAuthRuntimeConfig['smtp'] {
  const host = env.AUTH_SMTP_HOST?.trim()

  if (!host) {
    return null
  }

  return {
    host,
    password: env.AUTH_SMTP_PASSWORD?.trim() || undefined,
    port: parsePositiveInteger(env.AUTH_SMTP_PORT, 587, 'AUTH_SMTP_PORT'),
    secure: parseBoolean(env.AUTH_SMTP_SECURE),
    user: env.AUTH_SMTP_USER?.trim() || undefined,
  }
}

function parseBoolean(value: string | undefined): boolean {
  return typeof value === 'string' && /^(1|true|yes)$/i.test(value.trim())
}

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name}: ${value}`)
  }

  return parsed
}

export function createApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const appEnv = env.NODE_ENV ?? 'development'
  const authMode = parseAuthMode(env.API_AUTH_MODE)
  const jwtAuth = createJwtAuthConfig(env, authMode)

  return {
    appEnv,
    authMode,
    corsOrigin: env.API_CORS_ORIGIN ?? '*',
    firebasePush: createFirebasePushConfig(env),
    host: env.API_HOST ?? '0.0.0.0',
    iconAssetDirectory: env.API_ICON_ASSET_DIR ?? 'tmp/icon-assets',
    jwtAuth,
    plannerAuth: createPlannerAuthConfig(env, jwtAuth),
    port: parsePort(env.API_PORT ?? env.PORT),
    storageDriver: parseStorageDriver(env.API_STORAGE_DRIVER, appEnv),
  }
}
