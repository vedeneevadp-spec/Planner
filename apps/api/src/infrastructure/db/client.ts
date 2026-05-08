import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool, type PoolClient, type PoolConfig } from 'pg'
import { types } from 'pg'

import type { DatabaseConfig } from './config.js'
import type { DatabaseSchema } from './schema.js'

types.setTypeParser(types.builtins.DATE, (value) => value)
types.setTypeParser(types.builtins.INT8, (value) => Number(value))

export interface DatabaseConnection {
  db: Kysely<DatabaseSchema>
  pool: Pool
}

export function createDatabaseConnection(
  config: DatabaseConfig,
): DatabaseConnection {
  const activeClients = new WeakSet<PoolClient>()
  const pool = new Pool(createPgPoolConfig(config.connectionString))

  pool.on('acquire', (client) => {
    activeClients.add(client)
  })

  pool.on('release', (_error, client) => {
    activeClients.delete(client)
  })

  pool.on('remove', (client) => {
    activeClients.delete(client)
  })

  pool.on('connect', (client) => {
    client.on('error', (error) => {
      const databaseError = error as NodeJS.ErrnoException

      if (shouldSuppressPoolClientError(databaseError, client, activeClients)) {
        return
      }

      console.error(
        `Database client error (${databaseError.code ?? 'unknown'}): ${error.message}`,
      )
    })
  })

  pool.on('error', (error, client) => {
    const databaseError = error as NodeJS.ErrnoException

    if (
      client &&
      shouldSuppressPoolClientError(databaseError, client, activeClients)
    ) {
      return
    }

    console.error(
      `Database pool error (${databaseError.code ?? 'unknown'}): ${error.message}`,
    )
  })

  const db = new Kysely<DatabaseSchema>({
    dialect: new PostgresDialect({ pool }),
  })

  return {
    db,
    pool,
  }
}

function createPgPoolConfig(connectionString: string): PoolConfig {
  const connectionTimeoutMillis = readPositiveIntegerEnv(
    'API_DB_CONNECTION_TIMEOUT_MS',
    15_000,
  )
  const queryTimeout = readPositiveIntegerEnv('API_DB_QUERY_TIMEOUT_MS', 30_000)
  const config: PoolConfig = {
    connectionTimeoutMillis,
    connectionString,
    idle_in_transaction_session_timeout: readPositiveIntegerEnv(
      'API_DB_IDLE_TRANSACTION_TIMEOUT_MS',
      30_000,
    ),
    keepAlive: true,
    query_timeout: queryTimeout,
    statement_timeout: readPositiveIntegerEnv(
      'API_DB_STATEMENT_TIMEOUT_MS',
      Math.max(queryTimeout - 1_000, 1_000),
    ),
  }

  return config
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name]

  if (!rawValue) {
    return fallback
  }

  const parsedValue = Number(rawValue)

  return Number.isInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : fallback
}

export async function destroyDatabaseConnection(
  connection: DatabaseConnection,
): Promise<void> {
  await connection.db.destroy()
}

export async function pingDatabase(
  connection: DatabaseConnection,
): Promise<void> {
  // noinspection SqlNoDataSourceInspection
  await sql`select 1`.execute(connection.db)
}

function shouldSuppressPoolClientError(
  error: NodeJS.ErrnoException,
  client: PoolClient,
  activeClients: WeakSet<PoolClient>,
): boolean {
  return error.code === 'ETIMEDOUT' && !activeClients.has(client)
}
