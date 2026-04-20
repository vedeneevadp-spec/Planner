import { createApiConfig } from '../bootstrap/config.js'
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../infrastructure/db/client.js'
import { createDatabaseConfig } from '../infrastructure/db/config.js'
import {
  OutboxService,
  PostgresOutboxRepository,
} from '../modules/outbox/index.js'

const config = createApiConfig(process.env)

if (config.storageDriver !== 'postgres') {
  throw new Error('Outbox worker requires Postgres storage.')
}

const database = createDatabaseConnection(createDatabaseConfig(process.env))

try {
  const service = new OutboxService(new PostgresOutboxRepository(database.db))
  const result = await service.processPending(readBatchSize())

  console.log(JSON.stringify(result))
} finally {
  await destroyDatabaseConnection(database)
}

function readBatchSize(): number {
  const rawValue = process.env.OUTBOX_BATCH_SIZE

  if (!rawValue) {
    return 100
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Invalid OUTBOX_BATCH_SIZE: ${rawValue}`)
  }

  return value
}
