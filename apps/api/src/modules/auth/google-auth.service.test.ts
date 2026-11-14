import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthUserRecord, PlannerAuthRuntimeConfig } from './auth.model.js'
import type {
  CompleteGoogleSignInCommand,
  GoogleAuthRepository,
} from './google-auth.repository.js'
import { GoogleAuthService } from './google-auth.service.js'

const clientId = '123-web.apps.googleusercontent.com'
const config: PlannerAuthRuntimeConfig = {
  accessTokenTtlSeconds: 900,
  emailFrom: 'test@example.test',
  jwt: {
    audience: 'authenticated',
    issuer: 'planner-api',
    secret: 'test-google-auth-secret-with-at-least-32-characters',
  },
  passwordResetTtlSeconds: 3600,
  publicAppUrl: 'http://localhost:5173',
  refreshTokenTtlSeconds: 86400,
  smtp: null,
}
const keyPair = await generateKeyPair('RS256')
const jwk = await exportJWK(keyPair.publicKey)
const keys = createLocalJWKSet({
  keys: [{ ...jwk, alg: 'RS256', kid: 'test' }],
})
const metadata = { deviceId: 'device-a' }
const user: AuthUserRecord = {
  id: '019d0000-0000-7000-8000-000000000001',
  email: 'owner@example.test',
  displayName: 'Owner',
}

function fixture(
  existingUser: AuthUserRecord | null = null,
  linkedUser: AuthUserRecord | null = null,
) {
  const commands: CompleteGoogleSignInCommand[] = []
  const usedNonces = new Set<string>()
  const repository: GoogleAuthRepository = {
    findUserBySubject: () => Promise.resolve(linkedUser),
    completeSignIn: (command) => {
      if (usedNonces.has(command.nonceHash))
        return Promise.reject(
          new HttpError(401, 'auth_google_challenge_invalid', 'Used'),
        )
      usedNonces.add(command.nonceHash)
      commands.push(command)
      return Promise.resolve(user)
    },
  }
  const service = new GoogleAuthService(
    clientId,
    config,
    repository,
    {
      findUserByEmail: () => Promise.resolve(existingUser),
    },
    {
      authenticatePassword: (input) =>
        input.password === 'correct-password'
          ? Promise.resolve(user)
          : Promise.reject(
              new HttpError(401, 'auth_invalid_credentials', 'Wrong password'),
            ),
      createSession: (identity) =>
        Promise.resolve({
          accessToken: 'planner-access',
          refreshToken: 'planner-refresh',
          expiresAt: new Date().toISOString(),
          user: identity,
        }),
    },
    keys,
  )
  return { commands, service }
}

