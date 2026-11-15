import { type Kysely, type Transaction } from 'kysely'

import {
  type DatabaseExecutor,
  withOptionalRls as withRootOptionalRls,
  withWriteTransaction as withRootWriteTransaction,
} from '../../infrastructure/db/rls.js'
import type { DatabaseSchema } from '../../infrastructure/db/schema.js'
import type {
  SelfCareReadContext,
  SelfCareWriteContext,
} from './self-care.model.js'

export function withWriteTransaction<T>(
  db: Kysely<DatabaseSchema>,
  auth: SelfCareWriteContext['auth'],
  callback: (trx: Transaction<DatabaseSchema>) => Promise<T>,
  actorUserId?: string,
): Promise<T> {
  if (db.isTransaction) {
    return callback(db as Transaction<DatabaseSchema>)
  }

  return withRootWriteTransaction(db, auth, callback, actorUserId)
}
export function withOptionalRls<T>(
  db: Kysely<DatabaseSchema>,
  auth: SelfCareReadContext['auth'],
  callback: (executor: DatabaseExecutor) => Promise<T>,
  actorUserId?: string,
): Promise<T> {
  if (db.isTransaction) {
    return callback(db)
  }

  return withRootOptionalRls(db, auth, callback, actorUserId)
}
