import type { JwtAuthRuntimeConfig } from '../../infrastructure/auth/jwt-request-authenticator.js'

export interface PlannerAuthSmtpConfig {
  host: string
  password?: string | undefined
  port: number
  secure: boolean
  user?: string | undefined
}

export interface PlannerAuthRuntimeConfig {
  accessTokenTtlSeconds: number
  emailFrom: string
  jwt: JwtAuthRuntimeConfig
  passwordResetTtlSeconds: number
  publicAppUrl: string
  refreshTokenTtlSeconds: number
  smtp: PlannerAuthSmtpConfig | null
}

export interface AuthRequestMetadata {
  ipAddress?: string | undefined
  userAgent?: string | undefined
}

export interface AuthUserRecord {
  displayName: string
  email: string
  id: string
}

export interface AuthCredentialRecord extends AuthUserRecord {
  passwordHash: string
}

export interface AuthSessionTokenRecord extends AuthUserRecord {
  sessionId: string
}

export interface CreateAuthUserCommand {
  displayName: string
  email: string
  passwordHash: string
  userId: string
}

export interface CreateRefreshTokenPayload {
  expiresAt: Date
  metadata: AuthRequestMetadata
  refreshTokenHash: string
  sessionId: string
}

export interface CreateRefreshTokenCommand extends CreateRefreshTokenPayload {
  userId: string
}

export interface CreatePasswordResetTokenCommand {
  expiresAt: Date
  metadata: AuthRequestMetadata
  resetTokenHash: string
  userId: string
}

export interface CreateOAuthAuthorizationCodeCommand {
  clientId: string
  codeHash: string
  expiresAt: Date
  metadata: AuthRequestMetadata
  redirectUri: string
  scope: string
  userId: string
}

export interface ExchangeOAuthAuthorizationCodeCommand {
  clientId: string
  codeHash: string
  redirectUri: string
  refreshToken: CreateRefreshTokenPayload
}

export interface CompletePasswordResetCommand {
  metadata: AuthRequestMetadata
  passwordHash: string
  refreshToken: CreateRefreshTokenPayload
  resetTokenHash: string
}

export interface UpdatePasswordCommand {
  passwordHash: string
  userId: string
}
