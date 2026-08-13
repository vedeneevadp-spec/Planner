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
const REMOTE_DEPLOY_LOCK_MARKER = '__PLANNER_DEPLOY_LOCK_ACQUIRED__'
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

export function createRemotePreparationScript(layout) {
  return `
set -euo pipefail

remote_root=${shellQuote(layout.remoteRoot)}
release_dir=${shellQuote(layout.releaseDirectory)}
current_link=${shellQuote(layout.currentLink)}

ensure_system_group() {
  group_name="$1"

  if ! getent group "$group_name" >/dev/null; then
    groupadd --system "$group_name"
  fi
}

ensure_system_user() {
  user_name="$1"
  group_name="$2"

  if ! id -u "$user_name" >/dev/null 2>&1; then
    useradd --system --gid "$group_name" --home-dir /nonexistent --shell /usr/sbin/nologin "$user_name"
  elif [ "$(id -gn "$user_name")" != "$group_name" ]; then
    echo "Existing system user $user_name has an unexpected primary group." >&2
    return 1
  fi
}

for service_group in \
  planner-api \
  planner-alert \
  planner-assets \
  planner-backup \
  planner-build \
  planner-migrate \
  planner-push \
  planner-restore \
  planner-worker; do
  ensure_system_group "$service_group"
done

ensure_system_user planner-api planner-api
ensure_system_user planner-alert planner-alert
ensure_system_user planner-backup planner-backup
ensure_system_user planner-build planner-build
ensure_system_user planner-migrate planner-migrate
ensure_system_user planner-restore planner-restore
ensure_system_user planner-worker planner-worker

# Keep the immediately previous, pre-isolation release operable during an
# automatic rollback. The legacy account is not used by the new units.
if id -u planner >/dev/null 2>&1; then
  usermod -a -G planner-assets,planner-backup,planner-push planner
fi

mkdir -p \
  ${shellQuote(layout.releasesRoot)} \
  ${shellQuote(layout.backupsDirectory)} \
  ${shellQuote(`${layout.backupsDirectory}/infrastructure`)} \
  ${shellQuote(layout.stateDirectory)} \
  ${shellQuote(`${layout.sharedRoot}/build-cache`)} \
  ${shellQuote(`${layout.stateDirectory}/restic-cache`)} \
  ${shellQuote(config.iconRemoteDirectory)}

if [ ! -e "$current_link" ] && [ ! -L "$current_link" ] && [ -f "$remote_root/package.json" ]; then
  ln -s "$remote_root" "$current_link"
fi

current_target="$(readlink -f "$current_link" 2>/dev/null || true)"
if [ "$current_target" = "$release_dir" ]; then
  echo "Refusing to overwrite the active release: $release_dir" >&2
  exit 1
fi

if [ -d "$release_dir" ]; then
  if [ -f "$release_dir/.deploy-complete" ]; then
    echo "Refusing to overwrite an immutable completed release: $release_dir" >&2
    exit 1
  fi

  rm -rf "$release_dir"
fi

mkdir -p "$release_dir"
chown -R planner-build:planner-build "$release_dir"
chown -R planner-build:planner-build ${shellQuote(`${layout.sharedRoot}/build-cache`)}
chown -R planner-backup:planner-backup \
  ${shellQuote(layout.backupsDirectory)} \
  ${shellQuote(layout.stateDirectory)}
chown -R root:planner-assets ${shellQuote(config.iconRemoteDirectory)}
find ${shellQuote(config.iconRemoteDirectory)} -type d -exec chmod 2770 {} +
find ${shellQuote(config.iconRemoteDirectory)} -type f -exec chmod 0660 {} +
chmod 0700 \
  ${shellQuote(`${layout.sharedRoot}/build-cache`)} \
  ${shellQuote(layout.backupsDirectory)} \
  ${shellQuote(layout.stateDirectory)}
chmod 711 "$remote_root" ${shellQuote(layout.sharedRoot)}
`
}