async function token(
  nonce: string,
  claims: Record<string, unknown> = {},
  signer = keyPair.privateKey,
) {
  return new SignJWT({
    email: user.email,
    email_verified: true,
    name: user.displayName,
    nonce,
    sub: 'google-subject',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test' })
    .setIssuer(
      typeof claims.iss === 'string'
        ? claims.iss
        : 'https://accounts.google.com',
    )
    .setAudience(typeof claims.aud === 'string' ? claims.aud : clientId)
    .setIssuedAt()
    .setExpirationTime(typeof claims.exp === 'number' ? claims.exp : '1h')
    .sign(signer)
}

void describe('Google identity authentication', () => {
  void it('creates our normal session after signature, nonce and email verification', async () => {
    const { service, commands } = fixture()
    const challenge = await service.createChallenge(metadata)
    const result = await service.signIn(
      {
        challengeToken: challenge.challengeToken,
        idToken: await token(challenge.nonce),
      },
      metadata,
    )
    assert.equal(result.accessToken, 'planner-access')
    assert.equal(commands[0]?.subject, 'google-subject')
    assert.equal(commands[0]?.linkUserId, null)
    assert.notEqual(commands[0]?.nonceHash, challenge.nonce)
  })

  for (const [name, claims] of Object.entries({
    'wrong audience': { aud: 'another-client' },
    'wrong issuer': { iss: 'https://attacker.test' },
    'expired token': { exp: 1 },
    'wrong nonce': { nonce: 'other-nonce' },
    'unverified email': { email_verified: false },
    'missing subject': { sub: '' },
  })) {
    void it(`rejects ${name} before account or session creation`, async () => {
      const { service, commands } = fixture()
      const challenge = await service.createChallenge(metadata)
      await assert.rejects(
        service.signIn(
          {
            challengeToken: challenge.challengeToken,
            idToken: await token(challenge.nonce, claims),
          },
          metadata,
        ),
        { code: 'auth_google_token_invalid' },
      )
      assert.equal(commands.length, 0)
    })
  }

  void it('rejects a forged Google signature', async () => {
    const { service, commands } = fixture()
    const challenge = await service.createChallenge(metadata)
    const attacker = await generateKeyPair('RS256')
    await assert.rejects(
      service.signIn(
        {
          challengeToken: challenge.challengeToken,
          idToken: await token(challenge.nonce, {}, attacker.privateKey),
        },
        metadata,
      ),
      { code: 'auth_google_token_invalid' },
    )
    assert.equal(commands.length, 0)
  })

  void it('rejects a challenge from another device and a reused challenge', async () => {
    const { service } = fixture()
    const challenge = await service.createChallenge(metadata)
    const input = {
      challengeToken: challenge.challengeToken,
      idToken: await token(challenge.nonce),
    }
    await assert.rejects(service.signIn(input, { deviceId: 'device-b' }), {
      code: 'auth_google_challenge_invalid',
    })
    await service.signIn(input, metadata)
    await assert.rejects(service.signIn(input, metadata), {
      code: 'auth_google_challenge_invalid',
    })
  })

  void it('rejects tampered, expired and access-token-shaped challenges', async () => {
    const { service, commands } = fixture()
    const challenge = await service.createChallenge(metadata)
    const idToken = await token(challenge.nonce)
    const secret = new TextEncoder().encode(config.jwt.secret)
    const expired = await new SignJWT({ deviceId: metadata.deviceId })
      .setProtectedHeader({ alg: 'HS256', typ: 'google-sign-in+jwt' })
      .setAudience('planner-google-sign-in')
      .setIssuer(config.jwt.issuer)
      .setJti(challenge.nonce)
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(secret)
    const access = await new SignJWT({ deviceId: metadata.deviceId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setAudience('authenticated')
      .setIssuer(config.jwt.issuer)
      .setJti(challenge.nonce)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(secret)
    for (const challengeToken of ['not-a-jwt', expired, access]) {
      await assert.rejects(
        service.signIn({ challengeToken, idToken }, metadata),
        { code: 'auth_google_challenge_invalid' },
      )
    }
    assert.equal(commands.length, 0)
    await assert.rejects(service.createChallenge({}), {
      code: 'auth_device_id_required',
    })
  })

  void it('requires the existing password once and preserves the account id', async () => {
    const { service, commands } = fixture(user)
    const challenge = await service.createChallenge(metadata)
    const input = {
      challengeToken: challenge.challengeToken,
      idToken: await token(challenge.nonce),
    }
    await assert.rejects(service.signIn(input, metadata), {
      code: 'auth_google_link_required',
    })
    await assert.rejects(
      service.signIn({ ...input, currentPassword: 'wrong-password' }, metadata),
      { code: 'auth_invalid_credentials' },
    )
    assert.equal(commands.length, 0)
    const result = await service.signIn(
      { ...input, currentPassword: 'correct-password' },
      metadata,
    )
    assert.equal(result.user.id, user.id)
    assert.equal(commands[0]?.linkUserId, user.id)
  })

  void it('uses an existing subject even when the Google email changes', async () => {
    const { service, commands } = fixture(null, user)
    const challenge = await service.createChallenge(metadata)
    const result = await service.signIn(
      {
        challengeToken: challenge.challengeToken,
        idToken: await token(challenge.nonce, {
          email: 'changed@example.test',
        }),
      },
      metadata,
    )
    assert.equal(result.user.id, user.id)
    assert.equal(commands[0]?.linkUserId, null)
  })
})
