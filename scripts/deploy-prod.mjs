import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  createProjectSyncFilter,
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
  A non-blocking remote flock covers preparation, rsync, build, migrations,
  activation, healthchecks, and release retention. A concurrent deploy exits
  immediately instead of waiting for the active deploy.

Options:
  --skip-checks  Do not run npm run ci before deploy.
  --skip-db-backup
                 Do not run pg_dump before production migrations.
  --skip-icons   Do not copy local uploaded icon assets.
  --dry-run      Run checks and rsync dry-run, but do not build/restart remote services.

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

mkdir -p \
  ${shellQuote(layout.releasesRoot)} \
  ${shellQuote(layout.backupsDirectory)} \
  ${shellQuote(layout.stateDirectory)} \
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
chown -R planner:planner \
  "$release_dir" \
  ${shellQuote(layout.sharedRoot)} \
  ${shellQuote(config.iconRemoteDirectory)}
chmod 711 "$remote_root" ${shellQuote(layout.sharedRoot)}
`
}

async function ensureRemoteDirectories(layout, signal) {
  await runWithInput(
    'ssh',
    [config.remoteHost, 'bash', '-se'],
    createRemotePreparationScript(layout),
    { signal },
  )
}

async function syncProject(layout, signal) {
  const trackedFiles = await collectTrackedProjectFiles()
  const filterDirectory = await mkdtemp(path.join(tmpdir(), 'planner-deploy-'))
  const filterPath = path.join(filterDirectory, 'rsync-filter')
  const remoteDirectory = dryRun
    ? `${layout.remoteRoot}/.deploy-dry-run-${layout.releaseId}`
    : layout.releaseDirectory

  try {
    await writeFile(filterPath, createProjectSyncFilter(trackedFiles), 'utf8')

    const rsyncArgs = [
      '-az',
      '--delete',
      '--delete-excluded',
      '--filter',
      `merge ${filterPath}`,
      './',
      `${config.remoteHost}:${remoteDirectory}/`,
    ]

    if (dryRun) {
      rsyncArgs.unshift('--dry-run')
    }

    await run('rsync', rsyncArgs, { signal })
  } finally {
    await rm(filterDirectory, { force: true, recursive: true })
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
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'ConnectTimeout=10',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=2',
      config.remoteHost,
      remoteCommand,
    ],
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
backups_dir=${shellQuote(layout.backupsDirectory)}
release_retention=${config.releaseRetention}
env_file="/etc/planner/planner.env"
previous_release=""
switched=0

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

require_env_value() {
  key="$1"
  value="$(read_env_value "$key")"

  if [ -z "$value" ]; then
    echo "Missing required production env value: $key" >&2
    return 1
  fi

  printf '%s' "$value"
}

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
  auth_jwt_secret_value="$(require_env_value AUTH_JWT_SECRET)"
  database_url_value="$(require_env_value DATABASE_URL)"
  migrate_database_url_value="$(read_env_value MIGRATE_DATABASE_URL)"
  task_reminders_database_url_value="$(read_env_value TASK_REMINDERS_DATABASE_URL)"
  worker_database_url_value="$(read_env_value WORKER_DATABASE_URL)"
  effective_task_reminders_runtime_value="\${api_task_reminders_runtime_value:-api}"

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

  if [ "$api_db_rls_mode_value" = "transaction_local" ] && [ -z "$migrate_database_url_value" ]; then
    echo "MIGRATE_DATABASE_URL must be configured when production uses API_DB_RLS_MODE=transaction_local." >&2
    return 1
  fi

  if [ "$api_db_rls_mode_value" = "transaction_local" ] && [ "$effective_task_reminders_runtime_value" = "api" ]; then
    echo "API_TASK_REMINDERS_RUNTIME=api is not supported with strict transaction_local runtime DB role. Use worker or disabled." >&2
    return 1
  fi

  if [ "$api_db_rls_mode_value" = "transaction_local" ] && [ "$effective_task_reminders_runtime_value" = "worker" ] && [ -z "$task_reminders_database_url_value" ] && [ -z "$worker_database_url_value" ]; then
    echo "TASK_REMINDERS_DATABASE_URL or WORKER_DATABASE_URL must be configured when task reminders worker runs with strict transaction_local API runtime." >&2
    return 1
  fi
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

  test -f "$source_release/deploy/systemd/planner-api.service"
  test -f "$source_release/deploy/systemd/planner-task-reminders.service"
  test -f "$source_release/deploy/caddy/Caddyfile"

  install -o root -g root -m 0644 \
    "$source_release/deploy/systemd/planner-api.service" \
    /etc/systemd/system/planner-api.service.next
  install -o root -g root -m 0644 \
    "$source_release/deploy/systemd/planner-task-reminders.service" \
    /etc/systemd/system/planner-task-reminders.service.next
  install -o root -g root -m 0644 \
    "$source_release/deploy/caddy/Caddyfile" \
    /etc/caddy/Caddyfile.next

  mv -f /etc/systemd/system/planner-api.service.next /etc/systemd/system/planner-api.service
  mv -f /etc/systemd/system/planner-task-reminders.service.next /etc/systemd/system/planner-task-reminders.service
  mv -f /etc/caddy/Caddyfile.next /etc/caddy/Caddyfile
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
      systemctl restart planner-api || rollback_failed=1
      apply_worker_state || rollback_failed=1
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

mkdir -p "$shared_state_dir/tmp"
rm -rf "$release_dir/tmp"
ln -s "$shared_state_dir/tmp" "$release_dir/tmp"
chown -R planner:planner "$release_dir" "$shared_state_dir" ${shellQuote(config.iconRemoteDirectory)}
chmod 711 "$remote_root" ${shellQuote(layout.sharedRoot)}

runuser -u planner -- env HUSKY=0 npm ci --include=dev --ignore-scripts
runuser -u planner -- env HUSKY=0 npm rebuild @firebase/util protobufjs esbuild

WEB_AUTH_PROVIDER="$(read_env_value WEB_AUTH_PROVIDER)"
if [ -z "$WEB_AUTH_PROVIDER" ]; then
  if [ "$api_auth_mode_value" = "jwt" ]; then
    WEB_AUTH_PROVIDER="planner"
  else
    WEB_AUTH_PROVIDER="disabled"
  fi
fi

runuser -u planner -- env \
  VITE_API_BASE_URL=${shellQuote(`https://${config.domain}`)} \
  VITE_AUTH_PROVIDER="$WEB_AUTH_PROVIDER" \
  npm run build
