import type { EmailVerificationStatus } from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type { EmailVerificationRepository } from './email-verification.service.js'

export class PostgresEmailVerificationRepository implements EmailVerificationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async getStatus(userId: string): Promise<EmailVerificationStatus | null> {
    const result =
      await sql<EmailVerificationStatus>`select * from app.auth_email_verification_status(${userId}::uuid)`.execute(
        this.db,
      )
    return result.rows[0] ?? null
  }

  async request(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    await sql`select app.auth_request_email_verification(${userId}::uuid, ${tokenHash}, ${expiresAt}::timestamptz)`.execute(
      this.db,
    )
  }

  async confirm(userId: string, tokenHash: string): Promise<boolean> {
    const result = await sql<{
      verified: boolean
    }>`select app.auth_confirm_email_verification(${userId}::uuid, ${tokenHash}) as verified`.execute(
      this.db,
    )
    return result.rows[0]?.verified === true
  }
}
