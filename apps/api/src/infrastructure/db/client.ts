import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool, type PoolConfig } from 'pg'
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
  const pool = new Pool(createPgPoolConfig(config.connectionString))

  pool.on('connect', (client) => {
    client.on('error', (error) => {
      const databaseError = error as NodeJS.ErrnoException

      console.error(
        `Database client error (${databaseError.code ?? 'unknown'}): ${error.message}`,
      )
    })
  })

  pool.on('error', (error) => {
    const databaseError = error as NodeJS.ErrnoException

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
  const config: PoolConfig = {
    connectionTimeoutMillis: 5_000,
    connectionString,
    keepAlive: true,
    query_timeout: 15_000,
  }

  if (!connectionString.includes('pooler.supabase.com')) {
    return config
  }

  const url = new URL(connectionString)

  url.searchParams.delete('sslmode')
  url.searchParams.delete('uselibpqcompat')

  return {
    ...config,
    connectionString: url.toString(),
    idleTimeoutMillis: 5_000,
    idle_in_transaction_session_timeout: 5_000,
    lock_timeout: 5_000,
    maxUses: 1,
    statement_timeout: 15_000,
    ssl: {
      rejectUnauthorized: false,
    },
  }
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
