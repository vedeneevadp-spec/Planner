import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'

export const INFRASTRUCTURE_BACKUP_FORMAT = 'planner.infrastructure-backup'
export const INFRASTRUCTURE_BACKUP_VERSION = 1
export const INFRASTRUCTURE_BACKUP_DIRECTORY_PATTERN =
  /^planner-infra-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/
const DEPLOY_DATABASE_BACKUP_PATTERN =
  /^planner-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.dump$/

export function createInfrastructureBackupId(date = new Date()) {
  return `planner-infra-${date.toISOString().replaceAll(/[:.]/g, '-')}`
}

export function resolveBackupConnectionString(env = process.env) {
  return (
    env.BACKUP_DATABASE_URL ??
    env.MIGRATE_DATABASE_URL ??
    env.DATABASE_URL ??
    'postgres://planner:planner@127.0.0.1:54329/planner_development'
  )
}

export function createPgToolConnectionString(value) {
  try {
    const url = new URL(value)

    url.searchParams.delete('uselibpqcompat')

    return url.toString()
  } catch {
    return value
      .replace(/([?&])uselibpqcompat=true(&|$)/, '$1')
      .replace(/[?&]$/, '')
  }
}

export function redactConnectionString(value) {
  try {
    const url = new URL(value)

    if (url.password) {
      url.password = '***'
    }

    return url.toString()
  } catch {
    return '<redacted-database-url>'
  }
}

export async function collectFileInventory(rootDirectory) {
  const resolvedRoot = path.resolve(rootDirectory)
  const files = []

  await walkDirectory(resolvedRoot, resolvedRoot, files)
  files.sort((left, right) => left.path.localeCompare(right.path))

  return files
}

/**
 * Copies only regular files and directories while deliberately normalizing
 * directory permissions. The production asset tree uses setgid directories;
 * preserving that bit would conflict with systemd RestrictSUIDSGID in the
 * unprivileged backup service.
 */
export async function copyBackupAssetDirectory(
  sourceDirectory,
  destinationDirectory,
) {
  const sourceMetadata = await lstat(sourceDirectory)

  if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory()) {
    throw new Error('Backup asset source must be a regular directory.')
  }

  await mkdir(destinationDirectory, { mode: 0o700 })
  await copyBackupAssetEntries(
    path.resolve(sourceDirectory),
    path.resolve(destinationDirectory),
    '',
  )
}

async function copyBackupAssetEntries(sourceRoot, destinationRoot, relative) {
  const sourceDirectory = path.join(sourceRoot, relative)
  const entries = await readdir(sourceDirectory, { withFileTypes: true })

  for (const entry of entries) {
    const relativePath = path.join(relative, entry.name)
    const sourcePath = path.join(sourceRoot, relativePath)
    const destinationPath = path.join(destinationRoot, relativePath)
    const portablePath = relativePath.split(path.sep).join('/')

    if (entry.isSymbolicLink()) {
      throw new Error(
        `Backup asset snapshots cannot contain symbolic links: ${portablePath}`,
      )
    }

    if (entry.isDirectory()) {
      await mkdir(destinationPath, { mode: 0o700 })
      await copyBackupAssetEntries(sourceRoot, destinationRoot, relativePath)
      continue
    }

    if (!entry.isFile()) {
      throw new Error(
        `Backup asset snapshots contain an unsupported entry: ${portablePath}`,
      )
    }

    await copyFile(sourcePath, destinationPath)
  }
}

async function walkDirectory(rootDirectory, directory, files) {
  const entries = await readdir(directory, {
    withFileTypes: true,
  })

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name)
    const relativePath = toPortableRelativePath(rootDirectory, filePath)

    if (entry.isSymbolicLink()) {
      throw new Error(
        `Backup asset snapshots cannot contain symbolic links: ${relativePath}`,
      )
    }

    if (entry.isDirectory()) {
      await walkDirectory(rootDirectory, filePath, files)
      continue
    }

    if (!entry.isFile()) {
      throw new Error(
        `Backup asset snapshots contain an unsupported entry: ${relativePath}`,
      )
    }

    const metadata = await stat(filePath)

    files.push({
      byteLength: metadata.size,
      path: relativePath,
      sha256: await hashFile(filePath),
    })
  }
}

