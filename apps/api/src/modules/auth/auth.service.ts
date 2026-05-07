import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

import {
  authPasswordSchema,
  type AuthTokenResponse,
  generateUuidV7,
} from '@planner/contracts'
import { SignJWT } from 'jose'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthEmailSender } from './auth.email.js'
import type {
  AuthRequestMetadata,
  AuthSessionTokenRecord,
  AuthUserRecord,
  PlannerAuthRuntimeConfig,
} from './auth.model.js'
import type { AuthRepository } from './auth.repository.js'

const SCRYPT_KEY_LENGTH = 64
const SCRYPT_OPTIONS = {
  N: 16_384,
  maxmem: 64 * 1024 * 1024,
  p: 1,
  r: 8,
}
interface ScryptOptions {
  N: number
  maxmem?: number
  p: number
  r: number
}

export class AuthService {
  private readonly jwtSecretKey: Uint8Array

  constructor(
    private readonly repository: AuthRepository,
    private readonly emailSender: AuthEmailSender,
    private readonly config: PlannerAuthRuntimeConfig,
  ) {
    this.jwtSecretKey = new TextEncoder().encode(config.jwt.secret)
  }

  async signIn(
    input: { email: string; password: string },
    metadata: AuthRequestMetadata,
  ): Promise<AuthTokenResponse> {
    const credential = await this.repository.findCredentialByEmail(input.email)

    if (
      !credential ||
      !(await verifyPassword(input.password, credential.passwordHash))
    ) {
      throw invalidCredentialsError()
    }

    return this.createSession(credential, metadata)
  }

  async signUp(
    input: { displayName?: string; email: string; password: string },
    metadata: AuthRequestMetadata,
  ): Promise<AuthTokenResponse> {
    const email = normalizeEmail(input.email)
    const passwordHash = await hashPassword(input.password)
    const displayName =
      input.displayName?.trim() || resolveDisplayNameFromEmail(email)
    const user = await this.repository.createUserWithCredential({
      displayName,
      email,
      passwordHash,
      userId: generateUuidV7(),
    })

    return this.createSession(user, metadata)
  }

  async refresh(
    refreshToken: string,
    metadata: AuthRequestMetadata,
  ): Promise<AuthTokenResponse> {
    const nextRefreshToken = createOpaqueToken()
    const sessionId = generateUuidV7()
    const user = await this.repository.rotateRefreshToken(
      hashOpaqueToken(refreshToken),
      {
        expiresAt: this.createRefreshTokenExpiresAt(),
        metadata,
        refreshTokenHash: hashOpaqueToken(nextRefreshToken),
        sessionId,
      },
    )

    if (!user) {
      throw invalidRefreshTokenError()
    }

    return this.createTokenResponse(user, nextRefreshToken, user.sessionId)
  }

  async signOut(refreshToken: string): Promise<void> {
    await this.repository.revokeRefreshToken(hashOpaqueToken(refreshToken))
  }

  async requestPasswordReset(
    email: string,
    metadata: AuthRequestMetadata,
  ): Promise<void> {
    const user = await this.repository.findUserByEmail(email)

    if (!user) {
      return
    }

    const resetToken = createOpaqueToken()
    await this.repository.createPasswordResetToken({
      expiresAt: addSeconds(this.config.passwordResetTtlSeconds),
      metadata,
      resetTokenHash: hashOpaqueToken(resetToken),
      userId: user.id,
    })
    await this.emailSender.sendPasswordResetEmail({
      email: user.email,
      resetUrl: this.createPasswordResetUrl(resetToken),
    })
  }

  async confirmPasswordReset(
    input: { password: string; token: string },
    metadata: AuthRequestMetadata,
  ): Promise<AuthTokenResponse> {
    const refreshToken = createOpaqueToken()
    const sessionId = generateUuidV7()
    const user = await this.repository.completePasswordReset({
      metadata,
      passwordHash: await hashPassword(input.password),
      refreshToken: {
        expiresAt: this.createRefreshTokenExpiresAt(),
        metadata,
        refreshTokenHash: hashOpaqueToken(refreshToken),
        sessionId,
      },
      resetTokenHash: hashOpaqueToken(input.token),
    })

    if (!user) {
      throw new HttpError(
        400,
        'auth_password_reset_token_invalid',
        'Password reset link is invalid or expired.',
      )
    }

    return this.createTokenResponse(user, refreshToken, user.sessionId)
  }

