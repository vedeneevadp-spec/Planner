import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'

import {
  closePgClient,
  createPgConnectionConfig,
  preparePgAdminConnection,
} from './pg-connection-config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const migrationsDirectory = path.join(repoRoot, 'db', 'migrations')
const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const retries = 30
const retryDelayMs = 1000
const statementRetries = 5
const useStatelessMode = process.env.DB_MIGRATE_MODE === 'stateless'
const migrationLockKey = 7_334_202_605

async function main() {
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right))

  if (migrationFiles.length === 0) {
    console.log('No migrations found.')
    return
  }

  console.log(
    `Using ${useStatelessMode ? 'stateless' : 'transactional'} migration mode.`,
  )

  if (useStatelessMode) {
    await runStatelessMigrations(migrationFiles)
    return
  }

  await runTransactionalMigrations(migrationFiles)
}

async function runTransactionalMigrations(migrationFiles) {
  const client = await connectWithRetry({ logSuccess: true })

  try {
    await ensureSchemaMigrationsTable(client)
    await acquireMigrationLock(client)

    for (const fileName of migrationFiles) {
      const filePath = path.join(migrationsDirectory, fileName)
      const sql = await readFile(filePath, 'utf8')
      const checksum = createMigrationChecksum(sql)
      const alreadyApplied = await getMigrationRecord(client, fileName)

      if (alreadyApplied) {
        await assertMigrationChecksum(
          client,
          fileName,
          checksum,
          alreadyApplied,
        )
        console.log(`Skipping already applied migration: ${fileName}`)
        continue
      }

      const statements = splitSqlStatements(sql)

      console.log(`Applying migration: ${fileName}`)
      await client.query('begin')
      try {
        for (const [index, statement] of statements.entries()) {
          console.log(
            `Running statement ${index + 1}/${statements.length}: ${summarizeStatement(statement)}`,
          )
          await client.query(statement)
        }
        await recordMigration(client, {
          checksum,
          fileName,
          statementCount: statements.length,
        })
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    }
  } finally {
    await releaseMigrationLock(client).catch(() => undefined)
    await closePgClient(client)
  }
}

async function runStatelessMigrations(migrationFiles) {
  await withConnectedClient(
    async (client) => {
      await ensureSchemaMigrationsTable(client)
    },
    { logSuccess: true },
  )

  for (const fileName of migrationFiles) {
    const filePath = path.join(migrationsDirectory, fileName)
    const sql = await readFile(filePath, 'utf8')
    const checksum = createMigrationChecksum(sql)
    const alreadyApplied = await withConnectedClient((client) =>
      getMigrationRecord(client, fileName),
    )

    if (alreadyApplied) {
      await withConnectedClient((client) =>
        assertMigrationChecksum(client, fileName, checksum, alreadyApplied),
      )
      console.log(`Skipping already applied migration: ${fileName}`)
      continue
    }

    const statements = splitSqlStatements(sql)

    console.log(`Applying migration: ${fileName}`)

    for (const [index, statement] of statements.entries()) {
      console.log(
        `Running statement ${index + 1}/${statements.length}: ${summarizeStatement(statement)}`,
      )
      await runStatementWithRetry(statement)
    }

    await withConnectedClient((client) =>
      recordMigration(client, {
        checksum,
        fileName,
        statementCount: statements.length,
      }),
    )
  }
}

async function runStatementWithRetry(statement) {
  let lastError = null

  for (let attempt = 1; attempt <= statementRetries; attempt += 1) {
    const client = await connectWithRetry()

    try {
      await client.query(statement)
      return
    } catch (error) {
      lastError = error

      if (isAlreadyExistsError(error)) {
        console.log(
          `Skipping existing object (${error.code ?? 'unknown'}): ${summarizeStatement(statement)}`,
        )
        return
      }

      if (!isTransientConnectionError(error) || attempt === statementRetries) {
        throw error
      }

      console.log(
        `Transient database error for statement. Retry ${attempt}/${statementRetries} in ${retryDelayMs}ms.`,
      )
      await wait(retryDelayMs)
    } finally {
      await closePgClient(client)
    }
  }

  throw lastError
}

async function withConnectedClient(callback, options = {}) {
  let lastError = null

  for (let attempt = 1; attempt <= statementRetries; attempt += 1) {
    const client = await connectWithRetry(options)

    try {
      return await callback(client)
    } catch (error) {
      lastError = error

      if (!isTransientConnectionError(error) || attempt === statementRetries) {
        throw error
      }

      console.log(
        `Transient database error for migration metadata. Retry ${attempt}/${statementRetries} in ${retryDelayMs}ms.`,
      )
      await wait(retryDelayMs)
    } finally {
      await closePgClient(client)
    }
  }

  throw lastError
}

async function connectWithRetry(options = {}) {
  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const client = createClient()

    try {
      await client.connect()
      await preparePgAdminConnection(client)
      if (options.logSuccess) {
        console.log('Connected to database.')
      }
      return client
    } catch (error) {
      lastError = error
      await closePgClient(client)
      console.log(
        `Database is not ready yet. Retry ${attempt}/${retries} in ${retryDelayMs}ms.`,
      )
      await wait(retryDelayMs)
    }
  }

  throw lastError
}

