import type { StorageDriver } from '@planner/contracts'

import type { SupabaseAuthRuntimeConfig } from '../infrastructure/auth/supabase-request-authenticator.js'

export type ApiAuthMode = 'disabled' | 'supabase'

export interface ApiConfig {
  appEnv: string
  authMode: ApiAuthMode
  corsOrigin: string
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
    jwksUrl: `${projectUrl}/auth/v1/.well-known/jwks.json`,
    jwtSecret: env.SUPABASE_JWT_SECRET?.trim() || undefined,
    projectUrl,
    publishableKey:
      env.SUPABASE_PUBLISHABLE_KEY?.trim() ||
      env.SUPABASE_ANON_KEY?.trim() ||
      undefined,
  }
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
    host: env.API_HOST ?? '0.0.0.0',
    iconAssetDirectory: env.API_ICON_ASSET_DIR ?? 'tmp/icon-assets',
    port: parsePort(env.API_PORT),
    supabaseAuth: createSupabaseAuthConfig(env, authMode),
    storageDriver: parseStorageDriver(env.API_STORAGE_DRIVER, appEnv),
  }
}
