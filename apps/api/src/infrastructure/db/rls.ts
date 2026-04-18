import { type Kysely, sql, type Transaction } from 'kysely'

import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import type { DatabaseSchema } from './schema.js'

export type DatabaseExecutor =
  | Kysely<DatabaseSchema>
  | Transaction<DatabaseSchema>

let hasLoggedPoolerRlsBypass = false

export async function withOptionalRls<T>(
  db: Kysely<DatabaseSchema>,
  authContext: AuthenticatedRequestContext | null | undefined,
  callback: (executor: DatabaseExecutor) => Promise<T>,
  actorUserIdOverride?: string,
): Promise<T> {
  if (!authContext) {
    return callback(db)
  }

  return db.transaction().execute(async (trx) => {
    if (shouldApplyRlsContext()) {
      await applyRlsContext(trx, authContext, actorUserIdOverride)
    }

    return callback(trx)
  })
}

export async function withWriteTransaction<T>(
  db: Kysely<DatabaseSchema>,
  authContext: AuthenticatedRequestContext | null | undefined,
  callback: (trx: Transaction<DatabaseSchema>) => Promise<T>,
  actorUserIdOverride?: string,
): Promise<T> {
  return db.transaction().execute(async (trx) => {
    if (authContext && shouldApplyRlsContext()) {
      await applyRlsContext(trx, authContext, actorUserIdOverride)
    }

    return callback(trx)
  })
}

function shouldApplyRlsContext(): boolean {
  const explicitMode = process.env.API_DB_RLS_MODE?.trim().toLowerCase()

  if (explicitMode === 'enabled') {
    return true
  }

  if (explicitMode === 'disabled') {
    return false
  }

  const databaseUrl = process.env.DATABASE_URL ?? ''
  const isSupabasePoolerRuntime = databaseUrl.includes('pooler.supabase.com')

  if (isSupabasePoolerRuntime && !hasLoggedPoolerRlsBypass) {
    hasLoggedPoolerRlsBypass = true
    console.warn(
      '[db] Skipping Postgres RLS context for Supabase pooler runtime; backend auth remains authoritative. Set API_DB_RLS_MODE=enabled to force RLS context.',
    )
  }

  return !isSupabasePoolerRuntime
}

async function applyRlsContext(
  executor: DatabaseExecutor,
  authContext: AuthenticatedRequestContext,
  actorUserIdOverride?: string,
): Promise<void> {
  const effectiveActorUserId = actorUserIdOverride ?? authContext.claims.sub

  await sql`
    select set_config(
      'request.jwt.claims',
      ${JSON.stringify({
        ...authContext.claims.payload,
        ...(authContext.claims.email
          ? { email: authContext.claims.email }
          : {}),
        ...(effectiveActorUserId !== authContext.claims.sub
          ? { auth_sub: authContext.claims.sub }
          : {}),
        role: authContext.claims.role,
        sub: effectiveActorUserId,
      })},
      true
    )
  `.execute(executor)

  await sql`
    set local role authenticated
  `.execute(executor)
}