function createClient() {
  const client = new Client(createPgConnectionConfig(connectionString))

  client.on('error', (error) => {
    if (isTransientConnectionError(error)) {
      return
    }

    console.error(
      `Database client error (${error.code ?? 'unknown'}): ${error.message}`,
    )
  })

  return client
}

async function ensureSchemaMigrationsTable(client) {
  const schemaResult = await client.query(
    "select to_regnamespace('app') is not null as exists",
  )

  if (!schemaResult.rows[0]?.exists) {
    await client.query('create schema app')
  }

  const tableResult = await client.query(
    "select to_regclass('app.schema_migrations') is not null as exists",
  )

  if (tableResult.rows[0]?.exists) {
    await ensureSchemaMigrationMetadataColumns(client)
    return
  }

  await client.query(
    // noinspection SqlNoDataSourceInspection
    `
    create table if not exists app.schema_migrations (
      id bigserial primary key,
      name text not null unique,
      checksum text,
      statement_count integer,
      applied_at timestamptz not null default now()
    )
  `,
  )

  await ensureSchemaMigrationMetadataColumns(client)
}

async function ensureSchemaMigrationMetadataColumns(client) {
  await client.query(
    // noinspection SqlNoDataSourceInspection
    `
      alter table app.schema_migrations
        add column if not exists checksum text,
        add column if not exists statement_count integer
    `,
  )
}

async function getMigrationRecord(client, fileName) {
  const result = await client.query(
    // noinspection SqlNoDataSourceInspection
    `
      select checksum, statement_count
      from app.schema_migrations
      where name = $1
      limit 1
    `,
    [fileName],
  )

  return result.rows[0] ?? null
}

async function recordMigration(client, { checksum, fileName, statementCount }) {
  await client.query(
    // noinspection SqlNoDataSourceInspection
    `
      insert into app.schema_migrations (name, checksum, statement_count)
      values ($1, $2, $3)
      on conflict (name) do update
        set checksum = excluded.checksum,
            statement_count = excluded.statement_count
    `,
    [fileName, checksum, statementCount],
  )
}

async function assertMigrationChecksum(client, fileName, checksum, record) {
  if (!record.checksum) {
    await client.query(
      // noinspection SqlNoDataSourceInspection
      `
        update app.schema_migrations
        set checksum = $2
        where name = $1
          and checksum is null
      `,
      [fileName, checksum],
    )
    return
  }

  if (record.checksum !== checksum) {
    throw new Error(
      [
        `Migration checksum mismatch for ${fileName}.`,
        `Database has ${record.checksum}, file has ${checksum}.`,
        'Create a new migration instead of editing an applied one.',
      ].join(' '),
    )
  }
}

