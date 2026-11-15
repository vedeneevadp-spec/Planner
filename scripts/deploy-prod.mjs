import {
  createRemotePreparationScript as renderRemotePreparation,
  createRemoteReleaseScript as renderRemoteRelease,
  createRemoteSourceExtractionScript,
  createRemoteDeployLockScript,
  shellQuote,
} from './deploy-prod-remote.mjs'
export {
  createRemoteDatabaseTransportValidatorScript,
  createRemoteSourceExtractionScript,
  createRemoteDeployLockScript,
} from './deploy-prod-remote.mjs'
export function createRemotePreparationScript(layout) {
  return renderRemotePreparation(layout, config)
}
export function createRemoteReleaseScript(layout) {
  return renderRemoteRelease(layout, config, skipDbBackup)
}
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  createReleaseLayout,
  parseReleaseRetention,
} from './deploy-prod-helpers.mjs'

const DEFAULTS = {
  domain: 'chaotika.ru',
  healthPath: '/api/ready',
  iconLocalDirectory: 'apps/api/tmp/icon-assets',
  iconRemoteDirectory: '/var/lib/planner/icon-assets',
  releaseRetention: 5,
  remoteHost: 'root@147.45.158.186',
  remoteRoot: '/opt/planner',
}

const args = new Set(process.argv.slice(2))
const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

const config = {
  domain: readEnv('DEPLOY_DOMAIN', DEFAULTS.domain),
  healthPath: readEnv('DEPLOY_HEALTH_PATH', DEFAULTS.healthPath),
  iconLocalDirectory: readEnv(
    'DEPLOY_ICON_LOCAL_DIR',
    DEFAULTS.iconLocalDirectory,
  ),
  iconRemoteDirectory: readEnv(
    'DEPLOY_ICON_REMOTE_DIR',
    DEFAULTS.iconRemoteDirectory,
  ),
  remoteHost: readEnv('DEPLOY_HOST', DEFAULTS.remoteHost),
  remoteRoot: readEnv('DEPLOY_REMOTE_ROOT', DEFAULTS.remoteRoot),
  releaseRetention: parseReleaseRetention(
    readEnv('DEPLOY_RELEASE_RETENTION', DEFAULTS.releaseRetention),
  ),
}

const dryRun = args.has('--dry-run')
const skipChecks =
  args.has('--skip-checks') || process.env.DEPLOY_SKIP_CHECKS === '1'
const skipDbBackup =
  args.has('--skip-db-backup') || process.env.DEPLOY_SKIP_DB_BACKUP === '1'
const skipIcons =
  args.has('--skip-icons') || process.env.DEPLOY_SKIP_ICONS === '1'
import { REMOTE_DEPLOY_LOCK_MARKER } from './deploy-prod-remote.mjs'
const REMOTE_DEPLOY_LOCK_TIMEOUT_MS = 15_000
const SOURCE_UPLOAD_CHUNK_BYTES = 256 * 1024
const SOURCE_UPLOAD_ATTEMPTS = 3
const SSH_CONNECTION_ARGS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=5',
  '-o',
  'ServerAliveCountMax=12',
  '-o',
  'TCPKeepAlive=yes',
  '-o',
  'IPQoS=none',
]
const RSYNC_REMOTE_SHELL = ['ssh', ...SSH_CONNECTION_ARGS].join(' ')
const LOCAL_CHECK_ENV_OVERRIDES_TO_CLEAR = [
  'API_AUTH_MODE',
  'VITE_API_ACCESS_TOKEN',
  'VITE_API_BASE_URL',
  'VITE_ACTOR_USER_ID',
  'VITE_AUTH_PROVIDER',
  'VITE_WORKSPACE_ID',
  'WEB_AUTH_PROVIDER',
]

if (isMain) {
  if (args.has('--help') || args.has('-h')) {
    printHelp()
  } else {
    await main().catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
  }
}

async function main() {
  printHeader()
  const source = await assertDeploySourceReady()
  const layout = createReleaseLayout(config.remoteRoot, source.head)

  console.log(`[deploy] Release directory: ${layout.releaseDirectory}`)
  const remoteLock = await acquireRemoteDeployLock(layout)

  try {
    if (skipChecks) {
      console.log('[deploy] Skipping local checks.')
    } else {
      await run('npm', ['run', 'ci'], {
        env: createLocalCheckEnv(),
        signal: remoteLock.signal,
      })
    }

    if (dryRun) {
      console.log('[deploy] Dry run: remote directory preparation skipped.')
    }

    if (!dryRun) {
      await ensureRemoteDirectories(layout, remoteLock.signal)
    }
    await syncProject(layout, remoteLock.signal)
    await syncIconAssets(remoteLock.signal)

    if (dryRun) {
      console.log('[deploy] Dry run complete. Remote build/restart skipped.')
      return
    }

    await runRemoteRelease(layout, remoteLock.signal)
    console.log(`[deploy] Production is healthy: https://${config.domain}`)
  } finally {
    await remoteLock.release()
  }
}

