import { createHash } from 'node:crypto'

import {
  type ApiKeyRecord,
  apiKeyRecordSchema,
  type CreateApiKeyInput,
} from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import { withOptionalRls } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'

export interface ApiKeyOwner {
  auth: AuthenticatedRequestContext
  userId: string
}
export interface StoredApiKey extends ApiKeyRecord {
  userId: string
}
export interface NewApiKey extends CreateApiKeyInput {
  id: string
  prefix: string
  tokenHash: string
  workspaceId: string
  expiresAt: string
}
export interface ApiKeyRepository {
  create(owner: ApiKeyOwner, input: NewApiKey): Promise<ApiKeyRecord>
  list(owner: ApiKeyOwner): Promise<ApiKeyRecord[]>
  revoke(owner: ApiKeyOwner, id: string): Promise<void>
  authenticate(tokenHash: string): Promise<StoredApiKey | null>
}
export function hashApiKey(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

export class MemoryApiKeyRepository implements ApiKeyRepository {
  private readonly keys = new Map<
    string,
    StoredApiKey & { tokenHash: string }
  >()

  create(owner: ApiKeyOwner, input: NewApiKey): Promise<ApiKeyRecord> {
    const active = [...this.keys.values()].filter(
      (key) =>
        key.userId === owner.userId &&
        !key.revokedAt &&
        Date.parse(key.expiresAt) > Date.now(),
    )
    if (active.length >= 20) throw keyLimitError()
    const key = {
      ...input,
      userId: owner.userId,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revokedAt: null,
    }
    this.keys.set(key.id, key)
    return Promise.resolve(apiKeyRecordSchema.parse(key))
  }
  list(owner: ApiKeyOwner): Promise<ApiKeyRecord[]> {
    return Promise.resolve(
      [...this.keys.values()]
        .filter((key) => key.userId === owner.userId)
        .map((key) => apiKeyRecordSchema.parse(key))
        .reverse(),
    )
  }
  revoke(owner: ApiKeyOwner, id: string): Promise<void> {
    const key = this.keys.get(id)
    if (!key || key.userId !== owner.userId) throw keyNotFoundError()
    key.revokedAt ??= new Date().toISOString()
    return Promise.resolve()
  }
  authenticate(tokenHash: string): Promise<StoredApiKey | null> {
    const key = [...this.keys.values()].find(
      (candidate) =>
        candidate.tokenHash === tokenHash &&
        !candidate.revokedAt &&
        Date.parse(candidate.expiresAt) > Date.now(),
    )
    if (!key) return Promise.resolve(null)
    key.lastUsedAt = new Date().toISOString()
    return Promise.resolve({
      ...apiKeyRecordSchema.parse(key),
      userId: key.userId,
    })
  }
}

interface KeyRow {
  id: string
  name: string
  prefix: string
  user_id: string
  workspace_id: string
  scopes: string[]
  created_at: Date | string
  expires_at: Date | string
  last_used_at: Date | string | null
  revoked_at: Date | string | null
}
function mapKey(row: KeyRow): StoredApiKey {
  const iso = (date: Date | string) => new Date(date).toISOString()
  return {
    ...apiKeyRecordSchema.parse({
      ...row,
      workspaceId: row.workspace_id,
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
      lastUsedAt: row.last_used_at ? iso(row.last_used_at) : null,
      revokedAt: row.revoked_at ? iso(row.revoked_at) : null,
    }),
    userId: row.user_id,
  }
}
export class PostgresApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async create(owner: ApiKeyOwner, input: NewApiKey): Promise<ApiKeyRecord> {
    const result = await withOptionalRls(
      this.db,
      owner.auth,
      (trx) =>
        sql<KeyRow>`
      select * from app.api_keys_create(${input.id}::uuid, ${input.workspaceId}::uuid,
        ${input.name}, ${input.prefix}, ${input.tokenHash}, ${input.scopes}::text[], ${input.expiresAt}::timestamptz)
    `.execute(trx),
      owner.userId,
    )
    const row = result.rows[0]
    if (!row) throw keyLimitError()
    return apiKeyRecordSchema.parse(mapKey(row))
  }
  async list(owner: ApiKeyOwner): Promise<ApiKeyRecord[]> {
    const result = await withOptionalRls(
      this.db,
      owner.auth,
      (trx) => sql<KeyRow>`select * from app.api_keys_list()`.execute(trx),
      owner.userId,
    )
    return result.rows.map((row) => apiKeyRecordSchema.parse(mapKey(row)))
  }
  async revoke(owner: ApiKeyOwner, id: string): Promise<void> {
    const result = await withOptionalRls(
      this.db,
      owner.auth,
      (trx) =>
        sql<{
          revoked: boolean
        }>`select app.api_keys_revoke(${id}::uuid) as revoked`.execute(trx),
      owner.userId,
    )
    if (!result.rows[0]?.revoked) throw keyNotFoundError()
  }
  async authenticate(tokenHash: string): Promise<StoredApiKey | null> {
    const result =
      await sql<KeyRow>`select * from app.api_keys_authenticate(${tokenHash})`.execute(
        this.db,
      )
    return result.rows[0] ? mapKey(result.rows[0]) : null
  }
}
function keyLimitError() {
  return new HttpError(
    409,
    'api_key_limit',
    'Можно создать не более 20 действующих ключей. Отзовите ненужный ключ.',
  )
}
function keyNotFoundError() {
  return new HttpError(404, 'api_key_not_found', 'API-ключ не найден.')
}
