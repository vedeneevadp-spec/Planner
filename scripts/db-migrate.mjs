import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { Client } from 'pg'

import { createPgConnectionConfig } from './pg-connection-config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const migrationsDirectory = path.join(repoRoot, 'supabase', 'migrations')
const connectionString =
  process.env.DATABASE_URL ??
  'postgres://planner:planner@127.0.0.1:54329/planner_development'
const retries = 30
const retryDelayMs = 1000
const statementRetries = 5
const useStatelessMode =
  process.env.DB_MIGRATE_MODE === 'stateless' ||
  connectionString.includes('pooler.supabase.com')

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

    for (const fileName of migrationFiles) {
      const alreadyApplied = await hasMigration(client, fileName)

      if (alreadyApplied) {
        console.log(`Skipping already applied migration: ${fileName}`)
        continue
      }

      const filePath = path.join(migrationsDirectory, fileName)
      const sql = await readFile(filePath, 'utf8')
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
        await recordMigration(client, fileName)
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw error
      }
    }
  } finally {
    await client.end()
  }
}

async function runStatelessMigrations(migrationFiles) {
  await withConnectedClient(async (client) => {
    await ensureSchemaMigrationsTable(client)
  }, { logSuccess: true })

  for (const fileName of migrationFiles) {
    const alreadyApplied = await withConnectedClient((client) =>
      hasMigration(client, fileName),
    )

    if (alreadyApplied) {
      console.log(`Skipping already applied migration: ${fileName}`)
      continue
    }

    const filePath = path.join(migrationsDirectory, fileName)
    const sql = await readFile(filePath, 'utf8')
    const statements = splitSqlStatements(sql)

    console.log(`Applying migration: ${fileName}`)

    for (const [index, statement] of statements.entries()) {
      console.log(
        `Running statement ${index + 1}/${statements.length}: ${summarizeStatement(statement)}`,
      )
      await runStatementWithRetry(statement)
    }

    await withConnectedClient((client) => recordMigration(client, fileName))
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
      await client.end().catch(() => {})
    }
  }

  throw lastError
}

async function withConnectedClient(callback, options = {}) {
  const client = await connectWithRetry(options)

  try {
    return await callback(client)
  } finally {
    await client.end().catch(() => {})
  }
}

async function connectWithRetry(options = {}) {
  let lastError = null

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const client = createClient()

    try {
      await client.connect()
      if (options.logSuccess) {
        console.log('Connected to database.')
      }
      return client
    } catch (error) {
      lastError = error
      await client.end().catch(() => {})
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
    console.error(
      `Database client error (${error.code ?? 'unknown'}): ${error.message}`,
    )
  })

  return client
}

async function ensureSchemaMigrationsTable(client) {
  await client.query('create schema if not exists app')
  await client.query(
    // noinspection SqlNoDataSourceInspection
    `
    create table if not exists app.schema_migrations (
      id bigserial primary key,
      name text not null unique,
      applied_at timestamptz not null default now()
    )
  `,
  )
}

async function hasMigration(client, fileName) {
  const result = await client.query(
    // noinspection SqlNoDataSourceInspection
    `
      select 1
      from app.schema_migrations
      where name = $1
      limit 1
    `,
    [fileName],
  )

  return result.rowCount > 0
}

async function recordMigration(client, fileName) {
  await client.query(
    // noinspection SqlNoDataSourceInspection
    `
      insert into app.schema_migrations (name)
      values ($1)
      on conflict (name) do nothing
    `,
    [fileName],
  )
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
  return (
    typeof error?.code === 'string' &&
    ['ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(error.code)
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
