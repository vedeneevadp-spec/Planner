import assert from 'node:assert/strict'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const migrationsDirectory = path.join(repoRoot, 'db', 'migrations')

const MIGRATION_FILE_PATTERN =
  /^(?<date>\d{8})_(?<sequence>\d{6})_(?<slug>[a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/

const HISTORICAL_SEQUENCE_EXCEPTIONS = new Set([
  '20260527_000028_task_reminder_offsets.sql',
])

const migrationFiles = (await readdir(migrationsDirectory))
  .filter((fileName) => fileName.endsWith('.sql'))
  .sort((left, right) => left.localeCompare(right))

const seenSequences = new Map()
let previousSequence = 0
const violations = []

for (const fileName of migrationFiles) {
  const match = MIGRATION_FILE_PATTERN.exec(fileName)

  if (!match?.groups) {
    violations.push(
      `${fileName}: expected YYYYMMDD_000001_descriptive_slug.sql`,
    )
    continue
  }

  const sequence = Number(match.groups.sequence)
  const duplicateOwner = seenSequences.get(sequence)
  const isHistoricalException = HISTORICAL_SEQUENCE_EXCEPTIONS.has(fileName)

  if (!Number.isSafeInteger(sequence) || sequence <= 0) {
    violations.push(`${fileName}: migration sequence must be a positive number`)
  }

  if (duplicateOwner && !isHistoricalException) {
    violations.push(
      `${fileName}: duplicate migration sequence ${match.groups.sequence}; first seen in ${duplicateOwner}`,
    )
  }

  if (sequence <= previousSequence && !isHistoricalException) {
    violations.push(
      `${fileName}: migration sequence ${match.groups.sequence} must be greater than the previous non-exception sequence ${String(previousSequence).padStart(6, '0')}`,
    )
  }

  if (!duplicateOwner) {
    seenSequences.set(sequence, fileName)
  }

  if (!isHistoricalException) {
    previousSequence = sequence
  }
}

assert.deepEqual(
  violations,
  [],
  [
    'Migration file hygiene check failed.',
    'Create new migrations with the next unused monotonic sequence number.',
    'Do not rename or edit already applied migrations without a dedicated rollout plan.',
    violations.join('\n'),
  ].join('\n'),
)

console.log('Migration file hygiene check passed.')
