import { generateUuidV7 } from '@planner/contracts'
import type { Kysely } from 'kysely'
import { type Selectable, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { DatabaseExecutor } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  AuthCredentialRecord,
  AuthSessionTokenRecord,
  AuthUserRecord,
  CompletePasswordResetCommand,
  CreateAuthUserCommand,
  CreateOAuthAuthorizationCodeCommand,
  CreatePasswordResetTokenCommand,
  CreateRefreshTokenCommand,
  ExchangeOAuthAuthorizationCodeCommand,
  RotateRefreshTokenPayload,
  UpdatePasswordCommand,
} from './auth.model.js'
import type { AuthRepository } from './auth.repository.js'

const REFRESH_TOKEN_REUSE_GRACE_MS = 24 * 60 * 60 * 1000

type AuthUserRow = Pick<
  Selectable<DatabaseSchema['app.users']>,
  'display_name' | 'email' | 'id'
>

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findCredentialByEmail(
    email: string,
  ): Promise<AuthCredentialRecord | null> {
    const row = await this.db
      .selectFrom('app.auth_credentials as credential')
      .innerJoin('app.users as user', 'user.id', 'credential.user_id')
      .select([
        'credential.email',
        'credential.password_hash as passwordHash',
        'user.display_name as displayName',
        'user.id',
      ])
      .where('credential.email', '=', normalizeEmail(email))
      .where('credential.deleted_at', 'is', null)
      .where('user.deleted_at', 'is', null)
      .executeTakeFirst()

    return row
      ? {
          displayName: row.displayName,
          email: row.email,
          id: row.id,
          passwordHash: row.passwordHash,
        }
      : null
  }

  async findCredentialByUserId(
    userId: string,
  ): Promise<AuthCredentialRecord | null> {
    const row = await this.db
      .selectFrom('app.auth_credentials as credential')
      .innerJoin('app.users as user', 'user.id', 'credential.user_id')
      .select([
        'credential.email',
        'credential.password_hash as passwordHash',
        'user.display_name as displayName',
        'user.id',
      ])
      .where('credential.user_id', '=', userId)
      .where('credential.deleted_at', 'is', null)
      .where('user.deleted_at', 'is', null)
      .executeTakeFirst()

    return row
      ? {
          displayName: row.displayName,
          email: row.email,
          id: row.id,
          passwordHash: row.passwordHash,
        }
      : null
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const row = await this.db
      .selectFrom('app.users')
      .select(['display_name', 'email', 'id'])
      .where('email', '=', normalizeEmail(email))
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    return row ? mapAuthUserRow(row) : null
  }

  async createUserWithCredential(
    command: CreateAuthUserCommand,
  ): Promise<AuthUserRecord> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const insertedUser = await trx
          .insertInto('app.users')
          .values({
            app_role: await this.resolveInitialAppRole(),
            display_name: command.displayName,
            email: normalizeEmail(command.email),
            id: command.userId,
            locale: 'ru-RU',
            timezone: 'Asia/Novosibirsk',
          })
          .returning(['display_name', 'email', 'id'])
          .executeTakeFirstOrThrow()

        await trx
          .insertInto('app.auth_credentials')
          .values({
            email: normalizeEmail(command.email),
            password_hash: command.passwordHash,
            user_id: insertedUser.id,
          })
          .execute()

        return mapAuthUserRow(insertedUser)
      })
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new HttpError(
          409,
          'auth_email_taken',
          'This email is already registered.',
        )
      }

      throw error
    }
  }

  async createRefreshToken(command: CreateRefreshTokenCommand): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await useFastAuthTokenCommit(trx)
      await this.insertRefreshToken(trx, command)
    })
  }

  async createOAuthAuthorizationCode(
    command: CreateOAuthAuthorizationCodeCommand,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await useFastAuthTokenCommit(trx)

      await trx
        .insertInto('app.oauth_authorization_codes')
        .values({
          client_id: command.clientId,
          code_hash: command.codeHash,
          expires_at: command.expiresAt,
          id: generateUuidV7(),
          ip_address: command.metadata.ipAddress ?? null,
          redirect_uri: command.redirectUri,
          scope: command.scope,
          user_agent: command.metadata.userAgent ?? null,
          user_id: command.userId,
        })
        .execute()
    })
  }

  async exchangeOAuthAuthorizationCode(
    command: ExchangeOAuthAuthorizationCodeCommand,
  ): Promise<AuthSessionTokenRecord | null> {
    return this.db.transaction().execute(async (trx) => {
      await useFastAuthTokenCommit(trx)

      const authorizationCode = await trx
        .selectFrom('app.oauth_authorization_codes as code')
        .innerJoin('app.users as user', 'user.id', 'code.user_id')
        .select([
          'code.client_id as clientId',
          'code.consumed_at as consumedAt',
          'code.expires_at as expiresAt',
          'code.id as codeId',
          'code.redirect_uri as redirectUri',
          'user.deleted_at as userDeletedAt',
          'user.display_name as displayName',
          'user.email',
          'user.id',
        ])
        .where('code.code_hash', '=', command.codeHash)
        .executeTakeFirst()

      if (
        !authorizationCode ||
        authorizationCode.clientId !== command.clientId ||
        authorizationCode.redirectUri !== command.redirectUri ||
        authorizationCode.consumedAt ||
        authorizationCode.userDeletedAt ||
        new Date(authorizationCode.expiresAt).getTime() <= Date.now()
      ) {
        return null
      }

      const updateResult = await trx
        .updateTable('app.oauth_authorization_codes')
        .set({
          consumed_at: new Date(),
        })
        .where('id', '=', authorizationCode.codeId)
        .where('consumed_at', 'is', null)
        .executeTakeFirst()

      if (Number(updateResult.numUpdatedRows) !== 1) {
        return null
      }

      await this.insertRefreshToken(trx, {
        ...command.refreshToken,
        userId: authorizationCode.id,
      })

      return {
        displayName: authorizationCode.displayName,
        email: authorizationCode.email,
        id: authorizationCode.id,
        sessionId: command.refreshToken.sessionId,
      }
    })
  }

  async rotateRefreshToken(
    currentRefreshTokenHash: string,
    nextRefreshToken: RotateRefreshTokenPayload,
  ): Promise<AuthSessionTokenRecord | null> {
    return this.db.transaction().execute(async (trx) => {
      await useFastAuthTokenCommit(trx)

      const currentToken = await trx
        .selectFrom('app.auth_refresh_tokens as token')
        .innerJoin('app.users as user', 'user.id', 'token.user_id')
        .select([
          'token.expires_at as expiresAt',
          'token.id as tokenId',
          'token.rotated_at as rotatedAt',
          'token.revoked_at as revokedAt',
          'token.session_id as sessionId',
          'user.deleted_at as userDeletedAt',
          'user.display_name as displayName',
          'user.email',
          'user.id',
        ])
        .where('token.token_hash', '=', currentRefreshTokenHash)
        .forUpdate()
        .executeTakeFirst()

      if (
        !currentToken ||
        currentToken.revokedAt ||
        currentToken.userDeletedAt ||
        new Date(currentToken.expiresAt).getTime() <= Date.now()
      ) {
        return null
      }

      const now = new Date()
      const rotatedAt = currentToken.rotatedAt

      if (
        rotatedAt &&
        !isWithinRefreshTokenReuseGrace(new Date(rotatedAt), now)
      ) {
        await this.revokeRefreshTokenSession(trx, currentToken.sessionId, now)

        return null
      }

      const tokenToRotate = rotatedAt
        ? await this.findActiveRefreshTokenForSession(trx, {
            sessionId: currentToken.sessionId,
            userId: currentToken.id,
          })
        : currentToken

      if (!tokenToRotate) {
        return null
      }

      const nextTokenId = generateUuidV7()
      const updateResult = await trx
        .updateTable('app.auth_refresh_tokens')
        .set({
          last_used_at: now,
          rotated_at: now,
        })
        .where('id', '=', tokenToRotate.tokenId)
        .where('revoked_at', 'is', null)
        .where('rotated_at', 'is', null)
        .executeTakeFirst()

      if (Number(updateResult.numUpdatedRows) !== 1) {
        return null
      }

      await this.insertRefreshToken(trx, {
        ...nextRefreshToken,
        id: nextTokenId,
        userId: currentToken.id,
        sessionId: currentToken.sessionId,
      })

      await trx
        .updateTable('app.auth_refresh_tokens')
        .set({
          replaced_by_token_id: nextTokenId,
        })
        .where('id', '=', tokenToRotate.tokenId)
        .execute()

      return {
        displayName: currentToken.displayName,
        email: currentToken.email,
        id: currentToken.id,
        sessionId: currentToken.sessionId,
      }
    })
  }

  async revokeRefreshToken(refreshTokenHash: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const token = await trx
        .selectFrom('app.auth_refresh_tokens')
        .select('session_id as sessionId')
        .where('token_hash', '=', refreshTokenHash)
        .executeTakeFirst()

      if (!token) {
        return
      }

      await this.revokeRefreshTokenSession(trx, token.sessionId, new Date())
    })
  }

  async createPasswordResetToken(
    command: CreatePasswordResetTokenCommand,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await useFastAuthTokenCommit(trx)

      await trx
        .updateTable('app.auth_password_reset_tokens')
        .set({
          used_at: new Date(),
        })
        .where('user_id', '=', command.userId)
        .where('used_at', 'is', null)
        .execute()

      await trx
        .insertInto('app.auth_password_reset_tokens')
        .values({
          expires_at: command.expiresAt,
          id: generateUuidV7(),
          ip_address: command.metadata.ipAddress ?? null,
          token_hash: command.resetTokenHash,
          user_agent: command.metadata.userAgent ?? null,
          user_id: command.userId,
        })
        .execute()
    })
  }

  async completePasswordReset(
    command: CompletePasswordResetCommand,
  ): Promise<AuthSessionTokenRecord | null> {
    return this.db.transaction().execute(async (trx) => {
      await useFastAuthTokenCommit(trx)

      const resetToken = await trx
        .selectFrom('app.auth_password_reset_tokens as token')
        .innerJoin('app.users as user', 'user.id', 'token.user_id')
        .select([
          'token.expires_at as expiresAt',
          'token.id as tokenId',
          'token.used_at as usedAt',
          'user.deleted_at as userDeletedAt',
          'user.display_name as displayName',
          'user.email',
          'user.id',
        ])
        .where('token.token_hash', '=', command.resetTokenHash)
        .executeTakeFirst()

      if (
        !resetToken ||
        resetToken.usedAt ||
        resetToken.userDeletedAt ||
        new Date(resetToken.expiresAt).getTime() <= Date.now()
      ) {
        return null
      }

      const updateResult = await trx
        .updateTable('app.auth_password_reset_tokens')
        .set({
          used_at: new Date(),
        })
        .where('id', '=', resetToken.tokenId)
        .where('used_at', 'is', null)
        .executeTakeFirst()

      if (Number(updateResult.numUpdatedRows) !== 1) {
        return null
      }

      await this.upsertCredential(trx, {
        email: resetToken.email,
        passwordHash: command.passwordHash,
        userId: resetToken.id,
      })
      await this.revokeUserRefreshTokens(trx, resetToken.id)
      await this.insertRefreshToken(trx, {
        ...command.refreshToken,
        userId: resetToken.id,
      })

      return {
        displayName: resetToken.displayName,
        email: resetToken.email,
        id: resetToken.id,
        sessionId: command.refreshToken.sessionId,
      }
    })
  }

  async updatePassword(command: UpdatePasswordCommand): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const user = await trx
        .selectFrom('app.users')
        .select(['email', 'id'])
        .where('id', '=', command.userId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst()

      if (!user) {
        throw new HttpError(404, 'auth_user_not_found', 'User was not found.')
      }

      await this.upsertCredential(trx, {
        email: user.email,
        passwordHash: command.passwordHash,
        userId: user.id,
      })
      await this.revokeUserRefreshTokens(trx, user.id)
    })
  }

  private async resolveInitialAppRole(): Promise<'owner' | 'user'> {
    const ownerCount = await this.db
      .selectFrom('app.users')
      .select(({ fn }) => fn.countAll<number>().as('total'))
      .where('app_role', '=', 'owner')
      .where('deleted_at', 'is', null)
      .executeTakeFirst()

    return Number(ownerCount?.total ?? 0) > 0 ? 'user' : 'owner'
  }

  private async insertRefreshToken(
    executor: DatabaseExecutor,
    command: CreateRefreshTokenCommand & { id?: string | undefined },
  ): Promise<void> {
    await executor
      .insertInto('app.auth_refresh_tokens')
      .values({
        expires_at: command.expiresAt,
        id: command.id ?? generateUuidV7(),
        ip_address: command.metadata.ipAddress ?? null,
        session_id: command.sessionId,
        token_hash: command.refreshTokenHash,
        user_agent: command.metadata.userAgent ?? null,
        user_id: command.userId,
      })
      .execute()
  }

  private async upsertCredential(
    executor: DatabaseExecutor,
    command: {
      email: string
      passwordHash: string
      userId: string
    },
  ): Promise<void> {
    await executor
      .insertInto('app.auth_credentials')
      .values({
        email: normalizeEmail(command.email),
        password_hash: command.passwordHash,
        user_id: command.userId,
      })
      .onConflict((conflict) =>
        conflict.column('user_id').doUpdateSet({
          deleted_at: null,
          email: normalizeEmail(command.email),
          password_hash: command.passwordHash,
          password_updated_at: new Date(),
        }),
      )
      .execute()
  }

  private async revokeUserRefreshTokens(
    executor: DatabaseExecutor,
    userId: string,
  ): Promise<void> {
    await executor
      .updateTable('app.auth_refresh_tokens')
      .set({
        revoked_at: new Date(),
      })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .execute()
  }

  private async findActiveRefreshTokenForSession(
    executor: DatabaseExecutor,
    input: {
      sessionId: string
      userId: string
    },
  ): Promise<{ tokenId: string } | null> {
    const token = await executor
      .selectFrom('app.auth_refresh_tokens')
      .select('id as tokenId')
      .where('session_id', '=', input.sessionId)
      .where('user_id', '=', input.userId)
      .where('revoked_at', 'is', null)
      .where('rotated_at', 'is', null)
      .where('expires_at', '>', new Date().toISOString())
      .orderBy('created_at', 'desc')
      .forUpdate()
      .executeTakeFirst()

    return token ?? null
  }

  private async revokeRefreshTokenSession(
    executor: DatabaseExecutor,
    sessionId: string,
    revokedAt: Date,
  ): Promise<void> {
    await executor
      .updateTable('app.auth_refresh_tokens')
      .set({
        revoked_at: revokedAt,
      })
      .where('session_id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .execute()
  }
}

function mapAuthUserRow(row: AuthUserRow): AuthUserRecord {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
  }
}

function isWithinRefreshTokenReuseGrace(rotatedAt: Date, now: Date): boolean {
  return now.getTime() - rotatedAt.getTime() <= REFRESH_TOKEN_REUSE_GRACE_MS
}

async function useFastAuthTokenCommit(
  executor: DatabaseExecutor,
): Promise<void> {
  await sql`set local synchronous_commit = off`.execute(executor)
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

function isUniqueConstraintError(error: unknown): boolean {
  return getErrorCode(error) === '23505'
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }

  const code = error.code

  return typeof code === 'string' ? code : undefined
}