  async updatePassword(
    userId: string,
    input: { currentPassword: string; password: string },
  ): Promise<void> {
    const credential = await this.repository.findCredentialByUserId(userId)

    if (
      !credential ||
      !(await verifyPassword(input.currentPassword, credential.passwordHash))
    ) {
      throw invalidCredentialsError()
    }

    await this.repository.updatePassword({
      passwordHash: await hashPassword(input.password),
      userId,
    })
  }

  private async createSession(
    user: AuthUserRecord,
    metadata: AuthRequestMetadata,
  ): Promise<AuthTokenResponse> {
    const refreshToken = createOpaqueToken()
    const sessionId = generateUuidV7()

    await this.repository.createRefreshToken({
      expiresAt: this.createRefreshTokenExpiresAt(),
      metadata,
      refreshTokenHash: hashOpaqueToken(refreshToken),
      sessionId,
      userId: user.id,
    })

    return this.createTokenResponse(user, refreshToken, sessionId)
  }

  private async createTokenResponse(
    user: AuthUserRecord | AuthSessionTokenRecord,
    refreshToken: string,
    sessionId: string,
  ): Promise<AuthTokenResponse> {
    const expiresAt = addSeconds(this.config.accessTokenTtlSeconds)
    const accessToken = await new SignJWT({
      email: user.email,
      role: 'authenticated',
      session_id: sessionId,
      user_metadata: {
        display_name: user.displayName,
      },
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setAudience(this.config.jwt.audience)
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .setIssuedAt()
      .setIssuer(this.config.jwt.issuer)
      .setSubject(user.id)
      .sign(this.jwtSecretKey)

    return {
      accessToken,
      expiresAt: expiresAt.toISOString(),
      refreshToken,
      user: {
        email: user.email,
        id: user.id,
      },
    }
  }

  private createRefreshTokenExpiresAt(): Date {
    return addSeconds(this.config.refreshTokenTtlSeconds)
  }

  private createPasswordResetUrl(resetToken: string): string {
    const url = new URL(this.config.publicAppUrl)
    url.searchParams.set('reset_token', resetToken)

    return url.toString()
  }
}

async function hashPassword(password: string): Promise<string> {
  const parsedPassword = authPasswordSchema.parse(password)
  const salt = randomBytes(16).toString('base64url')
  const derivedKey = await scryptAsync(parsedPassword, salt, SCRYPT_KEY_LENGTH)

  return [
    'scrypt',
    `N=${SCRYPT_OPTIONS.N},r=${SCRYPT_OPTIONS.r},p=${SCRYPT_OPTIONS.p}`,
    salt,
    derivedKey.toString('base64url'),
  ].join('$')
}

async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  const [algorithm, rawParams, salt, rawHash] = storedHash.split('$')

  if (algorithm !== 'scrypt' || !rawParams || !salt || !rawHash) {
    return false
  }

  const params = parseScryptParams(rawParams)

  if (!params) {
    return false
  }

  const expectedHash = Buffer.from(rawHash, 'base64url')
  const actualHash = await scryptAsync(password, salt, expectedHash.length, {
    N: params.N,
    p: params.p,
    r: params.r,
  })

  return (
    actualHash.length === expectedHash.length &&
    timingSafeEqual(actualHash, expectedHash)
  )
}

function parseScryptParams(
  rawParams: string,
): { N: number; p: number; r: number } | null {
  const entries = new Map(
    rawParams.split(',').map((entry) => {
      const [key, value] = entry.split('=')
      return [key, Number(value)]
    }),
  )
  const N = entries.get('N')
  const p = entries.get('p')
  const r = entries.get('r')

  if (!N || !p || !r) {
    return null
  }

  return { N, p, r }
}

function scryptAsync(
  password: string,
  salt: string,
  keyLength: number,
  options: ScryptOptions = SCRYPT_OPTIONS,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error)
        return
      }

      resolve(derivedKey)
    })
  })
}

function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function addSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function resolveDisplayNameFromEmail(email: string): string {
  return email.split('@')[0]?.trim() || 'Planner User'
}

function invalidCredentialsError(): HttpError {
  return new HttpError(
    401,
    'auth_invalid_credentials',
    'Invalid email or password.',
  )
}

function invalidRefreshTokenError(): HttpError {
  return new HttpError(
    401,
    'auth_refresh_token_invalid',
    'Refresh token is invalid or expired.',
  )
}