export async function hashFile(filePath) {
  const hash = createHash('sha256')

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath)

    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', resolve)
  })

  return hash.digest('hex')
}

export function summarizeFileInventory(files) {
  return {
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.byteLength, 0),
  }
}

export function createInfrastructureBackupManifest(input) {
  const assetSummary = summarizeFileInventory(input.assetFiles)

  return {
    assets: {
      directory: 'assets',
      files: input.assetFiles,
      sourceDirectory: input.assetSourceDirectory,
      sourcePresent: input.assetSourcePresent,
      ...assetSummary,
    },
    backupId: input.backupId,
    completedAt: input.completedAt,
    format: INFRASTRUCTURE_BACKUP_FORMAT,
    postgres: {
      dumpByteLength: input.dumpByteLength,
      dumpFile: 'postgres.dump',
      dumpSha256: input.dumpSha256,
      pgDumpVersion: input.pgDumpVersion,
    },
    source: {
      appCommit: input.appCommit,
      appVersion: input.appVersion,
      host: input.host,
    },
    startedAt: input.startedAt,
    version: INFRASTRUCTURE_BACKUP_VERSION,
  }
}

export function parseInfrastructureBackupManifest(value) {
  if (!isRecord(value)) {
    throw new Error('Infrastructure backup manifest must be an object.')
  }

  assertExactValue(
    value.format,
    INFRASTRUCTURE_BACKUP_FORMAT,
    'manifest format',
  )
  assertExactValue(
    value.version,
    INFRASTRUCTURE_BACKUP_VERSION,
    'manifest version',
  )
  assertBackupId(value.backupId)
  assertIsoTimestamp(value.startedAt, 'startedAt')
  assertIsoTimestamp(value.completedAt, 'completedAt')

  if (!isRecord(value.postgres)) {
    throw new Error('Infrastructure backup manifest is missing postgres data.')
  }

  assertExactValue(value.postgres.dumpFile, 'postgres.dump', 'dump file')
  assertNonNegativeInteger(
    value.postgres.dumpByteLength,
    'postgres dumpByteLength',
  )
  assertSha256(value.postgres.dumpSha256, 'postgres dumpSha256')
  assertNonEmptyString(value.postgres.pgDumpVersion, 'postgres pgDumpVersion')

  if (!isRecord(value.assets)) {
    throw new Error('Infrastructure backup manifest is missing assets data.')
  }

  assertExactValue(value.assets.directory, 'assets', 'assets directory')
  assertNonNegativeInteger(value.assets.fileCount, 'assets fileCount')
  assertNonNegativeInteger(value.assets.totalBytes, 'assets totalBytes')
  assertNonEmptyString(value.assets.sourceDirectory, 'assets sourceDirectory')

  if (typeof value.assets.sourcePresent !== 'boolean') {
    throw new Error('assets sourcePresent must be a boolean.')
  }

  if (!Array.isArray(value.assets.files)) {
    throw new Error('assets files must be an array.')
  }

  const assetPaths = new Set()

  for (const [index, file] of value.assets.files.entries()) {
    if (!isRecord(file)) {
      throw new Error(`assets files[${index}] must be an object.`)
    }

    assertSafeRelativePath(file.path, `assets files[${index}].path`)
    assertNonNegativeInteger(
      file.byteLength,
      `assets files[${index}].byteLength`,
    )
    assertSha256(file.sha256, `assets files[${index}].sha256`)

    if (assetPaths.has(file.path)) {
      throw new Error(`Duplicate asset path in manifest: ${file.path}`)
    }

    assetPaths.add(file.path)
  }

  const calculatedAssetSummary = summarizeFileInventory(value.assets.files)

  if (
    calculatedAssetSummary.fileCount !== value.assets.fileCount ||
    calculatedAssetSummary.totalBytes !== value.assets.totalBytes
  ) {
    throw new Error('Asset manifest totals do not match the file inventory.')
  }

  if (!isRecord(value.source)) {
    throw new Error('Infrastructure backup manifest is missing source data.')
  }

  assertNonEmptyString(value.source.appCommit, 'source appCommit')
  assertNonEmptyString(value.source.appVersion, 'source appVersion')
  assertNonEmptyString(value.source.host, 'source host')

  return value
}

