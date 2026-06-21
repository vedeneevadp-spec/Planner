import type { HaotikaMcpScope } from '../ai-context/index.js'

export type McpErrorCode =
  | 'FORBIDDEN_SCOPE'
  | 'INTERNAL_ERROR'
  | 'MCP_DISABLED'
  | 'RATE_LIMIT_EXCEEDED'
  | 'TOKEN_EXPIRED'
  | 'UNAUTHORIZED'
  | 'VALIDATION_ERROR'

export interface McpErrorPayload {
  error: {
    code: McpErrorCode
    message: string
  }
}

export class McpHaotikaError extends Error {
  constructor(
    public readonly code: McpErrorCode,
    message: string,
    public readonly statusCode = 400,
    public readonly wwwAuthenticate?: string,
  ) {
    super(message)
    this.name = 'McpHaotikaError'
  }
}

export interface McpOAuthTokenRecord {
  accessTokenHash: string
  clientId: string | null
  expiresAt: string
  id: string
  issuer: string
  lastUsedAt: string | null
  refreshTokenHash: string | null
  resource: string
  revokedAt: string | null
  scopes: HaotikaMcpScope[]
  userId: string
}

export interface CreateMcpOAuthTokenCommand {
  accessTokenHash: string
  clientId: string | null
  expiresAt: Date
  issuer: string
  refreshTokenHash: string | null
  resource: string
  scopes: HaotikaMcpScope[]
  userId: string
}

export interface McpOAuthTokenRepository {
  createToken(command: CreateMcpOAuthTokenCommand): Promise<McpOAuthTokenRecord>
  findByAccessTokenHash(
    accessTokenHash: string,
  ): Promise<McpOAuthTokenRecord | null>
  findByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<McpOAuthTokenRecord | null>
  revokeByTokenHash(tokenHash: string): Promise<void>
  touchLastUsed(tokenId: string): Promise<void>
}

export interface McpAuthContext {
  scopes: HaotikaMcpScope[]
  tokenId: string
  userId: string
}

export interface McpAuditLogCommand {
  input: unknown
  ipHash: string | null
  outputSummary: Record<string, unknown>
  tokenId: string | null
  toolName: string
  userAgent: string | null
  userId: string | null
}

export interface McpAuditLogRepository {
  createLog(command: McpAuditLogCommand): Promise<void>
}

export interface McpHaotikaRuntimeConfig {
  allowedRedirectUris: string[]
  devNoAuth: boolean
  enabled: boolean
  oauthIssuer: string
  publicBaseUrl: string
  rateLimitPerMinute: number
}

export interface McpToolDescriptor {
  _meta: {
    securitySchemes: Array<{
      scopes: HaotikaMcpScope[]
      type: 'oauth2'
    }>
  }
  annotations: {
    destructiveHint: false
    idempotentHint: true
    openWorldHint: false
    readOnlyHint: true
  }
  description: string
  inputSchema: Record<string, unknown>
  name: string
  outputSchema: Record<string, unknown>
  securitySchemes: Array<{
    scopes: HaotikaMcpScope[]
    type: 'oauth2'
  }>
  title: string
}
