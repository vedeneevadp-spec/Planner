import { createHash, randomBytes } from 'node:crypto'

import { generateUuidV7 } from '@planner/contracts'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import {
  HAOTIKA_MCP_READ_SCOPES,
  type HaotikaMcpScope,
} from '../ai-context/index.js'
import type { AuthService } from '../auth/index.js'
import type {
  CreateMcpOAuthTokenCommand,
  McpAuthContext,
  McpHaotikaRuntimeConfig,
  McpOAuthTokenRecord,
  McpOAuthTokenRepository,
} from './mcp-haotika.types.js'
import { McpHaotikaError } from './mcp-haotika.types.js'

const ACCESS_TOKEN_TTL_SECONDS = 3600
const AUTHORIZATION_CODE_TTL_SECONDS = 300

interface AuthorizationCodeRecord {
  clientId: string | null
  codeChallenge: string | null
  codeChallengeMethod: 'S256' | null
  expiresAt: number
  redirectUri: string
  resource: string
  scopes: HaotikaMcpScope[]
  userId: string
}

interface McpOAuthTokenRow {
  access_token_hash: string
  client_id: string | null
  expires_at: Date | string
  id: string
  issuer: string
  last_used_at: Date | string | null
  refresh_token_hash: string | null
  resource: string
  revoked_at: Date | string | null
  scopes: string[]
  user_id: string
}

export interface CompleteMcpAuthorizeInput {
  clientId?: string | undefined
  codeChallenge?: string | undefined
  codeChallengeMethod?: string | undefined
  email: string
  password: string
  redirectUri: string
  resource?: string | undefined
  scope?: string | undefined
  state?: string | undefined
}

export interface ExchangeMcpTokenInput {
  clientId?: string | undefined
  clientSecret?: string | undefined
  code?: string | undefined
  codeVerifier?: string | undefined
  grantType: 'authorization_code' | 'refresh_token'
  redirectUri?: string | undefined
  refreshToken?: string | undefined
  resource?: string | undefined
}

export interface McpTokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope: string
  token_type: 'Bearer'
}

export class McpOAuthService {
  private readonly authorizationCodes = new Map<
    string,
    AuthorizationCodeRecord
  >()

  constructor(
    private readonly repository: McpOAuthTokenRepository,
    private readonly config: McpHaotikaRuntimeConfig,
    private readonly authService?: AuthService | undefined,
  ) {}

  async completeAuthorize(input: CompleteMcpAuthorizeInput): Promise<string> {
    if (!this.config.enabled) {
      throw new McpHaotikaError(
        'MCP_DISABLED',
        'MCP connector is disabled.',
        503,
      )
    }

    if (!this.authService) {
      throw new McpHaotikaError(
        'UNAUTHORIZED',
        'Password login is not configured for MCP OAuth.',
        401,
      )
    }

    assertAllowedRedirectUri(input.redirectUri, this.config)
    const resource = resolveRequestedResource(input.resource, this.config)

    if (!input.codeChallenge || input.codeChallengeMethod !== 'S256') {
      throw new McpHaotikaError(
        'VALIDATION_ERROR',
        'PKCE S256 code_challenge is required.',
        400,
      )
    }

    const token = await this.authService.signIn(
      {
        email: input.email,
        password: input.password,
      },
      {
        ipAddress: undefined,
        userAgent: 'mcp-oauth',
      },
    )
    const code = createOpaqueToken('hac')
    const scopes = parseRequestedScopes(input.scope)

    this.authorizationCodes.set(hashOpaqueToken(code), {
      clientId: input.clientId ?? null,
      codeChallenge: input.codeChallenge ?? null,
      codeChallengeMethod: input.codeChallenge ? 'S256' : null,
      expiresAt: Date.now() + AUTHORIZATION_CODE_TTL_SECONDS * 1000,
      redirectUri: input.redirectUri,
      resource,
      scopes,
      userId: token.user.id,
    })
    cleanupExpiredAuthorizationCodes(this.authorizationCodes)

    const redirectUrl = new URL(input.redirectUri)
    redirectUrl.searchParams.set('code', code)

    if (input.state) {
      redirectUrl.searchParams.set('state', input.state)
    }

    return redirectUrl.toString()
  }