export async function readInfrastructureBackupManifest(backupSetDirectory) {
  const manifestPath = path.join(
    path.resolve(backupSetDirectory),
    'manifest.json',
  )
  const value = JSON.parse(await readFile(manifestPath, 'utf8'))

  return parseInfrastructureBackupManifest(value)
}

export async function verifyInfrastructureBackupSet(
  backupSetDirectory,
  options = {},
) {
  const resolvedDirectory = await realpath(path.resolve(backupSetDirectory))
  const manifest = await readInfrastructureBackupManifest(resolvedDirectory)

  const directoryName = path.basename(resolvedDirectory)

  if (
    directoryName !== manifest.backupId &&
    directoryName !== `.incomplete-${manifest.backupId}`
  ) {
    throw new Error(
      `Backup directory ${directoryName} does not match manifest id ${manifest.backupId}.`,
    )
  }

  const dumpPath = path.join(resolvedDirectory, manifest.postgres.dumpFile)
  const dumpMetadata = await stat(dumpPath)

  if (dumpMetadata.size !== manifest.postgres.dumpByteLength) {
    throw new Error('Postgres dump size does not match the manifest.')
  }

  if ((await hashFile(dumpPath)) !== manifest.postgres.dumpSha256) {
    throw new Error('Postgres dump checksum does not match the manifest.')
  }

  const assetDirectory = path.join(resolvedDirectory, manifest.assets.directory)
  const assetFiles = await collectFileInventory(assetDirectory)

  if (JSON.stringify(assetFiles) !== JSON.stringify(manifest.assets.files)) {
    throw new Error('Asset snapshot does not match the manifest.')
  }

  if (options.verifyPgRestore !== false) {
    if (!options.runCommand) {
      throw new Error('verifyPgRestore requires a runCommand implementation.')
    }

    await options.runCommand('pg_restore', ['--list', dumpPath], {
      capture: true,
    })
  }

  return {
    assetDirectory,
    backupSetDirectory: resolvedDirectory,
    dumpPath,
    manifest,
  }
}

export async function findLatestInfrastructureBackupSet(rootDirectory) {
  const manifests = []

  await findManifestFiles(path.resolve(rootDirectory), manifests)

  if (manifests.length === 0) {
    throw new Error(
      `No infrastructure backup manifest was found under ${rootDirectory}.`,
    )
  }

  const candidates = await Promise.all(
    manifests.map(async (manifestPath) => ({
      directory: path.dirname(manifestPath),
      manifest: await readInfrastructureBackupManifest(
        path.dirname(manifestPath),
      ),
    })),
  )

  candidates.sort((left, right) =>
    right.manifest.completedAt.localeCompare(left.manifest.completedAt),
  )

  return candidates[0]
}

async function findManifestFiles(directory, manifests) {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)

    if (entry.isSymbolicLink()) {
      continue
    }

    if (entry.isDirectory()) {
      await findManifestFiles(entryPath, manifests)
      continue
    }

    if (entry.isFile() && entry.name === 'manifest.json') {
      manifests.push(entryPath)
    }
  }
}

