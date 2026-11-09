import { randomBytes, randomUUID } from 'node:crypto'

import type { ApiKeyScope, CreateApiKeyInput } from '@planner/contracts'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import {
  type ApiKeyOwner,
  type ApiKeyRepository,
  hashApiKey,
} from './api-key.repository.js'

export class ApiKeyService {
  constructor(private readonly repository: ApiKeyRepository) {}

  async create(
    owner: ApiKeyOwner,
    workspaceId: string,
    input: CreateApiKeyInput,
  ) {
    const secret = `hkt_${randomBytes(32).toString('base64url')}`
    const key = await this.repository.create(owner, {
      ...input,
      scopes: [...new Set(input.scopes)],
      workspaceId,
      id: randomUUID(),
      prefix: secret.slice(0, 12),
      tokenHash: hashApiKey(secret),
      expiresAt: new Date(
        Date.now() + input.expiresInDays * 86_400_000,
      ).toISOString(),
    })
    return { key, secret }
  }
  list(owner: ApiKeyOwner) {
    return this.repository.list(owner)
  }
  revoke(owner: ApiKeyOwner, id: string) {
    return this.repository.revoke(owner, id)
  }

  async authenticate(authorization: string | undefined, scope: ApiKeyScope) {
    const match = /^Bearer (hkt_[A-Za-z0-9_-]{43})$/i.exec(authorization ?? '')
    const key = match?.[1]
      ? await this.repository.authenticate(hashApiKey(match[1]))
      : null
    if (!key)
      throw new HttpError(
        401,
        'invalid_api_key',
        'API-ключ недействителен, отозван или истёк.',
      )
    if (!key.scopes.includes(scope))
      throw new HttpError(
        403,
        'api_key_scope_required',
        `Необходимо разрешение ${scope}.`,
      )
    const auth: AuthenticatedRequestContext = {
      accessToken: '',
      claims: {
        sub: key.userId,
        role: 'authenticated',
        payload: { sub: key.userId, role: 'authenticated', api_key_id: key.id },
      },
    }
    return { key, auth }
  }
}