  async exchangeToken(input: ExchangeMcpTokenInput): Promise<McpTokenResponse> {
    if (!this.config.enabled) {
      throw new McpHaotikaError(
        'MCP_DISABLED',
        'MCP connector is disabled.',
        503,
      )
    }

    if (input.grantType === 'refresh_token') {
      return this.exchangeRefreshToken(input)
    }

    if (!input.code || !input.redirectUri) {
      throw new McpHaotikaError(
        'VALIDATION_ERROR',
        'code and redirect_uri are required.',
        400,
      )
    }

    const codeHash = hashOpaqueToken(input.code)
    const authorizationCode = this.authorizationCodes.get(codeHash)

    this.authorizationCodes.delete(codeHash)

    if (
      !authorizationCode ||
      authorizationCode.expiresAt <= Date.now() ||
      authorizationCode.redirectUri !== input.redirectUri ||
      authorizationCode.clientId !== (input.clientId ?? null) ||
      authorizationCode.resource !==
        resolveRequestedResource(input.resource, this.config)
    ) {
      throw new McpHaotikaError(
        'UNAUTHORIZED',
        'Authorization code is invalid or expired.',
        401,
      )
    }

    if (
      authorizationCode.codeChallenge &&
      !verifyCodeChallenge(input.codeVerifier, authorizationCode.codeChallenge)
    ) {
      throw new McpHaotikaError(
        'UNAUTHORIZED',
        'PKCE verification failed.',
        401,
      )
    }

    return this.createTokenResponse({
      clientId: authorizationCode.clientId ?? input.clientId ?? null,
      resource: authorizationCode.resource,
      scopes: authorizationCode.scopes,
      userId: authorizationCode.userId,
    })
  }

  async revoke(token: string | undefined): Promise<void> {
    if (!token) {
      return
    }

    await this.repository.revokeByTokenHash(hashOpaqueToken(token))
  }

  async authenticateBearer(
    authorizationHeader: string | undefined,
    requiredScopes: readonly HaotikaMcpScope[],
  ): Promise<McpAuthContext> {
    const accessToken = readBearerToken(authorizationHeader)

    if (!accessToken) {
      throw this.createUnauthorizedError('Authentication required')
    }

    const token = await this.repository.findByAccessTokenHash(
      hashOpaqueToken(accessToken),
    )

    if (!token || token.revokedAt) {
      throw this.createUnauthorizedError('Access token is invalid')
    }

    if (new Date(token.expiresAt).getTime() <= Date.now()) {
      throw this.createUnauthorizedError(
        'Access token expired',
        'TOKEN_EXPIRED',
      )
    }

    if (
      token.issuer !== this.config.oauthIssuer ||
      token.resource !== createMcpResource(this.config.publicBaseUrl)
    ) {
      throw this.createUnauthorizedError('Access token audience is invalid')
    }

    const missingScope = requiredScopes.find(
      (scope) => !token.scopes.includes(scope),
    )

    if (missingScope) {
      throw new McpHaotikaError(
        'FORBIDDEN_SCOPE',
        `Missing required scope: ${missingScope}`,
        403,
        createWwwAuthenticate(this.config.publicBaseUrl, {
          description: `Missing required scope: ${missingScope}`,
          error: 'insufficient_scope',
          scopes: requiredScopes,
        }),
      )
    }

    await this.repository.touchLastUsed(token.id)

    return {
      scopes: token.scopes,
      tokenId: token.id,
      userId: token.userId,
    }
  }

  createUnauthorizedError(
    message: string,
    code: 'TOKEN_EXPIRED' | 'UNAUTHORIZED' = 'UNAUTHORIZED',
  ): McpHaotikaError {
    return new McpHaotikaError(
      code,
      message,
      401,
      createWwwAuthenticate(this.config.publicBaseUrl, {
        description: message,
        error: code === 'TOKEN_EXPIRED' ? 'invalid_token' : 'invalid_request',
        scopes: HAOTIKA_MCP_READ_SCOPES,
      }),
    )
  }

  private async exchangeRefreshToken(
    input: ExchangeMcpTokenInput,
  ): Promise<McpTokenResponse> {
    if (!input.refreshToken) {
      throw new McpHaotikaError(
        'VALIDATION_ERROR',
        'refresh_token is required.',
        400,
      )
    }

    const currentToken = await this.repository.findByRefreshTokenHash(
      hashOpaqueToken(input.refreshToken),
    )

    if (!currentToken || currentToken.revokedAt) {
      throw this.createUnauthorizedError('Refresh token is invalid')
    }

    if (
      currentToken.issuer !== this.config.oauthIssuer ||
      currentToken.resource !== createMcpResource(this.config.publicBaseUrl)
    ) {
      throw this.createUnauthorizedError('Refresh token audience is invalid')
    }

    if (
      input.resource?.trim() &&
      input.resource.trim() !== currentToken.resource
    ) {
      throw this.createUnauthorizedError('Requested resource is invalid')
    }

    await this.repository.revokeByTokenHash(hashOpaqueToken(input.refreshToken))

    return this.createTokenResponse({
      clientId: currentToken.clientId,
      resource: currentToken.resource,
      scopes: currentToken.scopes,
      userId: currentToken.userId,
    })
  }

