import { type Kysely, sql, type Transaction } from 'kysely'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import type { DatabaseSchema } from './schema.js'

export type DatabaseExecutor =
  | Kysely<DatabaseSchema>
  | Transaction<DatabaseSchema>

export type RlsStrategy =
  | 'disabled'
  | 'session_connection'
  | 'transaction_local'

let hasLoggedPoolerRlsMode = false

export async function withOptionalRls<T>(
  db: Kysely<DatabaseSchema>,
  authContext: AuthenticatedRequestContext | null | undefined,
  callback: (executor: DatabaseExecutor) => Promise<T>,
  actorUserIdOverride?: string,
): Promise<T> {
  if (!authContext) {
    return callback(db)
  }

  const strategy = resolveRlsStrategy()

  if (strategy === 'disabled') {
    return callback(db)
  }

  if (strategy === 'session_connection') {
    return db.connection().execute(async (connection) => {
      logPoolerRlsMode()
      await applySessionRlsContext(connection, authContext, actorUserIdOverride)

      try {
        return await callback(connection)
      } finally {
        await clearSessionRlsContext(connection)
      }
    })
  }

  return db.transaction().execute(async (trx) => {
    await applyTransactionLocalRlsContext(trx, authContext, actorUserIdOverride)

    return callback(trx)
  })
}

export async function withWriteTransaction<T>(
  db: Kysely<DatabaseSchema>,
  authContext: AuthenticatedRequestContext | null | undefined,
  callback: (trx: Transaction<DatabaseSchema>) => Promise<T>,
  actorUserIdOverride?: string,
): Promise<T> {
  const strategy = authContext ? resolveRlsStrategy() : 'disabled'

  if (strategy === 'disabled') {
    return db.transaction().execute(callback)
  }

  const resolvedAuthContext = authContext

  if (!resolvedAuthContext) {
    return db.transaction().execute(callback)
  }

  if (strategy === 'session_connection') {
    return db.connection().execute(async (connection) => {
      logPoolerRlsMode()
      await applySessionRlsContext(
        connection,
        resolvedAuthContext,
        actorUserIdOverride,
      )

      try {
        return await connection
          .transaction()
          .execute(async (trx) => callback(trx))
      } finally {
        await clearSessionRlsContext(connection)
      }
    })
  }

  return db.transaction().execute(async (trx) => {
    await applyTransactionLocalRlsContext(
      trx,
      resolvedAuthContext,
      actorUserIdOverride,
    )

    return callback(trx)
  })
}

function resolveRlsStrategy(): RlsStrategy {
  return resolveRlsStrategyForEnvironment(process.env)
}

export function resolveRlsStrategyForEnvironment(
  env: NodeJS.ProcessEnv,
): RlsStrategy {
  const explicitMode = env.API_DB_RLS_MODE?.trim().toLowerCase()

  if (explicitMode === 'enabled') {
    return 'transaction_local'
  }

  if (explicitMode === 'disabled') {
    return 'disabled'
  }

  const databaseUrl = resolveDatabaseUrlForRls(env)
  const isSupabasePoolerRuntime = databaseUrl.includes('pooler.supabase.com')

  if (isSupabasePoolerRuntime) {
    return 'session_connection'
  }

  return 'transaction_local'
}

function resolveDatabaseUrlForRls(env: NodeJS.ProcessEnv): string {
  return (
    env.DATABASE_URL ??
    env.SUPABASE_RUNTIME_DATABASE_URL ??
    env.SUPABASE_SESSION_POOLER_URL ??
    ''
  )
}

function logPoolerRlsMode(): void {
  if (hasLoggedPoolerRlsMode) {
    return
  }

  hasLoggedPoolerRlsMode = true
  console.warn(
    '[db] Using session-connection Postgres RLS context for Supabase pooler runtime.',
  )
}

async function applyTransactionLocalRlsContext(
  executor: DatabaseExecutor,
  authContext: AuthenticatedRequestContext,
  actorUserIdOverride?: string,
): Promise<void> {
  await sql`
    select set_config(
      'request.jwt.claims',
      ${JSON.stringify(buildEffectiveClaims(authContext, actorUserIdOverride))},
      true
    )
  `.execute(executor)

  await sql`
    set local role authenticated
  `.execute(executor)
}

async function applySessionRlsContext(
  executor: Kysely<DatabaseSchema>,
  authContext: AuthenticatedRequestContext,
  actorUserIdOverride?: string,
): Promise<void> {
  await sql`
    select set_config(
      'request.jwt.claims',
      ${JSON.stringify(buildEffectiveClaims(authContext, actorUserIdOverride))},
      false
    )
  `.execute(executor)

  await sql`
    set role authenticated
  `.execute(executor)
}

async function clearSessionRlsContext(
  executor: Kysely<DatabaseSchema>,
): Promise<void> {
  try {
    await sql`
      reset role
    `.execute(executor)
    await sql`
      select set_config('request.jwt.claims', '{}', false)
    `.execute(executor)
  } catch (error) {
    console.warn('[db] Failed to clear session Postgres RLS context.', error)
  }
}

function buildEffectiveClaims(
  authContext: AuthenticatedRequestContext,
  actorUserIdOverride?: string,
): Record<string, unknown> {
  const effectiveActorUserId = actorUserIdOverride ?? authContext.claims.sub

  return {
    ...authContext.claims.payload,
    ...(authContext.claims.email ? { email: authContext.claims.email } : {}),
    ...(effectiveActorUserId !== authContext.claims.sub
      ? { auth_sub: authContext.claims.sub }
      : {}),
    role: authContext.claims.role,
    sub: effectiveActorUserId,
  }
}