function printHeader() {
  console.log(
    [
      '[deploy] Production deploy',
      `  domain: ${config.domain}`,
      `  host:   ${config.remoteHost}`,
      `  root:   ${config.remoteRoot}`,
      `  icons:  ${config.iconRemoteDirectory}`,
      `  keep:   ${config.releaseRetention} releases`,
    ].join('\n'),
  )
}

function printHelp() {
  console.log(`
Usage:
  npm run deploy:prod

Source guard:
  The deploy runs only from a clean tracked branch whose HEAD matches upstream.

Concurrency:
  A non-blocking remote flock covers preparation, source transfer, build, migrations,
  activation, healthchecks, and release retention. A concurrent deploy exits
  immediately instead of waiting for the active deploy.

Options:
  --skip-checks  Do not run npm run ci before deploy.
  --skip-db-backup
                 Do not run pg_dump before production migrations.
  --skip-icons   Do not copy local uploaded icon assets.
  --dry-run      Run checks and package source, but do not upload/build/restart remote services.

Environment overrides:
  DEPLOY_HOST=root@147.45.158.186
  DEPLOY_DOMAIN=chaotika.ru
  DEPLOY_REMOTE_ROOT=/opt/planner
  DEPLOY_ICON_REMOTE_DIR=/var/lib/planner/icon-assets
  DEPLOY_RELEASE_RETENTION=5
`)
}

async function assertDeploySourceReady() {
  const branch = (await collect('git', ['branch', '--show-current'])).trim()

  if (!branch) {
    throw new Error(
      [
        '[deploy] Refusing to deploy from detached HEAD.',
        '[deploy] Checkout a tracked branch, then run npm run deploy:prod again.',
      ].join('\n'),
    )
  }

  const status = await collect('git', [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ])

  if (status.trim()) {
    throw new Error(
      [
        '[deploy] Refusing to deploy with uncommitted local changes.',
        '[deploy] Commit or stash these changes first:',
        status.trim(),
      ].join('\n'),
    )
  }

  const upstream = await collectUpstream(branch)
  const remote = (
    await collect('git', ['config', `branch.${branch}.remote`])
  ).trim()

  if (!remote) {
    throw new Error(
      [
        `[deploy] Refusing to deploy because ${branch} has no configured remote.`,
        `[deploy] Run git branch --set-upstream-to=origin/${branch} ${branch}, then npm run deploy:prod again.`,
      ].join('\n'),
    )
  }

  await run('git', ['fetch', '--quiet', '--prune', remote])

  const head = (await collect('git', ['rev-parse', 'HEAD'])).trim()
  const upstreamHead = (
    await collect('git', ['rev-parse', '@{upstream}'])
  ).trim()

  if (head !== upstreamHead) {
    const { ahead, behind } = await collectAheadBehind()

    if (ahead > 0 && behind === 0) {
      throw new Error(
        [
          `[deploy] Refusing to deploy unpushed commits from ${branch}.`,
          `[deploy] ${branch} is ahead of ${upstream} by ${ahead} commit(s).`,
          '[deploy] Run git push, then npm run deploy:prod again.',
        ].join('\n'),
      )
    }

    if (ahead === 0 && behind > 0) {
      throw new Error(
        [
          `[deploy] Refusing to deploy an outdated local branch ${branch}.`,
          `[deploy] ${branch} is behind ${upstream} by ${behind} commit(s).`,
          '[deploy] Run git pull --ff-only, then npm run deploy:prod again.',
        ].join('\n'),
      )
    }

    throw new Error(
      [
        `[deploy] Refusing to deploy a branch that diverged from ${upstream}.`,
        `[deploy] ${branch} is ahead by ${ahead} commit(s) and behind by ${behind} commit(s).`,
        '[deploy] Reconcile the branch with Git, then npm run deploy:prod again.',
      ].join('\n'),
    )
  }

  console.log(
    [
      '[deploy] Source guard passed.',
      `  branch:   ${branch}`,
      `  upstream: ${upstream}`,
      `  commit:   ${head.slice(0, 12)}`,
    ].join('\n'),
  )

  return { branch, head, upstream }
}

