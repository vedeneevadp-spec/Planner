import { randomUUID } from 'node:crypto'

import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const requireRuntimeNonOwner = process.env.DB_SECURITY_REQUIRE_NON_OWNER === '1'
const rlsMode = normalizeRlsMode(process.env.API_DB_RLS_MODE)

const client = new Client(createPgConnectionConfig(connectionString))

try {
  await client.connect()
  await preparePgAdminConnection(client)

  await verifyAuthenticatedTableRls(client)

  const ownerResult = await client.query(
    `
      select current_user = tableowner as is_owner, tablename
      from pg_tables
      where schemaname = 'app'
      order by tablename
    `,
  )
  const ownedTables = ownerResult.rows
    .filter((row) => row.is_owner)
    .map((row) => row.tablename)

  if (ownedTables.length > 0) {
    const message = `Current DB user owns app tables: ${ownedTables.join(', ')}. Use a non-owner runtime DB role for stricter RLS enforcement.`

    if (requireRuntimeNonOwner) {
      throw new Error(message)
    }

    console.warn(`[db-security] ${message}`)
  }

  await verifyRuntimeRlsMode(client, rlsMode)

  if (requireRuntimeNonOwner) {
    await verifyRuntimeAuthBootstrapAccess(client)
  }

  console.log('Database security check passed.')
} finally {
  await closePgClient(client)
}

function normalizeRlsMode(value) {
  const normalized = value?.trim().toLowerCase() || 'transaction_local'

  if (normalized === 'enabled') {
    return 'transaction_local'
  }

  if (
    normalized === 'claims_only' ||
    normalized === 'disabled' ||
    normalized === 'session_connection' ||
    normalized === 'transaction_local'
  ) {
    return normalized
  }

  throw new Error(`Invalid API_DB_RLS_MODE: ${value}`)
}

async function verifyAuthenticatedTableRls(client) {
  const rlsResult = await client.query(
    `
      with app_tables as (
        select
          pg_class.relname as table_name,
          pg_class.relrowsecurity as rls_enabled,
          array_remove(array[
            case when has_table_privilege('authenticated', pg_class.oid, 'SELECT') then 'SELECT' end,
            case when has_table_privilege('authenticated', pg_class.oid, 'INSERT') then 'INSERT' end,
            case when has_table_privilege('authenticated', pg_class.oid, 'UPDATE') then 'UPDATE' end,
            case when has_table_privilege('authenticated', pg_class.oid, 'DELETE') then 'DELETE' end
          ]::text[], null) as privileges
        from pg_class
        join pg_namespace on pg_namespace.oid = pg_class.relnamespace
        where pg_namespace.nspname = 'app'
          and pg_class.relkind in ('r', 'p')
      )
      select table_name, rls_enabled, privileges
      from app_tables
      where cardinality(privileges) > 0
      order by table_name
    `,
  )

  const missingRlsTables = rlsResult.rows
    .filter((row) => !row.rls_enabled)
    .map((row) => {
      const privileges = Array.isArray(row.privileges)
        ? row.privileges.join(', ')
        : 'unknown privileges'

      return `app.${row.table_name} (${privileges})`
    })

  if (missingRlsTables.length > 0) {
    throw new Error(
      [
        'RLS is not enabled for app tables accessible by authenticated:',
        missingRlsTables.join(', '),
        'Enable RLS before granting authenticated table privileges.',
        'For internal table grant drift, run npm run db:security:repair with MIGRATE_DATABASE_URL, then rerun this check.',
      ].join(' '),
    )
  }
}

async function verifyRuntimeRlsMode(client, mode) {
  if (mode === 'disabled') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'API_DB_RLS_MODE=disabled is not allowed when NODE_ENV=production.',
      )
    }

    console.warn(
      '[db-security] API_DB_RLS_MODE=disabled skips DB RLS runtime enforcement.',
    )
    return
  }

  if (mode === 'claims_only') {
    console.warn(
      '[db-security] API_DB_RLS_MODE=claims_only sets request.jwt.claims but does not SET ROLE authenticated. Use transaction_local after the runtime DB role can SET ROLE authenticated.',
    )
    return
  }

  const roleResult = await client.query(
    `
      select
        pg_has_role(current_user, 'authenticated', 'member') as is_member,
        pg_has_role(current_user, 'authenticated', 'set') as can_set_role
    `,
  )
  const roleState = roleResult.rows[0]

  if (!roleState?.is_member || !roleState.can_set_role) {
    throw new Error(
      'API_DB_RLS_MODE=transaction_local requires the runtime DB user to be a member of role authenticated and to be allowed to SET ROLE authenticated.',
    )
  }

  await client.query('begin')
  try {
    await client.query('set local role authenticated')
    await client.query('rollback')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  }
}

async function verifyRuntimeAuthBootstrapAccess(client) {
  const userId = randomUUID()
  const workspaceId = randomUUID()
  const refreshTokenId = randomUUID()
  const sessionId = randomUUID()
  const email = `db-security-${userId}@example.test`
  const slug = `db-security-${workspaceId}`

  await client.query('begin')
  try {
    await client.query(
      `
        select *
        from app.auth_create_user_with_credential(
          $1::uuid,
          $2::public.citext,
          'DB Security Check',
          'db-security-check'
        )
      `,
      [userId, email],
    )

    await client.query(
      `
        select app.auth_insert_refresh_token(
          $1::uuid,
          $2::uuid,
          $3,
          $4::uuid,
          now() + interval '1 hour',
          null,
          null
        )
      `,
      [refreshTokenId, userId, `db-security-${refreshTokenId}`, sessionId],
    )

    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ role: 'authenticated', sub: userId }),
    ])
    await client.query('set local role authenticated')

    await client.query(
      `
        select provisioned_workspace_id as workspace_id
        from app.session_provision_personal_workspace(
          $1::uuid,
          $2::uuid,
          $3::uuid,
          'DB Security Check',
          $4,
          'owner'::app.workspace_role
        )
      `,
      [userId, workspaceId, randomUUID(), slug],
    )

    await client.query('rollback')
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw new Error(
      [
        'Runtime DB user cannot write auth/session bootstrap records.',
        'A strict non-owner runtime must be able to create users, credentials, workspaces, memberships, and refresh tokens without table-owner bypass.',
        `Postgres error: ${formatPgError(error)}`,
      ].join(' '),
    )
  }
}

function formatPgError(error) {
  if (!error || typeof error !== 'object') {
    return String(error)
  }

  const code = error.code ? ` (${error.code})` : ''
  const message = error.message ?? String(error)

  return `${message}${code}`
}
