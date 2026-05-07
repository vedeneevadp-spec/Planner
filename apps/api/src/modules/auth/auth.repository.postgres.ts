import { generateUuidV7 } from '@planner/contracts'
import type { Selectable } from 'kysely'
import type { Kysely } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { DatabaseExecutor } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  AuthCredentialRecord,
  AuthSessionTokenRecord,
  AuthUserRecord,
  CompletePasswordResetCommand,
  CreateAuthUserCommand,
  CreatePasswordResetTokenCommand,
  CreateRefreshTokenCommand,
  CreateRefreshTokenPayload,
  UpdatePasswordCommand,
} from './auth.model.js'
import type { AuthRepository } from './auth.repository.js'

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
    await this.insertRefreshToken(this.db, command)
  }

  async rotateRefreshToken(
    currentRefreshTokenHash: string,
    nextRefreshToken: CreateRefreshTokenPayload,
  ): Promise<AuthSessionTokenRecord | null> {
    return this.db.transaction().execute(async (trx) => {
      const currentToken = await trx
        .selectFrom('app.auth_refresh_tokens as token')
        .innerJoin('app.users as user', 'user.id', 'token.user_id')
        .select([
          'token.expires_at as expiresAt',
          'token.id as tokenId',
          'token.revoked_at as revokedAt',
          'token.session_id as sessionId',
          'user.deleted_at as userDeletedAt',
          'user.display_name as displayName',
          'user.email',
          'user.id',
        ])
        .where('token.token_hash', '=', currentRefreshTokenHash)
        .executeTakeFirst()

      if (
        !currentToken ||
        currentToken.revokedAt ||
        currentToken.userDeletedAt ||
        new Date(currentToken.expiresAt).getTime() <= Date.now()
      ) {
        return null
      }

      const updateResult = await trx
        .updateTable('app.auth_refresh_tokens')
        .set({
          last_used_at: new Date(),
          revoked_at: new Date(),
        })
        .where('id', '=', currentToken.tokenId)
        .where('revoked_at', 'is', null)
        .executeTakeFirst()

      if (Number(updateResult.numUpdatedRows) !== 1) {
        return null
      }

      await this.insertRefreshToken(trx, {
        ...nextRefreshToken,
        userId: currentToken.id,
      })

      return {
        displayName: currentToken.displayName,
        email: currentToken.email,
        id: currentToken.id,
        sessionId: nextRefreshToken.sessionId,
      }
    })
  }

  async revokeRefreshToken(refreshTokenHash: string): Promise<void> {
    await this.db
      .updateTable('app.auth_refresh_tokens')
      .set({
        revoked_at: new Date(),
      })
      .where('token_hash', '=', refreshTokenHash)
      .where('revoked_at', 'is', null)
      .execute()
  }

  async createPasswordResetToken(
    command: CreatePasswordResetTokenCommand,
  ): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
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
    command: CreateRefreshTokenCommand,
  ): Promise<void> {
    await executor
      .insertInto('app.auth_refresh_tokens')
      .values({
        expires_at: command.expiresAt,
        id: generateUuidV7(),
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
}

function mapAuthUserRow(row: AuthUserRow): AuthUserRecord {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
  }
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
