import { createUserBackupRestoreHelperRuntimeConfig } from '../bootstrap/user-backup-restore-helper-config.js'
import {
  createDatabaseConnection,
  destroyDatabaseConnection,
} from '../infrastructure/db/client.js'
import { restorePostgresPersonalWorkspace } from '../modules/backups/backup.repository.postgres.restore.js'
import { buildUserBackupRestoreHelperApp } from '../modules/backups/backup.restore-helper-app.js'

const config = createUserBackupRestoreHelperRuntimeConfig()
const database = createDatabaseConnection({
  connectionString: config.connectionString,
})
const app = buildUserBackupRestoreHelperApp({
  database,
  executor: {
    restorePersonalWorkspace: (input) =>
      restorePostgresPersonalWorkspace(
        database.db,
        config.assetDirectory,
        input,
      ),
  },
  secret: config.secret,
})

try {
  await app.listen({ host: config.host, port: config.port })
} catch (error) {
  app.log.error(error)
  await shutdown()
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.log.info({ signal }, 'Shutting down backup restore helper.')
    void shutdown().then(() => process.exit(0))
  })
}

async function shutdown(): Promise<void> {
  await app.close()
  await destroyDatabaseConnection(database)
}
