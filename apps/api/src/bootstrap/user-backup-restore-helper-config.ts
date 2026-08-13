import { validateProductionDatabaseTransport } from './config.js'

export interface UserBackupRestoreHelperRuntimeConfig {
  assetDirectory: string
  connectionString: string
  host: '127.0.0.1'
  port: number
  secret: string
}

export function createUserBackupRestoreHelperRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
): UserBackupRestoreHelperRuntimeConfig {
  const connectionString = requireValue(env, 'USER_BACKUP_RESTORE_DATABASE_URL')
  const secret = requireValue(env, 'USER_BACKUP_RESTORE_HELPER_SECRET')
  const assetDirectory = requireValue(env, 'API_ICON_ASSET_DIR')
  const port = parsePort(env.API_BACKUP_RESTORE_HELPER_PORT)

  if (
    secret.length < 32 ||
    /^(change|replace|secret|your)[_-]?/i.test(secret)
  ) {
    throw new Error(
      'USER_BACKUP_RESTORE_HELPER_SECRET must be a non-placeholder secret with at least 32 characters.',
    )
  }

  if (env.NODE_ENV === 'production') {
    validateProductionDatabaseTransport(connectionString)

    for (const name of [
      'AUTH_JWT_SECRET',
      'AUTH_SMTP_PASSWORD',
      'DATABASE_URL',
      'MIGRATE_DATABASE_URL',
      'TASK_REMINDERS_DATABASE_URL',
      'WORKER_DATABASE_URL',
    ]) {
      if (env[name]?.trim()) {
        throw new Error(
          `${name} must not be exposed to the production backup restore helper.`,
        )
      }
    }
  }

  return {
    assetDirectory,
    connectionString,
    host: '127.0.0.1',
    port,
    secret,
  }
}

function requireValue(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim()

  if (!value) {
    throw new Error(`${name} is required for the backup restore helper.`)
  }

  return value
}

function parsePort(rawValue: string | undefined): number {
  if (!rawValue) {
    return 3012
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`Invalid API_BACKUP_RESTORE_HELPER_PORT: ${rawValue}`)
  }

  return value
}