async function acquireMigrationLock(client) {
  await client.query('select pg_advisory_lock($1)', [migrationLockKey])
}

async function releaseMigrationLock(client) {
  await client.query('select pg_advisory_unlock($1)', [migrationLockKey])
}

function createMigrationChecksum(sql) {
  return createHash('sha256').update(sql).digest('hex')
}

function wait(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })
}

function summarizeStatement(statement) {
  return statement.replace(/\s+/g, ' ').trim().slice(0, 120)
}

function splitSqlStatements(sql) {
  const statements = []
  let current = ''
  let index = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inLineComment = false
  let inBlockComment = false
  let dollarQuoteTag = null

  while (index < sql.length) {
    const char = sql[index]
    const nextChar = sql[index + 1]

    if (inLineComment) {
      current += char

      if (char === '\n') {
        inLineComment = false
      }

      index += 1
      continue
    }

    if (inBlockComment) {
      current += char

      if (char === '*' && nextChar === '/') {
        current += nextChar
        index += 2
        inBlockComment = false
        continue
      }

      index += 1
      continue
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        current += dollarQuoteTag
        index += dollarQuoteTag.length
        dollarQuoteTag = null
        continue
      }

      current += char
      index += 1
      continue
    }

    if (inSingleQuote) {
      current += char

      if (char === "'" && nextChar === "'") {
        current += nextChar
        index += 2
        continue
      }

      if (char === "'") {
        inSingleQuote = false
      }

      index += 1
      continue
    }

    if (inDoubleQuote) {
      current += char

      if (char === '"' && nextChar === '"') {
        current += nextChar
        index += 2
        continue
      }

      if (char === '"') {
        inDoubleQuote = false
      }

      index += 1
      continue
    }

    if (char === '-' && nextChar === '-') {
      current += char + nextChar
      index += 2
      inLineComment = true
      continue
    }

    if (char === '/' && nextChar === '*') {
      current += char + nextChar
      index += 2
      inBlockComment = true
      continue
    }

    if (char === "'") {
      current += char
      index += 1
      inSingleQuote = true
      continue
    }

    if (char === '"') {
      current += char
      index += 1
      inDoubleQuote = true
      continue
    }

    if (char === '$') {
      const dollarTag = readDollarQuoteTag(sql, index)

      if (dollarTag) {
        current += dollarTag
        index += dollarTag.length
        dollarQuoteTag = dollarTag
        continue
      }
    }

    if (char === ';') {
      const statement = current.trim()

      if (statement.length > 0) {
        statements.push(statement)
      }

      current = ''
      index += 1
      continue
    }

    current += char
    index += 1
  }

  const tailStatement = current.trim()

  if (tailStatement.length > 0) {
    statements.push(tailStatement)
  }

  return statements
}

function readDollarQuoteTag(sql, startIndex) {
  if (sql[startIndex] !== '$') {
    return null
  }

  let cursor = startIndex + 1

  while (cursor < sql.length) {
    const char = sql[cursor]

    if (char === '$') {
      return sql.slice(startIndex, cursor + 1)
    }

    if (!/[A-Za-z0-9_]/.test(char)) {
      return null
    }

    cursor += 1
  }

  return null
}

function isAlreadyExistsError(error) {
  return (
    typeof error?.code === 'string' &&
    ['42P06', '42P07', '42710', '42723'].includes(error.code)
  )
}

function isTransientConnectionError(error) {
  if (typeof error?.code === 'string') {
    return ['ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(error.code)
  }

  return (
    error instanceof Error &&
    (error.message.includes('Client has encountered a connection error') ||
      error.message.includes('Connection terminated') ||
      error.message.includes('Query read timeout') ||
      error.message.includes('timeout'))
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