  private async createTokenResponse(input: {
    clientId: string | null
    resource: string
    scopes: HaotikaMcpScope[]
    userId: string
  }): Promise<McpTokenResponse> {
    const accessToken = createOpaqueToken('hat')
    const refreshToken = createOpaqueToken('hrt')
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000)

    await this.repository.createToken({
      accessTokenHash: hashOpaqueToken(accessToken),
      clientId: input.clientId,
      expiresAt,
      issuer: this.config.oauthIssuer,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      resource: input.resource,
      scopes: input.scopes,
      userId: input.userId,
    })

    return {
      access_token: accessToken,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: input.scopes.join(' '),
      token_type: 'Bearer',
    }
  }
}

export class MemoryMcpOAuthTokenRepository implements McpOAuthTokenRepository {
  private readonly tokens = new Map<string, McpOAuthTokenRecord>()

  createToken(
    command: CreateMcpOAuthTokenCommand,
  ): Promise<McpOAuthTokenRecord> {
    const token: McpOAuthTokenRecord = {
      accessTokenHash: command.accessTokenHash,
      clientId: command.clientId,
      expiresAt: command.expiresAt.toISOString(),
      id: generateUuidV7(),
      issuer: command.issuer,
      lastUsedAt: null,
      refreshTokenHash: command.refreshTokenHash,
      resource: command.resource,
      revokedAt: null,
      scopes: [...command.scopes],
      userId: command.userId,
    }

    this.tokens.set(token.id, token)

    return Promise.resolve(token)
  }

  findByAccessTokenHash(
    accessTokenHash: string,
  ): Promise<McpOAuthTokenRecord | null> {
    return Promise.resolve(
      [...this.tokens.values()].find(
        (token) => token.accessTokenHash === accessTokenHash,
      ) ?? null,
    )
  }

  findByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<McpOAuthTokenRecord | null> {
    return Promise.resolve(
      [...this.tokens.values()].find(
        (token) => token.refreshTokenHash === refreshTokenHash,
      ) ?? null,
    )
  }

  revokeByTokenHash(tokenHash: string): Promise<void> {
    const revokedAt = new Date().toISOString()

    for (const token of this.tokens.values()) {
      if (
        token.accessTokenHash === tokenHash ||
        token.refreshTokenHash === tokenHash
      ) {
        token.revokedAt = revokedAt
      }
    }

    return Promise.resolve()
  }

  touchLastUsed(tokenId: string): Promise<void> {
    const token = this.tokens.get(tokenId)

    if (token) {
      token.lastUsedAt = new Date().toISOString()
    }

    return Promise.resolve()
  }
}

export class PostgresMcpOAuthTokenRepository implements McpOAuthTokenRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async createToken(
    command: CreateMcpOAuthTokenCommand,
  ): Promise<McpOAuthTokenRecord> {
    const row = await sql<McpOAuthTokenRow>`
      select *
      from app.mcp_oauth_create_token(
        ${command.userId}::uuid,
        ${command.clientId},
        ${command.issuer},
        ${command.resource},
        ${command.accessTokenHash},
        ${command.refreshTokenHash},
        ${command.scopes}::text[],
        ${command.expiresAt}::timestamptz
      )
    `.execute(this.db)

    return mapTokenRow(row.rows[0]!)
  }

  async findByAccessTokenHash(
    accessTokenHash: string,
  ): Promise<McpOAuthTokenRecord | null> {
    const row = await sql<McpOAuthTokenRow>`
      select *
      from app.mcp_oauth_find_by_access_token_hash(${accessTokenHash})
    `.execute(this.db)

    return row.rows[0] ? mapTokenRow(row.rows[0]) : null
  }

  async findByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<McpOAuthTokenRecord | null> {
    const row = await sql<McpOAuthTokenRow>`
      select *
      from app.mcp_oauth_find_by_refresh_token_hash(${refreshTokenHash})
    `.execute(this.db)

    return row.rows[0] ? mapTokenRow(row.rows[0]) : null
  }

  async revokeByTokenHash(tokenHash: string): Promise<void> {
    await sql`
      select app.mcp_oauth_revoke_by_token_hash(${tokenHash})
    `.execute(this.db)
  }

  async touchLastUsed(tokenId: string): Promise<void> {
    await sql`
      select app.mcp_oauth_touch_last_used(${tokenId}::uuid)
    `.execute(this.db)
  }
}

