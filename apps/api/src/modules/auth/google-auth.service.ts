import { createHash, randomBytes } from 'node:crypto'

import type {
  AuthTokenResponse,
  GoogleAuthChallenge,
  GoogleAuthSignInInput,
} from '@planner/contracts'
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  SignJWT,
} from 'jose'
import { z } from 'zod'

import { HttpError } from '../../bootstrap/http-error.js'
import type {
  AuthRequestMetadata,
  PlannerAuthRuntimeConfig,
} from './auth.model.js'
import type { AuthRepository } from './auth.repository.js'
import type { AuthService } from './auth.service.js'
import type { GoogleAuthRepository } from './google-auth.repository.js'

const CHALLENGE_AUDIENCE = 'planner-google-sign-in'
const CHALLENGE_TTL_SECONDS = 600
const googleKeys = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
  { timeoutDuration: 5000 },
)
const googleClaimsSchema = z.object({
  email: z.string().email().max(320),
  email_verified: z.literal(true),
  name: z.string().optional(),
  nonce: z.string().min(1),
  sub: z.string().min(1).max(255),
})

export class GoogleAuthService {
  private readonly secret: Uint8Array

  constructor(
    readonly clientId: string,
    private readonly config: PlannerAuthRuntimeConfig,
    private readonly repository: GoogleAuthRepository,
    private readonly authRepository: Pick<AuthRepository, 'findUserByEmail'>,
    private readonly authService: Pick<
      AuthService,
      'authenticatePassword' | 'createSession'
    >,
    private readonly keys: JWTVerifyGetKey = googleKeys,
  ) {
    this.secret = new TextEncoder().encode(config.jwt.secret)
  }

  async createChallenge(
    metadata: AuthRequestMetadata,
  ): Promise<GoogleAuthChallenge> {
    const deviceId = requireDeviceId(metadata)
    const nonce = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SECONDS * 1000)
    const challengeToken = await new SignJWT({ deviceId })
      .setProtectedHeader({ alg: 'HS256', typ: 'google-sign-in+jwt' })
      .setIssuer(this.config.jwt.issuer)
      .setAudience(CHALLENGE_AUDIENCE)
      .setJti(nonce)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.secret)
    return {
      challengeToken,
      clientId: this.clientId,
      expiresAt: expiresAt.toISOString(),
      nonce,
    }
  }

  async signIn(
    input: GoogleAuthSignInInput,
    metadata: AuthRequestMetadata,
  ): Promise<AuthTokenResponse> {
    const deviceId = requireDeviceId(metadata)
    const challenge = await jwtVerify(input.challengeToken, this.secret, {
      algorithms: ['HS256'],
      audience: CHALLENGE_AUDIENCE,
      issuer: this.config.jwt.issuer,
      typ: 'google-sign-in+jwt',
      requiredClaims: ['jti', 'exp', 'iat'],
      maxTokenAge: CHALLENGE_TTL_SECONDS,
    }).catch(() => {
      throw new HttpError(
        401,
        'auth_google_challenge_invalid',
        'Start Google sign-in again.',
      )
    })
    if (challenge.payload.deviceId !== deviceId) {
      throw new HttpError(
        401,
        'auth_google_challenge_invalid',
        'Google sign-in belongs to another device.',
      )
    }

    const verified = await jwtVerify(input.idToken, this.keys, {
      algorithms: ['RS256'],
      audience: this.clientId,
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      requiredClaims: ['exp', 'iat', 'sub'],
    }).catch(() => {
      throw new HttpError(
        401,
        'auth_google_token_invalid',
        'Google could not verify this sign-in.',
      )
    })
    const claims = googleClaimsSchema.safeParse(verified.payload)
    if (!claims.success || claims.data.nonce !== challenge.payload.jti) {
      throw new HttpError(
        401,
        'auth_google_token_invalid',
        'Google could not verify this sign-in.',
      )
    }

    const { sub: subject, name } = claims.data
    const email = claims.data.email.trim().toLowerCase()
    const linkedUser = await this.repository.findUserBySubject(subject)
    let linkUserId: string | null = null
    if (!linkedUser) {
      const existingUser = await this.authRepository.findUserByEmail(email)
      if (existingUser) {
        if (!input.currentPassword) {
          throw new HttpError(
            409,
            'auth_google_link_required',
            'Confirm the existing account password to link Google.',
          )
        }
        const authenticated = await this.authService.authenticatePassword(
          { email, password: input.currentPassword },
          metadata,
        )
        linkUserId = authenticated.id
      }
    }

    const user = await this.repository.completeSignIn({
      displayName: (
        name?.trim() ||
        email.split('@')[0] ||
        'Пользователь'
      ).slice(0, 80),
      email,
      expiresAt: new Date(challenge.payload.exp! * 1000),
      linkUserId,
      nonceHash: createHash('sha256')
        .update(challenge.payload.jti)
        .digest('hex'),
      subject,
    })
    return this.authService.createSession(user, metadata)
  }
}

function requireDeviceId(metadata: AuthRequestMetadata): string {
  if (!metadata.deviceId)
    throw new HttpError(
      400,
      'auth_device_id_required',
      'An auth device id is required.',
    )
  return metadata.deviceId
}