async function collectUpstream(branch) {
  try {
    const upstream = (
      await collect('git', [
        'rev-parse',
        '--abbrev-ref',
        '--symbolic-full-name',
        '@{upstream}',
      ])
    ).trim()

    if (upstream) {
      return upstream
    }
  } catch {
    // Fall through to a clearer deploy-specific error below.
  }

  throw new Error(
    [
      `[deploy] Refusing to deploy because ${branch} has no upstream branch.`,
      `[deploy] Run git push --set-upstream origin ${branch}, then npm run deploy:prod again.`,
    ].join('\n'),
  )
}

async function collectAheadBehind() {
  const output = (
    await collect('git', [
      'rev-list',
      '--left-right',
      '--count',
      'HEAD...@{upstream}',
    ])
  ).trim()
  const [aheadRaw = '0', behindRaw = '0'] = output.split(/\s+/)

  return {
    ahead: Number(aheadRaw),
    behind: Number(behindRaw),
  }
}

async function ensureRemoteDirectories(layout, signal) {
  await runWithInput(
    'ssh',
    [...SSH_CONNECTION_ARGS, config.remoteHost, 'bash', '-se'],
    createRemotePreparationScript(layout),
    { signal },
  )
}

async function syncProject(layout, signal) {
  const archiveDirectory = await mkdtemp(
    path.join(tmpdir(), 'planner-deploy-source-'),
  )
  const archivePath = path.join(archiveDirectory, 'source.tar.gz')

  try {
    await run(
      'git',
      ['archive', '--format=tar.gz', '--output', archivePath, layout.releaseId],
      { signal },
    )

    if (dryRun) {
      console.log('[deploy] Dry run: tracked source archive upload skipped.')
      return
    }

    const archiveUpload = await uploadSourceArchiveInChunks(
      archivePath,
      layout,
      signal,
    )
    await runWithInput(
      'ssh',
      [...SSH_CONNECTION_ARGS, config.remoteHost, 'bash', '-se'],
      createRemoteSourceExtractionScript(layout, archiveUpload),
      { signal },
    )
  } finally {
    await rm(archiveDirectory, { force: true, recursive: true })
  }
}

async function uploadSourceArchiveInChunks(archivePath, layout, signal) {
  const archive = await readFile(archivePath)
  const sha256 = createHash('sha256').update(archive).digest('hex')
  const partCount = Math.ceil(archive.length / SOURCE_UPLOAD_CHUNK_BYTES)

  if (partCount === 0) {
    throw new Error('[deploy] Refusing to upload an empty source archive.')
  }

  console.log(
    `[deploy] Uploading source archive in ${partCount} verified chunk(s).`,
  )

  for (let index = 0; index < partCount; index += 1) {
    const partName = `.deploy-source.part.${String(index).padStart(4, '0')}`
    const localPartPath = path.join(path.dirname(archivePath), partName)
    const remotePartPath = `${layout.releaseDirectory}/${partName}`
    const start = index * SOURCE_UPLOAD_CHUNK_BYTES
    const end = Math.min(start + SOURCE_UPLOAD_CHUNK_BYTES, archive.length)

    await writeFile(localPartPath, archive.subarray(start, end))
    await uploadSourceChunkWithRetries(
      localPartPath,
      remotePartPath,
      index,
      partCount,
      signal,
    )
  }

  return { partCount, sha256 }
}

async function uploadSourceChunkWithRetries(
  localPartPath,
  remotePartPath,
  index,
  partCount,
  signal,
) {
  for (let attempt = 1; attempt <= SOURCE_UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      await run(
        'scp',
        [
          ...SSH_CONNECTION_ARGS,
          localPartPath,
          `${config.remoteHost}:${remotePartPath}`,
        ],
        { signal },
      )
      return
    } catch (error) {
      if (signal?.aborted || attempt === SOURCE_UPLOAD_ATTEMPTS) {
        throw error
      }

      console.warn(
        `[deploy] Source chunk ${index + 1}/${partCount} upload failed; retrying (${attempt + 1}/${SOURCE_UPLOAD_ATTEMPTS}).`,
      )
    }
  }
}

async function syncIconAssets(signal) {
  if (skipIcons) {
    console.log('[deploy] Skipping icon asset sync.')
    return
  }

  if (!existsSync(config.iconLocalDirectory)) {
    console.log(
      `[deploy] Local icon asset directory not found: ${config.iconLocalDirectory}. Skipping.`,
    )
    return
  }

  const rsyncArgs = [
    '-az',
    '-e',
    RSYNC_REMOTE_SHELL,
    `${config.iconLocalDirectory.replace(/\/$/, '')}/`,
    `${config.remoteHost}:${config.iconRemoteDirectory.replace(/\/$/, '')}/`,
  ]

  if (dryRun) {
    rsyncArgs.unshift('--dry-run')
  }

  await run('rsync', rsyncArgs, { signal })
}

