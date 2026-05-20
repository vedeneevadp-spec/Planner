import { generateUuidV7 } from '@planner/contracts'
import type { Kysely } from 'kysely'
import { sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
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

interface AuthUserRow {
  display_name: string
  email: string
  id: string
}

interface AuthCredentialRow extends AuthUserRow {
  password_hash: string
}

interface AuthSessionTokenRow extends AuthUserRow {
  session_id: string
}

export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findCredentialByEmail(
    email: string,
  ): Promise<AuthCredentialRecord | null> {
    const row = await sql<AuthCredentialRow>`
      select *
      from app.auth_find_credential_by_email(${normalizeEmail(email)}::public.citext)
    `.execute(this.db)

    const credential = row.rows[0]

    return credential
      ? {
          displayName: credential.display_name,
          email: credential.email,
          id: credential.id,
          passwordHash: credential.password_hash,
        }
      : null
  }

  async findCredentialByUserId(
    userId: string,
  ): Promise<AuthCredentialRecord | null> {
    const row = await sql<AuthCredentialRow>`
      select *
      from app.auth_find_credential_by_user_id(${userId}::uuid)
    `.execute(this.db)

    const credential = row.rows[0]

    return credential
      ? {
          displayName: credential.display_name,
          email: credential.email,
          id: credential.id,
          passwordHash: credential.password_hash,
        }
      : null
  }

  async findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const row = await sql<AuthUserRow>`
      select *
      from app.auth_find_user_by_email(${normalizeEmail(email)}::public.citext)
    `.execute(this.db)

    return row.rows[0] ? mapAuthUserRow(row.rows[0]) : null
  }

  async createUserWithCredential(
    command: CreateAuthUserCommand,
  ): Promise<AuthUserRecord> {
    try {
      const row = await sql<AuthUserRow>`
        select *
        from app.auth_create_user_with_credential(
          ${command.userId}::uuid,
          ${normalizeEmail(command.email)}::public.citext,
          ${command.displayName},
          ${command.passwordHash}
        )
      `.execute(this.db)

      return mapAuthUserRow(row.rows[0]!)
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
    await sql`
      select app.auth_insert_refresh_token(
        ${generateUuidV7()}::uuid,
        ${command.userId}::uuid,
        ${command.refreshTokenHash},
        ${command.sessionId}::uuid,
        ${command.expiresAt}::timestamptz,
        ${command.metadata.userAgent ?? null},
        ${command.metadata.ipAddress ?? null}
      )
    `.execute(this.db)
  }

  async createOAuthAuthorizationCode(
    command: CreateOAuthAuthorizationCodeCommand,
  ): Promise<void> {
    await sql`
      select app.auth_create_oauth_authorization_code(
        ${generateUuidV7()}::uuid,
        ${command.userId}::uuid,
        ${command.codeHash},
        ${command.clientId},
        ${command.redirectUri},
        ${command.scope},
        ${command.expiresAt}::timestamptz,
        ${command.metadata.userAgent ?? null},
        ${command.metadata.ipAddress ?? null}
      )
    `.execute(this.db)
  }

  async exchangeOAuthAuthorizationCode(
    command: ExchangeOAuthAuthorizationCodeCommand,
  ): Promise<AuthSessionTokenRecord | null> {
    const row = await sql<AuthSessionTokenRow>`
      select *
      from app.auth_exchange_oauth_authorization_code(
        ${command.codeHash},
        ${command.clientId},
        ${command.redirectUri},
        ${generateUuidV7()}::uuid,
        ${command.refreshToken.refreshTokenHash},
        ${command.refreshToken.sessionId}::uuid,
        ${command.refreshToken.expiresAt}::timestamptz,
        ${command.refreshToken.metadata.userAgent ?? null},
        ${command.refreshToken.metadata.ipAddress ?? null}
      )
    `.execute(this.db)

    return row.rows[0] ? mapAuthSessionTokenRow(row.rows[0]) : null
  }

  async rotateRefreshToken(
    currentRefreshTokenHash: string,
    nextRefreshToken: RotateRefreshTokenPayload,
  ): Promise<AuthSessionTokenRecord | null> {
    const row = await sql<AuthSessionTokenRow>`
      select *
      from app.auth_rotate_refresh_token(
        ${currentRefreshTokenHash},
        ${generateUuidV7()}::uuid,
        ${nextRefreshToken.refreshTokenHash},
        ${nextRefreshToken.expiresAt}::timestamptz,
        ${nextRefreshToken.metadata.userAgent ?? null},
        ${nextRefreshToken.metadata.ipAddress ?? null}
      )
    `.execute(this.db)

    return row.rows[0] ? mapAuthSessionTokenRow(row.rows[0]) : null
  }

  async revokeRefreshToken(refreshTokenHash: string): Promise<void> {
    await sql`
      select app.auth_revoke_refresh_token(${refreshTokenHash})
    `.execute(this.db)
  }

  async createPasswordResetToken(
    command: CreatePasswordResetTokenCommand,
  ): Promise<void> {
    await sql`
      select app.auth_create_password_reset_token(
        ${command.userId}::uuid,
        ${command.resetTokenHash},
        ${command.expiresAt}::timestamptz,
        ${command.metadata.userAgent ?? null},
        ${command.metadata.ipAddress ?? null}
      )
    `.execute(this.db)
  }

  async completePasswordReset(
    command: CompletePasswordResetCommand,
  ): Promise<AuthSessionTokenRecord | null> {
    const row = await sql<AuthSessionTokenRow>`
      select *
      from app.auth_complete_password_reset(
        ${command.resetTokenHash},
        ${command.passwordHash},
        ${generateUuidV7()}::uuid,
        ${command.refreshToken.refreshTokenHash},
        ${command.refreshToken.sessionId}::uuid,
        ${command.refreshToken.expiresAt}::timestamptz,
        ${command.refreshToken.metadata.userAgent ?? null},
        ${command.refreshToken.metadata.ipAddress ?? null}
      )
    `.execute(this.db)

    return row.rows[0] ? mapAuthSessionTokenRow(row.rows[0]) : null
  }

  async updatePassword(command: UpdatePasswordCommand): Promise<void> {
    const row = await sql<{ updated: boolean }>`
      select app.auth_update_password(
        ${command.userId}::uuid,
        ${command.passwordHash}
      ) as updated
    `.execute(this.db)

    if (!row.rows[0]?.updated) {
      throw new HttpError(404, 'auth_user_not_found', 'User was not found.')
    }
  }
}

function mapAuthUserRow(row: AuthUserRow): AuthUserRecord {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
  }
}

function mapAuthSessionTokenRow(
  row: AuthSessionTokenRow,
): AuthSessionTokenRecord {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    sessionId: row.session_id,
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
