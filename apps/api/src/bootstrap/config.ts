import { readFileSync } from 'node:fs'

import type { StorageDriver } from '@planner/contracts'
import type { JSONWebKeySet } from 'jose'

import type { SupabaseAuthRuntimeConfig } from '../infrastructure/auth/supabase-request-authenticator.js'

export type ApiAuthMode = 'disabled' | 'supabase'

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
  port: number
  supabaseAuth: SupabaseAuthRuntimeConfig | null
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

  if (value === 'supabase') {
    return 'supabase'
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

function resolveSupabaseProjectUrl(env: NodeJS.ProcessEnv): string | null {
  const explicitUrl = env.SUPABASE_URL?.trim()

  if (explicitUrl) {
    return explicitUrl.replace(/\/$/, '')
  }

  const projectRef = env.SUPABASE_PROJECT_REF?.trim()

  if (!projectRef) {
    return null
  }

  return `https://${projectRef}.supabase.co`
}

function createSupabaseAuthConfig(
  env: NodeJS.ProcessEnv,
  authMode: ApiAuthMode,
): SupabaseAuthRuntimeConfig | null {
  if (authMode !== 'supabase') {
    return null
  }

  const projectUrl = resolveSupabaseProjectUrl(env)

  if (!projectUrl) {
    throw new Error(
      'SUPABASE_URL or SUPABASE_PROJECT_REF must be configured when API_AUTH_MODE=supabase.',
    )
  }

  return {
    issuer: `${projectUrl}/auth/v1`,
    jwksJson: readSupabaseJwksJson(env),
    jwksUrl: `${projectUrl}/auth/v1/.well-known/jwks.json`,
    jwtSecret: env.SUPABASE_JWT_SECRET?.trim() || undefined,
    projectUrl,
    publishableKey:
      env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
      env.SUPABASE_ANON_KEY?.trim() ||
      undefined,
  }
}

function readSupabaseJwksJson(
  env: NodeJS.ProcessEnv,
): JSONWebKeySet | undefined {
  const jwksPath = env.SUPABASE_JWKS_PATH?.trim()

  if (!jwksPath) {
    return undefined
  }

  const value = JSON.parse(readFileSync(jwksPath, 'utf8')) as unknown

  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Array.isArray((value as { keys?: unknown }).keys)
  ) {
    throw new Error('SUPABASE_JWKS_PATH must point to a JWKS JSON object.')
  }

  return value as JSONWebKeySet
}

export function createApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const appEnv = env.NODE_ENV ?? 'development'
  const authMode = parseAuthMode(env.API_AUTH_MODE)

  return {
    appEnv,
    authMode,
    corsOrigin: env.API_CORS_ORIGIN ?? '*',
    firebasePush: createFirebasePushConfig(env),
    host: env.API_HOST ?? '0.0.0.0',
    iconAssetDirectory: env.API_ICON_ASSET_DIR ?? 'tmp/icon-assets',
    port: parsePort(env.API_PORT ?? env.PORT),
    supabaseAuth: createSupabaseAuthConfig(env, authMode),
    storageDriver: parseStorageDriver(env.API_STORAGE_DRIVER, appEnv),
  }
}
