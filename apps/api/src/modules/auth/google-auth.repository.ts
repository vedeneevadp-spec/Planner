import { generateUuidV7 } from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type { AuthUserRecord } from './auth.model.js'

export interface CompleteGoogleSignInCommand {
  displayName: string
  email: string
  expiresAt: Date
  linkUserId: string | null
  nonceHash: string
  subject: string
}

export interface GoogleAuthRepository {
  completeSignIn(command: CompleteGoogleSignInCommand): Promise<AuthUserRecord>
  findUserBySubject(subject: string): Promise<AuthUserRecord | null>
}

interface GoogleAuthUserRow {
  display_name: string
  email: string
  id: string
}

export class PostgresGoogleAuthRepository implements GoogleAuthRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findUserBySubject(subject: string): Promise<AuthUserRecord | null> {
    const result = await sql<GoogleAuthUserRow>`
      select * from app.auth_find_google_user(${subject})
    `.execute(this.db)
    return result.rows[0] ? mapUser(result.rows[0]) : null
  }

  async completeSignIn(
    command: CompleteGoogleSignInCommand,
  ): Promise<AuthUserRecord> {
    try {
      const result = await sql<GoogleAuthUserRow>`
        select * from app.auth_complete_google_sign_in(
          ${command.subject}, ${command.email}::public.citext,
          ${command.displayName}, ${generateUuidV7()}::uuid,
          ${command.linkUserId}::uuid, ${command.nonceHash},
          ${command.expiresAt}::timestamptz
        )
      `.execute(this.db)
      if (!result.rows[0]) throw new Error('Google sign-in returned no user.')
      return mapUser(result.rows[0])
    } catch (error) {
      if (error instanceof Error && 'code' in error) {
        if (
          error.code === 'P0001' &&
          error.message === 'google_challenge_invalid'
        ) {
          throw new HttpError(
            401,
            'auth_google_challenge_invalid',
            'Google sign-in has expired or was already used.',
          )
        }
        if (
          error.code === 'P0001' &&
          error.message === 'google_link_required'
        ) {
          throw new HttpError(
            409,
            'auth_google_link_required',
            'Confirm the existing account password to link Google.',
          )
        }
        if (
          error.code === '23505' ||
          (error.code === 'P0001' &&
            error.message === 'google_account_unavailable')
        ) {
          throw new HttpError(
            409,
            'auth_google_account_conflict',
            'This Google account cannot be linked to this account.',
          )
        }
      }
      throw error
    }
  }
}

function mapUser(row: GoogleAuthUserRow): AuthUserRecord {
  return { displayName: row.display_name, email: row.email, id: row.id }
}