export function createRemoteDatabaseTransportValidatorScript() {
  return String.raw`validate_database_transport() {
  database_url="$1"

  DATABASE_URL="$database_url" node --input-type=module <<'NODE'
const secureSslModes = new Set(['require', 'verify-ca', 'verify-full'])
const databaseUrl = process.env.DATABASE_URL?.trim()

let parsed

try {
  parsed = new URL(databaseUrl)
} catch {
  console.error('DATABASE_URL must be a valid PostgreSQL URL.')
  process.exit(1)
}

if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
  console.error('DATABASE_URL must use the postgres or postgresql scheme.')
  process.exit(1)
}

const hostname = parsed.hostname
  .trim()
  .toLowerCase()
  .replace(/^\[/, '')
  .replace(/\]$/, '')
const isLoopback =
  hostname === 'localhost' ||
  hostname === '::1' ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname)
const sslMode = parsed.searchParams.get('sslmode')?.trim().toLowerCase()

if (!isLoopback && (!sslMode || !secureSslModes.has(sslMode))) {
  console.error(
    'DATABASE_URL must require TLS for remote PostgreSQL (sslmode=require, verify-ca, or verify-full).',
  )
  process.exit(1)
}
NODE
}`
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

export function createRemoteSourceExtractionScript(layout, archiveUpload) {
  const partCount = archiveUpload?.partCount
  const sha256 = archiveUpload?.sha256

  if (!Number.isSafeInteger(partCount) || partCount < 1 || partCount > 9999) {
    throw new Error('Source archive part count must be between 1 and 9999.')
  }

  if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Source archive SHA-256 must be a lowercase hex digest.')
  }

  return `
set -euo pipefail

release_dir=${shellQuote(layout.releaseDirectory)}
archive_path=${shellQuote(`${layout.releaseDirectory}/.deploy-source.tar.gz`)}
parts_prefix=${shellQuote(`${layout.releaseDirectory}/.deploy-source.part.`)}
part_count=${partCount}
expected_sha256=${shellQuote(sha256)}

: > "$archive_path"
for part_index in $(seq 0 $((part_count - 1))); do
  part_path="$(printf '%s%04d' "$parts_prefix" "$part_index")"
  test -f "$part_path"
  cat "$part_path" >> "$archive_path"
done

printf '%s  %s\n' "$expected_sha256" "$archive_path" | sha256sum -c -

for part_index in $(seq 0 $((part_count - 1))); do
  part_path="$(printf '%s%04d' "$parts_prefix" "$part_index")"
  rm -f "$part_path"
done

tar -xzf "$archive_path" -C "$release_dir"
rm -f "$archive_path"
test -f "$release_dir/package.json"
`
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

export function createRemoteDeployLockScript(layout) {
  return `
set -euo pipefail

lock_file=${shellQuote(layout.lockFile)}

if ! command -v flock >/dev/null 2>&1; then
  echo "Production deploy requires flock on the remote host." >&2
  exit 69
fi

exec 9>"$lock_file"
if ! flock -n 9; then
  echo "Another production deploy is already in progress (lock: $lock_file)." >&2
  exit 75
fi

printf '%s\\n' ${shellQuote(REMOTE_DEPLOY_LOCK_MARKER)}
IFS= read -r _release_lock_signal || true
`
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

export function createRemoteReleaseScript(layout) {
  return `
set -Eeuo pipefail

remote_root=${shellQuote(layout.remoteRoot)}
release_dir=${shellQuote(layout.releaseDirectory)}
releases_root=${shellQuote(layout.releasesRoot)}
current_link=${shellQuote(layout.currentLink)}
shared_state_dir=${shellQuote(layout.stateDirectory)}
build_cache_dir=${shellQuote(`${layout.sharedRoot}/build-cache`)}
backups_dir=${shellQuote(layout.backupsDirectory)}
release_retention=${config.releaseRetention}
env_file="/etc/planner/planner.env"
backup_env_file="/etc/planner/backup.env"
previous_release=""
switched=0
backup_units_available=0
restore_helper_available=0

wait_for_url() {
  url="$1"

  for attempt in $(seq 1 30); do
    if curl -fsS "$url"; then
      return 0
    fi

    echo "Waiting for $url ($attempt/30)..."
    sleep 1
  done

  echo "Healthcheck failed: $url" >&2
  curl -v "$url" || true
  return 1
}

read_env_value() {
  key="$1"
  value="$(grep -E "^\${key}=" "$env_file" | tail -n 1 | cut -d= -f2- || true)"

  case "$value" in
    \\"*\\")
      value="\${value#\\"}"
      value="\${value%\\"}"
      ;;
    \\'*\\')
      value="\${value#\\'}"
      value="\${value%\\'}"
      ;;
  esac

  printf '%s' "$value"
}

read_env_file_value() {
  source_file="$1"
  key="$2"
  value="$(grep -E "^\${key}=" "$source_file" | tail -n 1 | cut -d= -f2- || true)"

  case "$value" in
    \\"*\\")
      value="\${value#\\"}"
      value="\${value%\\"}"
      ;;
    \\'*\\')
      value="\${value#\\'}"
      value="\${value%\\'}"
      ;;
  esac

  printf '%s' "$value"
}

require_env_value() {
  key="$1"
  value="$(read_env_value "$key")"

  if [ -z "$value" ]; then
    echo "Missing required production env value: $key" >&2
    return 1
  fi

  printf '%s' "$value"
}

${createRemoteDatabaseTransportValidatorScript()}

validate_production_env() {
  if [ ! -f "$env_file" ]; then
    echo "Missing production env file: $env_file" >&2
    return 1
  fi

  node_env_value="$(require_env_value NODE_ENV)"
  api_auth_mode_value="$(require_env_value API_AUTH_MODE)"
  api_db_rls_mode_value="$(require_env_value API_DB_RLS_MODE)"
  api_task_reminders_runtime_value="$(read_env_value API_TASK_REMINDERS_RUNTIME)"
  api_cors_origin_value="$(require_env_value API_CORS_ORIGIN)"
  auth_email_from_value="$(read_env_value AUTH_EMAIL_FROM)"
  auth_jwt_secret_value="$(require_env_value AUTH_JWT_SECRET)"
  auth_smtp_host_value="$(read_env_value AUTH_SMTP_HOST)"
  auth_smtp_password_value="$(read_env_value AUTH_SMTP_PASSWORD)"
  auth_smtp_port_value="$(read_env_value AUTH_SMTP_PORT)"
  auth_smtp_user_value="$(read_env_value AUTH_SMTP_USER)"
  firebase_service_account_path_value="$(read_env_value FIREBASE_SERVICE_ACCOUNT_PATH)"
  database_url_value="$(require_env_value DATABASE_URL)"
  migrate_database_url_value="$(read_env_value MIGRATE_DATABASE_URL)"
  user_backup_restore_database_url_value="$(read_env_value USER_BACKUP_RESTORE_DATABASE_URL)"
  user_backup_restore_helper_secret_value="$(read_env_value USER_BACKUP_RESTORE_HELPER_SECRET)"
  user_backup_restore_helper_url_value="$(read_env_value USER_BACKUP_RESTORE_HELPER_URL)"
  user_backup_restore_helper_port_value="$(read_env_value API_BACKUP_RESTORE_HELPER_PORT)"
  task_reminders_database_url_value="$(read_env_value TASK_REMINDERS_DATABASE_URL)"
  worker_database_url_value="$(read_env_value WORKER_DATABASE_URL)"
  api_icon_asset_dir_value="$(read_env_value API_ICON_ASSET_DIR)"
  backup_automation_enabled_value="$(read_env_value BACKUP_AUTOMATION_ENABLED)"
  restore_drill_automation_enabled_value="$(read_env_value RESTORE_DRILL_AUTOMATION_ENABLED)"
  effective_task_reminders_runtime_value="\${api_task_reminders_runtime_value:-api}"

  if [ -n "$firebase_service_account_path_value" ]; then
    if [ "$firebase_service_account_path_value" != "/etc/planner/firebase-service-account.json" ]; then
      echo "FIREBASE_SERVICE_ACCOUNT_PATH must use the managed /etc/planner credential path." >&2
      return 1
    fi

    if [ ! -f "$firebase_service_account_path_value" ] || [ -L "$firebase_service_account_path_value" ]; then
      echo "FIREBASE_SERVICE_ACCOUNT_PATH must be an existing regular file, not a symlink." >&2
      return 1
    fi
  fi

  if [ "$api_icon_asset_dir_value" != ${shellQuote(config.iconRemoteDirectory)} ]; then
    echo "API_ICON_ASSET_DIR must match the managed persistent production asset directory." >&2
    return 1
  fi

  if [ "$node_env_value" != "production" ]; then
    echo "NODE_ENV must be production in $env_file." >&2
    return 1
  fi

  if [ "$api_auth_mode_value" != "jwt" ]; then
    echo "API_AUTH_MODE must be jwt in production." >&2
    return 1
  fi

  case "$api_db_rls_mode_value" in
    claims_only|enabled|session_connection|transaction_local)
      ;;
    disabled)
      echo "API_DB_RLS_MODE=disabled is not allowed in production." >&2
      return 1
      ;;
    *)
      echo "API_DB_RLS_MODE must be claims_only, enabled, session_connection, or transaction_local in production." >&2
      return 1
      ;;
  esac

  case "$api_task_reminders_runtime_value" in
    ""|api|worker|disabled)
      ;;
    *)
      echo "API_TASK_REMINDERS_RUNTIME must be api, worker, or disabled." >&2
      return 1
      ;;
  esac

  case "$backup_automation_enabled_value" in
    ""|0|1)
      ;;
    *)
      echo "BACKUP_AUTOMATION_ENABLED must be 0 or 1." >&2
      return 1
      ;;
  esac

  case "$restore_drill_automation_enabled_value" in
    ""|0|1)
      ;;
    *)
      echo "RESTORE_DRILL_AUTOMATION_ENABLED must be 0 or 1." >&2
      return 1
      ;;
  esac

  if [ "$restore_drill_automation_enabled_value" = "1" ] && [ "$backup_automation_enabled_value" != "1" ]; then
    echo "RESTORE_DRILL_AUTOMATION_ENABLED=1 requires BACKUP_AUTOMATION_ENABLED=1." >&2
    return 1
  fi

  if [ "$backup_automation_enabled_value" = "1" ]; then
    if [ "$api_icon_asset_dir_value" != ${shellQuote(config.iconRemoteDirectory)} ]; then
      echo "API_ICON_ASSET_DIR must match the persistent production asset directory when backup automation is enabled." >&2
      return 1
    fi

    if [ ! -f "$backup_env_file" ]; then
      echo "Missing backup environment file: $backup_env_file" >&2
      return 1
    fi

    restic_repository_value="$(read_env_file_value "$backup_env_file" RESTIC_REPOSITORY)"
    restic_password_value="$(read_env_file_value "$backup_env_file" RESTIC_PASSWORD)"
    restic_password_file_value="$(read_env_file_value "$backup_env_file" RESTIC_PASSWORD_FILE)"
    backup_alert_webhook_value="$(read_env_file_value "$backup_env_file" BACKUP_ALERT_WEBHOOK_URL)"
    backup_alert_telegram_bot_token_value="$(read_env_file_value "$backup_env_file" BACKUP_ALERT_TELEGRAM_BOT_TOKEN)"
    backup_alert_telegram_chat_id_value="$(read_env_file_value "$backup_env_file" BACKUP_ALERT_TELEGRAM_CHAT_ID)"
    backup_alert_email_to_value="$(read_env_file_value "$backup_env_file" BACKUP_ALERT_EMAIL_TO)"
    backup_database_url_value="$(read_env_file_value "$backup_env_file" BACKUP_DATABASE_URL)"

    if [ -z "$restic_repository_value" ]; then
      echo "RESTIC_REPOSITORY is required in $backup_env_file." >&2
      return 1
    fi

    if [ -z "$backup_database_url_value" ]; then
      echo "BACKUP_DATABASE_URL is required in $backup_env_file for scheduled backups." >&2
      return 1
    fi

    if ! validate_database_transport "$backup_database_url_value"; then
      return 1
    fi

    if [ -z "$restic_password_value" ] && [ -z "$restic_password_file_value" ]; then
      echo "RESTIC_PASSWORD or RESTIC_PASSWORD_FILE is required in $backup_env_file." >&2
      return 1
    fi

    if [ -n "$restic_password_file_value" ] && [ ! -f "$restic_password_file_value" ]; then
      echo "RESTIC_PASSWORD_FILE does not exist." >&2
      return 1
    fi

    if [ -n "$restic_password_file_value" ] && { [ "$restic_password_file_value" != "/etc/planner/restic-password" ] || [ -L "$restic_password_file_value" ]; }; then
      echo "RESTIC_PASSWORD_FILE must be the managed regular file /etc/planner/restic-password." >&2
      return 1
    fi

    if [ -z "$backup_alert_webhook_value" ] && [ -z "$backup_alert_email_to_value" ] && { [ -z "$backup_alert_telegram_bot_token_value" ] || [ -z "$backup_alert_telegram_chat_id_value" ]; }; then
      echo "Configure BACKUP_ALERT_WEBHOOK_URL, BACKUP_ALERT_EMAIL_TO, or both Telegram backup alert values in $backup_env_file." >&2
      return 1
    fi

    if [ -n "$backup_alert_email_to_value" ]; then
      if [ -z "$auth_email_from_value" ] || [ -z "$auth_smtp_host_value" ] || [ -z "$auth_smtp_port_value" ]; then
        echo "BACKUP_ALERT_EMAIL_TO requires AUTH_EMAIL_FROM, AUTH_SMTP_HOST, and AUTH_SMTP_PORT in $env_file." >&2
        return 1
      fi

      if { [ -n "$auth_smtp_user_value" ] && [ -z "$auth_smtp_password_value" ]; } || { [ -z "$auth_smtp_user_value" ] && [ -n "$auth_smtp_password_value" ]; }; then
        echo "AUTH_SMTP_USER and AUTH_SMTP_PASSWORD must be configured together." >&2
        return 1
      fi
    fi
  fi

  if [ "$restore_drill_automation_enabled_value" = "1" ]; then
    restore_drill_admin_database_url_value="$(read_env_file_value "$backup_env_file" RESTORE_DRILL_ADMIN_DATABASE_URL)"

    if [ -z "$restore_drill_admin_database_url_value" ]; then
      echo "RESTORE_DRILL_ADMIN_DATABASE_URL is required in $backup_env_file." >&2
      return 1
    fi
  fi

  case "$auth_jwt_secret_value" in
    changeme|change-me|your-secret|replace-me|__AUTH_JWT_SECRET__)
      echo "AUTH_JWT_SECRET still looks like a placeholder." >&2
      return 1
      ;;
  esac

  if [ "$api_cors_origin_value" = "*" ]; then
    echo "API_CORS_ORIGIN=* is not allowed in production deploy." >&2
    return 1
  fi

  if [ -z "$database_url_value" ]; then
    echo "DATABASE_URL must be configured." >&2
    return 1
  fi

  if ! validate_database_transport "$database_url_value"; then
    return 1
  fi

  if [ "$api_db_rls_mode_value" = "transaction_local" ] && [ -z "$migrate_database_url_value" ]; then
    echo "MIGRATE_DATABASE_URL must be configured when production uses API_DB_RLS_MODE=transaction_local." >&2
    return 1
  fi

  if [ -z "$user_backup_restore_database_url_value" ]; then
    echo "USER_BACKUP_RESTORE_DATABASE_URL must be configured for same-scope user restore." >&2
    return 1
  fi

  if [ "\${#user_backup_restore_helper_secret_value}" -lt 32 ]; then
    echo "USER_BACKUP_RESTORE_HELPER_SECRET must contain at least 32 characters." >&2
    return 1
  fi

  case "$user_backup_restore_helper_secret_value" in
    change*|replace*|secret*|your*)
      echo "USER_BACKUP_RESTORE_HELPER_SECRET still looks like a placeholder." >&2
      return 1
      ;;
  esac

  if [ "$user_backup_restore_helper_url_value" != "http://127.0.0.1:3012/internal/user-backup/restore" ]; then
    echo "USER_BACKUP_RESTORE_HELPER_URL must target the managed loopback restore helper." >&2
    return 1
  fi

  if [ -n "$user_backup_restore_helper_port_value" ] && [ "$user_backup_restore_helper_port_value" != "3012" ]; then
    echo "API_BACKUP_RESTORE_HELPER_PORT must be 3012 for the managed loopback helper." >&2
    return 1
  fi

  if [ "$user_backup_restore_database_url_value" = "$database_url_value" ]; then
    echo "USER_BACKUP_RESTORE_DATABASE_URL must not reuse the runtime DATABASE_URL." >&2
    return 1
  fi

  if ! validate_database_transport "$user_backup_restore_database_url_value"; then
    return 1
  fi

  if [ -n "$migrate_database_url_value" ] && ! validate_database_transport "$migrate_database_url_value"; then
    return 1
  fi

  if [ "$api_db_rls_mode_value" = "transaction_local" ] && [ "$effective_task_reminders_runtime_value" = "api" ]; then
    echo "API_TASK_REMINDERS_RUNTIME=api is not supported with strict transaction_local runtime DB role. Use worker or disabled." >&2
    return 1
  fi

  if [ "$effective_task_reminders_runtime_value" = "worker" ] && [ -z "$task_reminders_database_url_value" ] && [ -z "$worker_database_url_value" ]; then
    echo "TASK_REMINDERS_DATABASE_URL or WORKER_DATABASE_URL must be configured for the isolated reminders worker." >&2
    return 1
  fi

  effective_worker_database_url_value="\${task_reminders_database_url_value:-$worker_database_url_value}"
  if [ "$effective_task_reminders_runtime_value" = "worker" ] && ! validate_database_transport "$effective_worker_database_url_value"; then
    return 1
  fi
}

write_env_subset() {
  write_env_subset_from "$env_file" "$@"
}

write_env_subset_from() {
  source="$1"
  target="$2"
  shift 2
  next="\${target}.next"

  install -o root -g root -m 0600 /dev/null "$next"

  for key in "$@"; do
    if [ -f "$source" ]; then
      line="$(grep -E "^\${key}=" "$source" | tail -n 1 || true)"
    else
      line=""
    fi

    if [ -n "$line" ]; then
      printf '%s\n' "$line" >> "$next"
    fi
  done

  mv -f "$next" "$target"
}

install_legacy_runtime_compatibility() {
  source_release="$1"
  legacy_api_unit="$source_release/deploy/systemd/planner-api.service"

  if ! grep -Eq '^User=planner$' "$legacy_api_unit" || ! grep -Eq '^EnvironmentFile=/etc/planner/planner\\.env$' "$legacy_api_unit"; then
    return 0
  fi

  if ! id -u planner >/dev/null 2>&1; then
    echo "Legacy rollback requires the planner system user." >&2
    return 1
  fi

  # A rollback to the pre-isolation unit layout must restore only the legacy
  # permissions that those units require. The next forward deploy reapplies
  # the split root-owned env files and planner-backup ownership.
  chown root:planner "$env_file"
  chmod 0640 "$env_file"
  if [ -f "$backup_env_file" ]; then
    chown root:planner "$backup_env_file"
    chmod 0640 "$backup_env_file"
  fi
  chown -R planner:planner "$shared_state_dir" "$backups_dir"
  chmod 0700 "$shared_state_dir" "$backups_dir"
}

install_service_envs() {
  chmod 0711 /etc/planner
  chown root:root "$env_file"
  chmod 0600 "$env_file"

  firebase_service_account_path_value="$(read_env_value FIREBASE_SERVICE_ACCOUNT_PATH)"
  if [ -n "$firebase_service_account_path_value" ]; then
    chown root:planner-push "$firebase_service_account_path_value"
    chmod 0640 "$firebase_service_account_path_value"
  fi

  if [ -f "$backup_env_file" ]; then
    restic_password_file_value="$(read_env_file_value "$backup_env_file" RESTIC_PASSWORD_FILE)"
    if [ "$restic_password_file_value" = "/etc/planner/restic-password" ] && [ -f "$restic_password_file_value" ] && [ ! -L "$restic_password_file_value" ]; then
      chown root:planner-backup "$restic_password_file_value"
      chmod 0640 "$restic_password_file_value"
    fi
  fi

  write_env_subset /etc/planner/api.env \
    NODE_ENV \
    API_AUTH_MODE \
    API_STORAGE_DRIVER \
    API_DB_RLS_MODE \
    API_DB_WRITE_FALLBACK \
    API_DB_CONNECTION_TIMEOUT_MS \
    API_DB_QUERY_TIMEOUT_MS \
    API_DB_IDLE_TRANSACTION_TIMEOUT_MS \
    API_DB_STATEMENT_TIMEOUT_MS \
    API_TRUST_PROXY_HOPS \
    API_TASK_REMINDERS_RUNTIME \
    API_HOST \
    API_PORT \
    API_CORS_ORIGIN \
    API_ICON_ASSET_DIR \
    DATABASE_URL \
    AUTH_JWT_SECRET \
    AUTH_JWT_ISSUER \
    AUTH_JWT_AUDIENCE \
    AUTH_ACCESS_TOKEN_TTL_SECONDS \
    AUTH_REFRESH_TOKEN_TTL_SECONDS \
    AUTH_PASSWORD_RESET_TTL_SECONDS \
    AUTH_PUBLIC_APP_URL \
    AUTH_EMAIL_FROM \
    AUTH_SMTP_HOST \
    AUTH_SMTP_PORT \
    AUTH_SMTP_SECURE \
    AUTH_SMTP_USER \
    AUTH_SMTP_PASSWORD \
    ALICE_OAUTH_CLIENT_ID \
    ALICE_OAUTH_CLIENT_SECRET \
    ALICE_OAUTH_REDIRECT_URI \
    ALICE_OAUTH_CODE_TTL_SECONDS \
    ALICE_LLM_PROVIDER \
    ALICE_LLM_ENDPOINT \
    ALICE_LLM_MODEL \
    ALICE_LLM_API_KEY \
    ALICE_LLM_TIMEOUT_MS \
    ALICE_LLM_YANDEX_FOLDER_ID \
    VOICE_STT_YANDEX_API_KEY \
    VOICE_STT_YANDEX_ENDPOINT \
    VOICE_STT_YANDEX_FOLDER_ID \
    VOICE_STT_YANDEX_IAM_TOKEN \
    VOICE_STT_LANGUAGE \
    VOICE_STT_TIMEOUT_MS \
    YANDEX_API_KEY \
    YANDEX_FOLDER_ID \
    YANDEX_IAM_TOKEN \
    HAOTIKA_MCP_ENABLED \
    HAOTIKA_MCP_PUBLIC_BASE_URL \
    HAOTIKA_MCP_DEV_NO_AUTH \
    HAOTIKA_MCP_RATE_LIMIT_PER_MINUTE \
    HAOTIKA_OAUTH_ISSUER \
    HAOTIKA_OAUTH_ALLOWED_REDIRECT_URIS \
    HAOTIKA_DEFAULT_TIMEZONE \
    FIREBASE_SERVICE_ACCOUNT_JSON \
    FIREBASE_SERVICE_ACCOUNT_PATH \
    FIREBASE_PROJECT_ID \
    FIREBASE_CLIENT_EMAIL \
    FIREBASE_PRIVATE_KEY \
    USER_BACKUP_RESTORE_HELPER_URL \
    USER_BACKUP_RESTORE_HELPER_SECRET

  write_env_subset /etc/planner/reminders.env \
    NODE_ENV \
    TASK_REMINDERS_DATABASE_URL \
    WORKER_DATABASE_URL \
    API_DB_CONNECTION_TIMEOUT_MS \
    API_DB_QUERY_TIMEOUT_MS \
    API_DB_IDLE_TRANSACTION_TIMEOUT_MS \
    API_DB_STATEMENT_TIMEOUT_MS \
    TASK_REMINDERS_BATCH_SIZE \
    TASK_REMINDERS_INTERVAL_MS \
    SELF_CARE_REMINDERS_BATCH_SIZE \
    SELF_CARE_REMINDERS_INTERVAL_MS \
    FIREBASE_SERVICE_ACCOUNT_JSON \
    FIREBASE_SERVICE_ACCOUNT_PATH \
    FIREBASE_PROJECT_ID \
    FIREBASE_CLIENT_EMAIL \
    FIREBASE_PRIVATE_KEY

  write_env_subset /etc/planner/restore-helper.env \
    NODE_ENV \
    USER_BACKUP_RESTORE_DATABASE_URL \
    USER_BACKUP_RESTORE_HELPER_SECRET \
    API_BACKUP_RESTORE_HELPER_PORT \
    API_ICON_ASSET_DIR \
    API_DB_CONNECTION_TIMEOUT_MS \
    API_DB_QUERY_TIMEOUT_MS \
    API_DB_IDLE_TRANSACTION_TIMEOUT_MS \
    API_DB_STATEMENT_TIMEOUT_MS

  write_env_subset /etc/planner/backup-runtime.env \
    API_ICON_ASSET_DIR

  write_env_subset /etc/planner/backup-alert-runtime.env \
    AUTH_EMAIL_FROM \
    AUTH_SMTP_HOST \
    AUTH_SMTP_PORT \
    AUTH_SMTP_SECURE \
    AUTH_SMTP_USER \
    AUTH_SMTP_PASSWORD

  write_env_subset_from "$backup_env_file" /etc/planner/backup-job.env \
    RESTIC_REPOSITORY \
    RESTIC_PASSWORD \
    RESTIC_PASSWORD_FILE \
    AWS_ACCESS_KEY_ID \
    AWS_SECRET_ACCESS_KEY \
    AWS_SESSION_TOKEN \
    AWS_DEFAULT_REGION \
    BACKUP_DATABASE_URL \
    RESTIC_KEEP_DAILY \
    RESTIC_KEEP_WEEKLY \
    RESTIC_KEEP_MONTHLY \
    BACKUP_LOCAL_KEEP_DAYS \
    RESTORE_DRILL_ADMIN_DATABASE_URL

  write_env_subset_from "$backup_env_file" /etc/planner/backup-alert.env \
    BACKUP_ALERT_WEBHOOK_URL \
    BACKUP_ALERT_TELEGRAM_BOT_TOKEN \
    BACKUP_ALERT_TELEGRAM_CHAT_ID \
    BACKUP_ALERT_EMAIL_TO
}

atomic_switch() {
  target="$1"
  next_link="$remote_root/.current.next.$$"

  rm -f "$next_link"
  ln -s "$target" "$next_link"
  mv -Tf "$next_link" "$current_link"
}

install_runtime_configs() {
  source_release="$1"
  release_commit="\${source_release##*/}"
  restore_helper_available=0
  backup_units=(
    planner-backup-alert@.service
    planner-backup.service
    planner-backup.timer
    planner-backup-prune.service
    planner-backup-prune.timer
    planner-restore-drill.service
    planner-restore-drill.timer
  )

  test -f "$source_release/deploy/systemd/planner-api.service"
  test -f "$source_release/deploy/systemd/planner-task-reminders.service"
  test -f "$source_release/deploy/caddy/Caddyfile"
  install_service_envs

  if [ "\${#release_commit}" -ne 40 ] || printf '%s' "$release_commit" | grep -Eq '[^0-9a-f]'; then
    echo "Cannot derive a Git commit from release path: $source_release" >&2
    return 1
  fi

  printf 'PLANNER_APP_COMMIT=%s\n' "$release_commit" > /etc/planner/release.env.next
  chown root:root /etc/planner/release.env.next
  chmod 0644 /etc/planner/release.env.next

  install -o root -g root -m 0644 \
    "$source_release/deploy/systemd/planner-api.service" \
    /etc/systemd/system/planner-api.service.next
  install -o root -g root -m 0644 \
    "$source_release/deploy/systemd/planner-task-reminders.service" \
    /etc/systemd/system/planner-task-reminders.service.next
  if [ -f "$source_release/deploy/systemd/planner-user-backup-restore.service" ]; then
    restore_helper_available=1
    install -o root -g root -m 0644 \
      "$source_release/deploy/systemd/planner-user-backup-restore.service" \
      /etc/systemd/system/planner-user-backup-restore.service.next
  fi
  install -o root -g root -m 0644 \
    "$source_release/deploy/caddy/Caddyfile" \
    /etc/caddy/Caddyfile.next

  mv -f /etc/systemd/system/planner-api.service.next /etc/systemd/system/planner-api.service
  mv -f /etc/systemd/system/planner-task-reminders.service.next /etc/systemd/system/planner-task-reminders.service
  if [ "$restore_helper_available" = "1" ]; then
    mv -f \
      /etc/systemd/system/planner-user-backup-restore.service.next \
      /etc/systemd/system/planner-user-backup-restore.service
  else
    systemctl disable --now planner-user-backup-restore.service || true
    rm -f \
      /etc/systemd/system/planner-user-backup-restore.service \
      /etc/systemd/system/planner-user-backup-restore.service.next
  fi
  mv -f /etc/caddy/Caddyfile.next /etc/caddy/Caddyfile
  mv -f /etc/planner/release.env.next /etc/planner/release.env

  backup_units_available=1
  for unit in "\${backup_units[@]}"; do
    if [ ! -f "$source_release/deploy/systemd/$unit" ]; then
      backup_units_available=0
      break
    fi
  done

  if [ "$backup_units_available" = "1" ]; then
    for unit in "\${backup_units[@]}"; do
      install -o root -g root -m 0644 \
        "$source_release/deploy/systemd/$unit" \
        "/etc/systemd/system/$unit.next"
      mv -f "/etc/systemd/system/$unit.next" "/etc/systemd/system/$unit"
    done
  else
    systemctl disable --now \
      planner-backup.timer \
      planner-backup-prune.timer \
      planner-restore-drill.timer || true
    for unit in "\${backup_units[@]}"; do
      rm -f "/etc/systemd/system/$unit" "/etc/systemd/system/$unit.next"
    done
  fi

  install_legacy_runtime_compatibility "$source_release"
}

apply_restore_helper_state() {
  if [ "$restore_helper_available" = "1" ]; then
    systemctl enable planner-user-backup-restore.service
    systemctl restart planner-user-backup-restore.service
    wait_for_url http://127.0.0.1:3012/internal/ready
  else
    systemctl disable --now planner-user-backup-restore.service || true
  fi
}

apply_worker_state() {
  if [ "$TASK_REMINDERS_RUNTIME_VALUE" = "worker" ]; then
    systemctl enable planner-task-reminders
    systemctl restart planner-task-reminders
    systemctl is-active --quiet planner-task-reminders
  else
    systemctl stop planner-task-reminders || true
    systemctl disable planner-task-reminders || true
    systemctl reset-failed planner-task-reminders || true
  fi
}

apply_backup_state() {
  if [ "$backup_units_available" != "1" ]; then
    systemctl disable --now \
      planner-backup.timer \
      planner-backup-prune.timer \
      planner-restore-drill.timer || true
    return
  fi

  if [ "$BACKUP_AUTOMATION_ENABLED_VALUE" = "1" ]; then
    systemctl enable --now planner-backup.timer planner-backup-prune.timer
  else
    systemctl disable --now planner-backup.timer planner-backup-prune.timer || true
  fi

  if [ "$RESTORE_DRILL_AUTOMATION_ENABLED_VALUE" = "1" ]; then
    systemctl enable --now planner-restore-drill.timer
  else
    systemctl disable --now planner-restore-drill.timer || true
  fi
}

reload_caddy() {
  caddy fmt --overwrite /etc/caddy/Caddyfile &&
    caddy validate --config /etc/caddy/Caddyfile &&
    systemctl reload caddy
}

rollback_release() {
  exit_code="$1"
  trap - ERR
  set +e

  if [ "$switched" = "1" ]; then
    echo "Release failed after activation; rolling back to $previous_release." >&2
    rm -f "$release_dir/.deploy-complete"

    if [ -n "$previous_release" ] && [ -d "$previous_release" ]; then
      rollback_failed=0
      atomic_switch "$previous_release" || rollback_failed=1
      install_runtime_configs "$previous_release" || rollback_failed=1
      systemctl daemon-reload || rollback_failed=1
      apply_restore_helper_state || rollback_failed=1
      systemctl restart planner-api || rollback_failed=1
      apply_worker_state || rollback_failed=1
      apply_backup_state || rollback_failed=1
      reload_caddy || rollback_failed=1
      wait_for_url ${shellQuote(`http://127.0.0.1:3001${config.healthPath}`)} || rollback_failed=1

      if [ "$rollback_failed" = "0" ]; then
        echo "Application release rolled back to $previous_release." >&2
      else
        echo "Automatic rollback was attempted but did not restore every runtime component." >&2
      fi
    else
      echo "No valid previous release is available for automatic rollback." >&2
    fi
  fi

  exit "$exit_code"
}

prune_releases() {
  current_release="$(readlink -f "$current_link")"
  kept=0

  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue

    if [ "$candidate" = "$current_release" ] || [ "$candidate" = "$previous_release" ]; then
      kept=$((kept + 1))
      continue
    fi

    if [ "$kept" -lt "$release_retention" ]; then
      kept=$((kept + 1))
      continue
    fi

    rm -rf -- "$candidate"
  done < <(
    find "$releases_root" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
      | sort -nr \
      | cut -d' ' -f2-
  )
}

trap 'rollback_release $?' ERR

cd "$release_dir"

validate_production_env

mkdir -p \
  "$build_cache_dir" \
  "$shared_state_dir/tmp" \
  "$shared_state_dir/restic-cache" \
  "$backups_dir/infrastructure"
rm -rf "$release_dir/tmp"
ln -s "$shared_state_dir/tmp" "$release_dir/tmp"
chown -R planner-build:planner-build "$release_dir"
chown -R planner-build:planner-build "$build_cache_dir"
chown -R planner-backup:planner-backup "$shared_state_dir" "$backups_dir"
chown -R root:planner-assets ${shellQuote(config.iconRemoteDirectory)}
find ${shellQuote(config.iconRemoteDirectory)} -type d -exec chmod 2770 {} +
find ${shellQuote(config.iconRemoteDirectory)} -type f -exec chmod 0660 {} +
chmod 0700 "$shared_state_dir" "$backups_dir"
chmod 0700 "$build_cache_dir"
chmod 711 "$remote_root" ${shellQuote(layout.sharedRoot)}

runuser -u planner-build -- env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/nonexistent \
  npm_config_cache="$build_cache_dir" \
  HUSKY=0 \
  npm run toolchain:check
runuser -u planner-build -- env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/nonexistent \
  npm_config_cache="$build_cache_dir" \
  HUSKY=0 \
  npm ci --include=dev --ignore-scripts
runuser -u planner-build -- env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/nonexistent \
  npm_config_cache="$build_cache_dir" \
  HUSKY=0 \
  npm rebuild @firebase/util protobufjs esbuild

WEB_AUTH_PROVIDER="$(read_env_value WEB_AUTH_PROVIDER)"
if [ -z "$WEB_AUTH_PROVIDER" ]; then
  if [ "$api_auth_mode_value" = "jwt" ]; then
    WEB_AUTH_PROVIDER="planner"
  else
    WEB_AUTH_PROVIDER="disabled"
  fi
fi

runuser -u planner-build -- env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/nonexistent \
  npm_config_cache="$build_cache_dir" \
  VITE_API_BASE_URL=${shellQuote(`https://${config.domain}`)} \
  VITE_AUTH_PROVIDER="$WEB_AUTH_PROVIDER" \
  npm run build
test -f "$release_dir/apps/api/dist/server.js"
test -f "$release_dir/apps/api/dist/task-reminders.js"
test -f "$release_dir/apps/api/dist/user-backup-restore.js"
runuser -u planner-build -- env -i \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/nonexistent \
  npm_config_cache="$build_cache_dir" \
  HUSKY=0 \
  npm prune --omit=dev --ignore-scripts
test ! -e "$release_dir/node_modules/tsx"
test ! -e "$release_dir/node_modules/typescript"
test ! -e "$release_dir/node_modules/vite"
chown -R root:root "$release_dir"
chmod -R u=rwX,go=rX "$release_dir"
caddy validate --config "$release_dir/deploy/caddy/Caddyfile"

DATABASE_URL_VALUE="$(require_env_value DATABASE_URL)"
MIGRATE_DATABASE_URL_VALUE="$(read_env_value MIGRATE_DATABASE_URL)"
USER_BACKUP_RESTORE_DATABASE_URL_VALUE="$(require_env_value USER_BACKUP_RESTORE_DATABASE_URL)"
if [ -z "$MIGRATE_DATABASE_URL_VALUE" ]; then
  MIGRATE_DATABASE_URL_VALUE="$DATABASE_URL_VALUE"
fi

if [ "${skipDbBackup ? '1' : '0'}" != "1" ]; then
  DB_DEPLOY_BACKUP_KEEP_VALUE="$(read_env_value DB_DEPLOY_BACKUP_KEEP)"
  runuser -u planner-backup -- \
    flock -w 300 "$shared_state_dir/backup.lock" \
    env -i \
      PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
      HOME=/nonexistent \
      MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE" \
      DB_BACKUP_DIR="$backups_dir" \
      DB_DEPLOY_BACKUP_KEEP="$DB_DEPLOY_BACKUP_KEEP_VALUE" \
      node scripts/db-backup.mjs
fi

DB_MIGRATE_MODE_VALUE="$(read_env_value DB_MIGRATE_MODE)"
MIGRATE_ENV=(MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE")
if [ -n "$DB_MIGRATE_MODE_VALUE" ]; then
  MIGRATE_ENV+=(DB_MIGRATE_MODE="$DB_MIGRATE_MODE_VALUE")
fi

runuser -u planner-migrate -- env -i \\
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \\
  HOME=/nonexistent \\
  "\${MIGRATE_ENV[@]}" \\
  node scripts/db-migrate.mjs
runuser -u planner-migrate -- env -i \\
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \\
  HOME=/nonexistent \\
  MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE" \\
  node scripts/db-security-repair.mjs

SECURITY_ENV=(DATABASE_URL="$DATABASE_URL_VALUE" NODE_ENV="$node_env_value" API_DB_RLS_MODE="$api_db_rls_mode_value")
if [ "$api_db_rls_mode_value" = "transaction_local" ]; then
  SECURITY_ENV+=(DB_SECURITY_REQUIRE_NON_OWNER=1)
fi

runuser -u planner-migrate -- env -i \\
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \\
  HOME=/nonexistent \\
  "\${SECURITY_ENV[@]}" \\
  node scripts/db-security-check.mjs
runuser -u planner-migrate -- env -i \\
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \\
  HOME=/nonexistent \\
  USER_BACKUP_RESTORE_DATABASE_URL="$USER_BACKUP_RESTORE_DATABASE_URL_VALUE" \\
  node scripts/check-user-backup-restore-database.mjs

BACKUP_AUTOMATION_ENABLED_VALUE="$(read_env_value BACKUP_AUTOMATION_ENABLED)"
if [ "$BACKUP_AUTOMATION_ENABLED_VALUE" = "1" ]; then
  BACKUP_DATABASE_URL_VALUE="$(read_env_file_value "$backup_env_file" BACKUP_DATABASE_URL)"
  runuser -u planner-migrate -- env -i \\
    PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \\
    HOME=/nonexistent \\
    MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE" \\
    BACKUP_DATABASE_URL="$BACKUP_DATABASE_URL_VALUE" \\
    node scripts/check-backup-database.mjs
fi

previous_release="$(readlink -f "$current_link" 2>/dev/null || true)"
if [ -n "$previous_release" ] && [ ! -d "$previous_release" ]; then
  echo "Current release target is not a directory: $previous_release" >&2
  exit 1
fi

TASK_REMINDERS_RUNTIME_VALUE="$(read_env_value API_TASK_REMINDERS_RUNTIME)"
if [ -z "$TASK_REMINDERS_RUNTIME_VALUE" ]; then
  TASK_REMINDERS_RUNTIME_VALUE="api"
fi
RESTORE_DRILL_AUTOMATION_ENABLED_VALUE="$(read_env_value RESTORE_DRILL_AUTOMATION_ENABLED)"

atomic_switch "$release_dir"
switched=1
install_runtime_configs "$release_dir"
systemctl daemon-reload
apply_restore_helper_state
systemctl restart planner-api
wait_for_url ${shellQuote(`http://127.0.0.1:3001${config.healthPath}`)}
runuser -u planner-migrate -- env -i \\
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \\
  HOME=/nonexistent \\
  SMOKE_CLEANUP_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE" \\
  SMOKE_API_BASE_URL=http://127.0.0.1:3001 \\
  SMOKE_CLEANUP_DATABASE=1 \\
  node scripts/api-prod-smoke.mjs

apply_worker_state
apply_backup_state
reload_caddy
wait_for_url ${shellQuote(`https://${config.domain}${config.healthPath}`)}
wait_for_url ${shellQuote(`https://${config.domain}/`)}

touch "$release_dir/.deploy-complete"
chown root:root "$release_dir/.deploy-complete"
chmod 0444 "$release_dir/.deploy-complete"
switched=0
trap - ERR
prune_releases || echo "Release retention cleanup failed; continuing with the healthy release." >&2
`
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

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
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
