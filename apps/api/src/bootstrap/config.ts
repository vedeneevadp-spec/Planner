import type { StorageDriver } from '@planner/contracts'

export interface ApiConfig {
  appEnv: string
  corsOrigin: string
  host: string
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

function parseStorageDriver(value: string | undefined): StorageDriver {
  if (!value || value === 'memory') {
    return 'memory'
  }

  if (value === 'postgres') {
    return 'postgres'
  }

  throw new Error(`Invalid API storage driver: ${value}`)
}

export function createApiConfig(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  return {
    appEnv: env.NODE_ENV ?? 'development',
    corsOrigin: env.API_CORS_ORIGIN ?? '*',
    host: env.API_HOST ?? '0.0.0.0',
    port: parsePort(env.API_PORT),
    storageDriver: parseStorageDriver(env.API_STORAGE_DRIVER),
  }
}
