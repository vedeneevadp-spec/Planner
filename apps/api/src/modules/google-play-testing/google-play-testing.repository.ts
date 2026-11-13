import type {
  GooglePlayTestingRequest,
  GooglePlayTestingReview,
} from '@planner/contracts'
import { type Kysely, sql } from 'kysely'

import { HttpError } from '../../bootstrap/http-error.js'
import type { AuthenticatedRequestContext } from '../../bootstrap/request-auth.js'
import { withOptionalRls } from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'

export interface TestingActor {
  auth: AuthenticatedRequestContext
  userId: string
}
export interface GooglePlayTestingRepository {
  isOpen(actor: TestingActor): Promise<boolean>
  setOpen(actor: TestingActor, isOpen: boolean): Promise<void>
  list(actor: TestingActor): Promise<GooglePlayTestingRequest[]>
  submit(actor: TestingActor, email: string): Promise<GooglePlayTestingRequest>
  review(
    actor: TestingActor,
    userId: string,
    input: GooglePlayTestingReview,
  ): Promise<GooglePlayTestingRequest>
}

const closedError = () =>
  new HttpError(409, 'testing_closed', 'Набор участников сейчас закрыт.')
const changedError = () =>
  new HttpError(
    409,
    'testing_request_changed',
    'Заявка изменилась. Обновите список и проверьте адрес ещё раз.',
  )

export class MemoryGooglePlayTestingRepository implements GooglePlayTestingRepository {
  private open = false
  private requests = new Map<string, GooglePlayTestingRequest>()
  isOpen() {
    return Promise.resolve(this.open)
  }
  setOpen(_actor: TestingActor, isOpen: boolean) {
    this.open = isOpen
    return Promise.resolve()
  }
  list() {
    return Promise.resolve(
      [...this.requests.values()].map((request) => ({ ...request })),
    )
  }
  submit(actor: TestingActor, email: string) {
    if (!this.open) return Promise.reject(closedError())
    const previous = this.requests.get(actor.userId)
    if (previous?.googleEmail === email) return Promise.resolve({ ...previous })
    const now = new Date().toISOString()
    const request: GooglePlayTestingRequest = {
      userId: actor.userId,
      googleEmail: email,
      status: 'pending',
      revision: (previous?.revision ?? 0) + 1,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    }
    this.requests.set(actor.userId, request)
    return Promise.resolve({ ...request })
  }
  review(_actor: TestingActor, userId: string, input: GooglePlayTestingReview) {
    const previous = this.requests.get(userId)
    if (!previous || previous.revision !== input.revision)
      return Promise.reject(changedError())
    const request = {
      ...previous,
      status: input.status,
      revision: previous.revision + 1,
      updatedAt: new Date().toISOString(),
    }
    this.requests.set(userId, request)
    return Promise.resolve({ ...request })
  }
}

interface RequestRow {
  user_id: string
  google_email: string
  status: GooglePlayTestingRequest['status']
  revision: number
  created_at: Date | string
  updated_at: Date | string
}
function mapRequest(row: RequestRow): GooglePlayTestingRequest {
  return {
    userId: row.user_id,
    googleEmail: row.google_email,
    status: row.status,
    revision: row.revision,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}
export class PostgresGooglePlayTestingRepository implements GooglePlayTestingRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}
  async isOpen(actor: TestingActor) {
    const result = await withOptionalRls(this.db, actor.auth, (trx) =>
      sql<{
        is_open: boolean
      }>`select is_open from app.google_play_testing_campaign where id`.execute(
        trx,
      ),
    )
    return result.rows[0]?.is_open ?? false
  }
  async setOpen(actor: TestingActor, isOpen: boolean) {
    await withOptionalRls(this.db, actor.auth, (trx) =>
      sql`select app.google_play_testing_set_open(${isOpen})`.execute(trx),
    )
  }
  async list(actor: TestingActor) {
    const result = await withOptionalRls(this.db, actor.auth, (trx) =>
      sql<RequestRow>`select * from app.google_play_testing_list()`.execute(
        trx,
      ),
    )
    return result.rows.map(mapRequest)
  }
  async submit(actor: TestingActor, email: string) {
    const result = await withOptionalRls(this.db, actor.auth, (trx) =>
      sql<RequestRow>`select * from app.google_play_testing_submit(${email})`.execute(
        trx,
      ),
    )
    if (!result.rows[0]) throw closedError()
    return mapRequest(result.rows[0])
  }
  async review(
    actor: TestingActor,
    userId: string,
    input: GooglePlayTestingReview,
  ) {
    const result = await withOptionalRls(this.db, actor.auth, (trx) =>
      sql<RequestRow>`select * from app.google_play_testing_review(${userId}::uuid, ${input.revision}, ${input.status})`.execute(
        trx,
      ),
    )
    if (!result.rows[0]) throw changedError()
    return mapRequest(result.rows[0])
  }
}