caddy validate --config "$release_dir/deploy/caddy/Caddyfile"

DATABASE_URL_VALUE="$(require_env_value DATABASE_URL)"
MIGRATE_DATABASE_URL_VALUE="$(read_env_value MIGRATE_DATABASE_URL)"
if [ -z "$MIGRATE_DATABASE_URL_VALUE" ]; then
  MIGRATE_DATABASE_URL_VALUE="$DATABASE_URL_VALUE"
fi

if [ "${skipDbBackup ? '1' : '0'}" != "1" ]; then
  runuser -u planner -- env HUSKY=0 MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE" DB_BACKUP_DIR="$backups_dir" npm run db:backup
fi

DB_MIGRATE_MODE_VALUE="$(read_env_value DB_MIGRATE_MODE)"
MIGRATE_ENV=(HUSKY=0 MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE")
if [ -n "$DB_MIGRATE_MODE_VALUE" ]; then
  MIGRATE_ENV+=(DB_MIGRATE_MODE="$DB_MIGRATE_MODE_VALUE")
fi

runuser -u planner -- env "\${MIGRATE_ENV[@]}" npm run db:migrate
runuser -u planner -- env \\
  HUSKY=0 \\
  MIGRATE_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE" \\
  npm run db:security:repair

SECURITY_ENV=(HUSKY=0 DATABASE_URL="$DATABASE_URL_VALUE" NODE_ENV="$node_env_value" API_DB_RLS_MODE="$api_db_rls_mode_value")
if [ "$api_db_rls_mode_value" = "transaction_local" ]; then
  SECURITY_ENV+=(DB_SECURITY_REQUIRE_NON_OWNER=1)
fi

runuser -u planner -- env \\
  "\${SECURITY_ENV[@]}" \\
  npm run db:security:check

previous_release="$(readlink -f "$current_link" 2>/dev/null || true)"
if [ -n "$previous_release" ] && [ ! -d "$previous_release" ]; then
  echo "Current release target is not a directory: $previous_release" >&2
  exit 1
fi

TASK_REMINDERS_RUNTIME_VALUE="$(read_env_value API_TASK_REMINDERS_RUNTIME)"
if [ -z "$TASK_REMINDERS_RUNTIME_VALUE" ]; then
  TASK_REMINDERS_RUNTIME_VALUE="api"
fi

atomic_switch "$release_dir"
switched=1
install_runtime_configs "$release_dir"
systemctl daemon-reload
systemctl restart planner-api
wait_for_url ${shellQuote(`http://127.0.0.1:3001${config.healthPath}`)}
runuser -u planner -- env \\
  HUSKY=0 \\
  SMOKE_CLEANUP_DATABASE_URL="$MIGRATE_DATABASE_URL_VALUE" \\
  SMOKE_API_BASE_URL=http://127.0.0.1:3001 \\
  SMOKE_CLEANUP_DATABASE=1 \\
  npm run smoke:api:prod

apply_worker_state
reload_caddy
wait_for_url ${shellQuote(`https://${config.domain}${config.healthPath}`)}
wait_for_url ${shellQuote(`https://${config.domain}/`)}

touch "$release_dir/.deploy-complete"
chown planner:planner "$release_dir/.deploy-complete"
switched=0
trap - ERR
prune_releases || echo "Release retention cleanup failed; continuing with the healthy release." >&2
`
}

async function runRemoteRelease(layout, signal) {
  await runWithInput(
    'ssh',
    [config.remoteHost, 'bash', '-se'],
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

async function collectTrackedProjectFiles() {
  const output = await collect('git', ['ls-files', '-z'])
  const files = output
    .split('\0')
    .filter(Boolean)
    .filter((file) => existsSync(file))
    .sort()

  if (files.length === 0) {
    throw new Error('No tracked project files found for deploy sync.')
  }

  return files
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