async function acquireRemoteDeployLock(layout) {
  const remoteCommand = `bash -c ${shellQuote(
    createRemoteDeployLockScript(layout),
  )}`
  const child = spawn(
    resolveCommand('ssh'),
    [...SSH_CONNECTION_ARGS, config.remoteHost, remoteCommand],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  const abortController = new AbortController()
  let acquired = false
  let releasing = false
  let stdout = ''
  let acquisitionTimeout

  console.log(`[deploy] Acquiring remote deploy lock: ${layout.lockFile}`)

  let resolveExit
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve
  })

  const acquiredPromise = new Promise((resolve, reject) => {
    acquisitionTimeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(
        new Error(
          '[deploy] Timed out after 15 seconds while acquiring the remote deploy lock.',
        ),
      )
    }, REMOTE_DEPLOY_LOCK_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk

      while (stdout.includes('\n')) {
        const newlineIndex = stdout.indexOf('\n')
        const line = stdout.slice(0, newlineIndex)
        stdout = stdout.slice(newlineIndex + 1)

        if (!acquired && line === REMOTE_DEPLOY_LOCK_MARKER) {
          acquired = true
          console.log('[deploy] Remote deploy lock acquired.')
          resolve()
        } else if (line.length > 0) {
          console.log(line)
        }
      }
    })
    child.once('error', (error) => {
      if (!acquired) {
        reject(error)
      }
    })
    child.once('exit', (code, signal) => {
      const result = { code, signal }
      resolveExit(result)

      if (!acquired) {
        reject(
          new Error(
            code === 75
              ? '[deploy] Another production deploy is already in progress. Try again after it finishes.'
              : `[deploy] Failed to acquire the remote deploy lock (exit ${code ?? signal ?? 'unknown'}).`,
          ),
        )
        return
      }

      if (!releasing) {
        abortController.abort(
          new Error(
            `[deploy] Remote deploy lock connection ended unexpectedly (exit ${code ?? signal ?? 'unknown'}).`,
          ),
        )
      }
    })
  })

  try {
    await acquiredPromise
  } finally {
    clearTimeout(acquisitionTimeout)
  }

  return {
    signal: abortController.signal,
    async release() {
      if (releasing) {
        return
      }

      releasing = true

      if (child.exitCode === null && child.signalCode === null) {
        child.stdin.end('release\n')
      }

      const { code, signal } = await exitPromise

      if (code !== 0) {
        throw new Error(
          `[deploy] Remote deploy lock cleanup failed (exit ${code ?? signal ?? 'unknown'}).`,
        )
      }

      console.log('[deploy] Remote deploy lock released.')
    },
  }
}

async function runRemoteRelease(layout, signal) {
  await runWithInput(
    'ssh',
    [...SSH_CONNECTION_ARGS, config.remoteHost, 'bash', '-se'],
    createRemoteReleaseScript(layout),
    { signal },
  )
}

function readEnv(name, fallback) {
  const value = process.env[name]

  return value && value.trim().length > 0 ? value : fallback
}

function createLocalCheckEnv() {
  const env = { ...process.env }
  const clearedNames = []

  for (const name of LOCAL_CHECK_ENV_OVERRIDES_TO_CLEAR) {
    if (env[name] !== undefined) {
      delete env[name]
      clearedNames.push(name)
    }
  }

  if (clearedNames.length > 0) {
    console.log(
      `[deploy] Running local checks without dev env overrides: ${clearedNames.join(', ')}`,
    )
  }

  return env
}

function resolveCommand(command) {
  return process.platform === 'win32' ? `${command}.cmd` : command
}

async function collect(command, args) {
  const resolvedCommand = resolveCommand(command)

  return new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(stdout)
        return
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}\n${stderr}`,
        ),
      )
    })
  })
}

async function run(command, args, options = {}) {
  const resolvedCommand = resolveCommand(command)
  console.log(`[deploy] ${command} ${args.join(' ')}`)

  await new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
      env: options.env ?? process.env,
      signal: options.signal,
      stdio: 'inherit',
    })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`,
        ),
      )
    })
  })
}

async function runWithInput(command, args, input, options = {}) {
  const resolvedCommand = resolveCommand(command)
  console.log(`[deploy] ${command} ${args.join(' ')}`)

  await new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
      signal: options.signal,
      stdio: ['pipe', 'inherit', 'inherit'],
    })

    child.stdin.end(input)
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(
        new Error(
          `${command} ${args.join(' ')} failed with exit code ${code ?? 'unknown'}`,
        ),
      )
    })
  })
}