export function parseRequestedScopes(
  scope: string | undefined,
): HaotikaMcpScope[] {
  if (!scope?.trim()) {
    return [...HAOTIKA_MCP_READ_SCOPES]
  }

  const requestedScopes = scope
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const invalidScope = requestedScopes.find(
    (value) => !isHaotikaMcpScope(value),
  )

  if (invalidScope) {
    throw new McpHaotikaError(
      'FORBIDDEN_SCOPE',
      `Unsupported scope: ${invalidScope}`,
      403,
    )
  }

  const scopes = requestedScopes.filter(isHaotikaMcpScope)

  return scopes.length ? [...new Set(scopes)] : [...HAOTIKA_MCP_READ_SCOPES]
}

export function createWwwAuthenticate(
  publicBaseUrl: string,
  options: {
    description: string
    error: 'insufficient_scope' | 'invalid_request' | 'invalid_token'
    scopes: readonly HaotikaMcpScope[]
  },
): string {
  const metadataUrl = new URL(
    '/.well-known/oauth-protected-resource',
    publicBaseUrl,
  ).toString()

  return [
    'Bearer',
    `resource_metadata="${metadataUrl}"`,
    `error="${options.error}"`,
    `error_description="${escapeWwwAuthenticate(options.description)}"`,
    `scope="${options.scopes.join(' ')}"`,
  ].join(' ')
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createMcpResource(publicBaseUrl: string): string {
  return new URL('/mcp', publicBaseUrl).toString()
}

function createOpaqueToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`
}

function verifyCodeChallenge(
  codeVerifier: string | undefined,
  expectedChallenge: string,
): boolean {
  if (!codeVerifier) {
    return false
  }

  const actualChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64url')

  return actualChallenge === expectedChallenge
}

function readBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null
  }

  const [scheme, token] = header.split(' ')

  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

function assertAllowedRedirectUri(
  redirectUri: string,
  config: McpHaotikaRuntimeConfig,
): void {
  let parsedUrl: URL

  try {
    parsedUrl = new URL(redirectUri)
  } catch {
    throw new McpHaotikaError('VALIDATION_ERROR', 'Invalid redirect_uri.', 400)
  }

  if (config.allowedRedirectUris.length > 0) {
    const isAllowed = config.allowedRedirectUris.some((allowedUri) =>
      matchesAllowedRedirectUri(redirectUri, allowedUri),
    )

    if (!isAllowed) {
      throw new McpHaotikaError(
        'VALIDATION_ERROR',
        'redirect_uri is not allowed.',
        400,
      )
    }

    return
  }

  const isLocalhost =
    parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1'

  if (parsedUrl.protocol !== 'https:' && !isLocalhost) {
    throw new McpHaotikaError(
      'VALIDATION_ERROR',
      'redirect_uri must use HTTPS, localhost, or 127.0.0.1.',
      400,
    )
  }
}

function matchesAllowedRedirectUri(
  redirectUri: string,
  allowedUri: string,
): boolean {
  if (allowedUri.endsWith('*')) {
    return redirectUri.startsWith(allowedUri.slice(0, -1))
  }

  return redirectUri === allowedUri
}

function resolveRequestedResource(
  requestedResource: string | undefined,
  config: McpHaotikaRuntimeConfig,
): string {
  const expectedResource = createMcpResource(config.publicBaseUrl)

  if (!requestedResource?.trim()) {
    return expectedResource
  }

  if (requestedResource.trim() !== expectedResource) {
    throw new McpHaotikaError(
      'UNAUTHORIZED',
      'Requested resource is invalid.',
      401,
      createWwwAuthenticate(config.publicBaseUrl, {
        description: 'Requested resource is invalid.',
        error: 'invalid_request',
        scopes: HAOTIKA_MCP_READ_SCOPES,
      }),
    )
  }

  return requestedResource.trim()
}

function cleanupExpiredAuthorizationCodes(
  authorizationCodes: Map<string, AuthorizationCodeRecord>,
): void {
  const now = Date.now()

  for (const [codeHash, code] of authorizationCodes.entries()) {
    if (code.expiresAt <= now) {
      authorizationCodes.delete(codeHash)
    }
  }
}

function isHaotikaMcpScope(scope: string): scope is HaotikaMcpScope {
  return HAOTIKA_MCP_READ_SCOPES.includes(scope as HaotikaMcpScope)
}

function escapeWwwAuthenticate(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function mapTokenRow(row: McpOAuthTokenRow): McpOAuthTokenRecord {
  return {
    accessTokenHash: row.access_token_hash,
    clientId: row.client_id,
    expiresAt: serializeDate(row.expires_at),
    id: row.id,
    issuer: row.issuer,
    lastUsedAt: row.last_used_at ? serializeDate(row.last_used_at) : null,
    refreshTokenHash: row.refresh_token_hash,
    resource: row.resource,
    revokedAt: row.revoked_at ? serializeDate(row.revoked_at) : null,
    scopes: row.scopes.filter(isHaotikaMcpScope),
    userId: row.user_id,
  }
}

function serializeDate(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value
}