export async function pruneLocalInfrastructureBackups(
  rootDirectory,
  options = {},
) {
  const now = options.now ?? new Date()
  const keepDays = options.keepDays ?? 14
  const cutoffTime = now.getTime() - keepDays * 24 * 60 * 60 * 1000
  const entries = await readdir(rootDirectory, { withFileTypes: true })
  const removed = []

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    const entryPath = path.join(rootDirectory, entry.name)

    if (entry.name.startsWith('.incomplete-planner-infra-')) {
      const metadata = await lstat(entryPath)

      if (metadata.mtimeMs < cutoffTime) {
        await rm(entryPath, { force: true, recursive: true })
        removed.push(entry.name)
      }

      continue
    }

    if (!INFRASTRUCTURE_BACKUP_DIRECTORY_PATTERN.test(entry.name)) {
      continue
    }

    const manifest = await readInfrastructureBackupManifest(entryPath)

    if (Date.parse(manifest.completedAt) < cutoffTime) {
      await rm(entryPath, { force: true, recursive: true })
      removed.push(entry.name)
    }
  }

  return removed.sort()
}

export async function pruneDeployDatabaseBackups(
  rootDirectory,
  keepCount = 10,
) {
  if (!Number.isSafeInteger(keepCount) || keepCount <= 0) {
    throw new Error('Deploy database backup retention must be positive.')
  }

  const entries = await readdir(rootDirectory, { withFileTypes: true })
  const backupFiles = entries
    .filter(
      (entry) =>
        entry.isFile() && DEPLOY_DATABASE_BACKUP_PATTERN.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left))
  const removed = []

  for (const fileName of backupFiles.slice(keepCount)) {
    await rm(path.join(rootDirectory, fileName), { force: true })
    await rm(path.join(rootDirectory, `${fileName}.manifest.json`), {
      force: true,
    })
    await rm(path.join(rootDirectory, `${fileName}.sha256`), { force: true })
    removed.push(fileName)
  }

  return removed
}

export async function writeJsonAtomic(filePath, value) {
  const resolvedPath = path.resolve(filePath)
  const temporaryPath = `${resolvedPath}.tmp-${process.pid}-${randomUUID()}`

  await mkdir(path.dirname(resolvedPath), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  })
  await rename(temporaryPath, resolvedPath)
}

export function readPositiveInteger(value, name, fallback) {
  if (value === undefined || value === '') {
    return fallback
  }

  const parsed = Number(value)

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }

  return parsed
}

export function createDrillDatabaseName(
  date = new Date(),
  suffix = randomUUID(),
) {
  const timestamp = date
    .toISOString()
    .replaceAll(/[^0-9]/g, '')
    .slice(0, 14)
  const normalizedSuffix = suffix.replaceAll(/[^a-z0-9]/gi, '').slice(0, 12)

  return `planner_restore_drill_${timestamp}_${normalizedSuffix}`.toLowerCase()
}

export function createDatabaseUrl(connectionString, databaseName) {
  const url = new URL(connectionString)

  if (!/^planner_restore_drill_[a-z0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsafe restore drill database name: ${databaseName}`)
  }

  url.pathname = `/${databaseName}`

  return url.toString()
}

function toPortableRelativePath(rootDirectory, filePath) {
  const relativePath = path.relative(rootDirectory, filePath)

  assertSafeRelativePath(relativePath, 'asset path')

  return relativePath.split(path.sep).join('/')
}

function assertSafeRelativePath(value, name) {
  if (
    typeof value !== 'string' ||
    value === '' ||
    path.isAbsolute(value) ||
    value.split(/[\\/]/).some((part) => part === '..' || part === '')
  ) {
    throw new Error(`${name} must be a safe relative path.`)
  }
}

function assertBackupId(value) {
  if (
    typeof value !== 'string' ||
    !INFRASTRUCTURE_BACKUP_DIRECTORY_PATTERN.test(value)
  ) {
    throw new Error('Invalid infrastructure backup id.')
  }
}

function assertIsoTimestamp(value, name) {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    !value.endsWith('Z')
  ) {
    throw new Error(`${name} must be an ISO timestamp.`)
  }
}

function assertNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer.`)
  }
}

function assertSha256(value, name) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${name} must be a SHA-256 digest.`)
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string.`)
  }
}

function assertExactValue(value, expected, name) {
  if (value !== expected) {
    throw new Error(`Unexpected ${name}: ${String(value)}`)
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
