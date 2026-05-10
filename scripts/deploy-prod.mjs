import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import process from 'node:process'

const DEFAULTS = {
  domain: 'chaotika.ru',
  healthPath: '/api/health',
  iconLocalDirectory: 'apps/api/tmp/icon-assets',
  iconRemoteDirectory: '/var/lib/planner/icon-assets',
  remoteHost: 'root@147.45.158.186',
  remoteRoot: '/opt/planner',
}

const args = new Set(process.argv.slice(2))

if (args.has('--help') || args.has('-h')) {
  printHelp()
  process.exit(0)
}

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
}

const dryRun = args.has('--dry-run')
const skipChecks =
  args.has('--skip-checks') || process.env.DEPLOY_SKIP_CHECKS === '1'
const skipDbBackup =
  args.has('--skip-db-backup') || process.env.DEPLOY_SKIP_DB_BACKUP === '1'
const skipIcons =
  args.has('--skip-icons') || process.env.DEPLOY_SKIP_ICONS === '1'

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

async function main() {
  printHeader()
  await warnAboutDirtyWorktree()

  if (skipChecks) {
    console.log('[deploy] Skipping local checks.')
  } else {
    await run('npm', ['run', 'ci'])
  }

  if (dryRun) {
    console.log('[deploy] Dry run: remote directory preparation skipped.')
  } else {
    await ensureRemoteDirectories()
  }
  await syncProject()
  await syncIconAssets()

  if (dryRun) {
    console.log('[deploy] Dry run complete. Remote build/restart skipped.')
    return
  }

  await runRemoteRelease()
  console.log(`[deploy] Production is healthy: https://${config.domain}`)
}

function printHeader() {
  console.log(
    [
      '[deploy] Production deploy',
      `  domain: ${config.domain}`,
      `  host:   ${config.remoteHost}`,
      `  root:   ${config.remoteRoot}`,
      `  icons:  ${config.iconRemoteDirectory}`,
    ].join('\n'),
  )
}

function printHelp() {
  console.log(`
Usage:
  npm run deploy:prod

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
`)
}

async function warnAboutDirtyWorktree() {
  const status = await collect('git', ['status', '--short'])

  if (!status.trim()) {
    return
  }

  console.warn(
    [
      '[deploy] Warning: working tree has uncommitted changes.',
      '[deploy] The current local files will be deployed:',
      status.trim(),
    ].join('\n'),
  )
}

async function ensureRemoteDirectories() {
  const remoteScript = `
set -euo pipefail
mkdir -p ${shellQuote(config.remoteRoot)} ${shellQuote(config.iconRemoteDirectory)}
chown -R planner:planner ${shellQuote(config.remoteRoot)} ${shellQuote(config.iconRemoteDirectory)}
`

  await runWithInput('ssh', [config.remoteHost, 'bash', '-se'], remoteScript)
}

async function syncProject() {
  const rsyncArgs = [
    '-az',
    '--delete',
    '--exclude',
    'node_modules',
    '--exclude',
    '.git',
    '--exclude',
    'apps/web/dist',
    '--exclude',
    'coverage',
    '--exclude',
    'tmp',
    '--exclude',
    '.env',
    '--exclude',
    '.env.local',
    '--exclude',
    '.env.*.local',
    '--exclude',
    'apps/api/.env',
    '--exclude',
    'apps/api/.env.local',
    '--exclude',
    '*.tsbuildinfo',
    './',
    `${config.remoteHost}:${config.remoteRoot}/`,
  ]

  if (dryRun) {
    rsyncArgs.unshift('--dry-run')
  }

  await run('rsync', rsyncArgs)
}

async function syncIconAssets() {
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

  await run('rsync', rsyncArgs)
}

async function runRemoteRelease() {
  const remoteScript = `
set -euo pipefail

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

env_file="/etc/planner/planner.env"

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
}

cd ${shellQuote(config.remoteRoot)}

validate_production_env

chown -R planner:planner ${shellQuote(config.remoteRoot)} ${shellQuote(config.iconRemoteDirectory)}

runuser -u planner -- env HUSKY=0 npm ci --include=dev --ignore-scripts
runuser -u planner -- env HUSKY=0 npm rebuild @firebase/util protobufjs esbuild

DATABASE_URL_VALUE="$(require_env_value DATABASE_URL)"
if [ "${skipDbBackup ? '1' : '0'}" != "1" ]; then
  runuser -u planner -- env HUSKY=0 DATABASE_URL="$DATABASE_URL_VALUE" DB_BACKUP_DIR=${shellQuote(`${config.remoteRoot}/backups`)} npm run db:backup
fi

DB_MIGRATE_MODE_VALUE="$(read_env_value DB_MIGRATE_MODE)"
MIGRATE_ENV=(HUSKY=0 DATABASE_URL="$DATABASE_URL_VALUE")
if [ -n "$DB_MIGRATE_MODE_VALUE" ]; then
  MIGRATE_ENV+=(DB_MIGRATE_MODE="$DB_MIGRATE_MODE_VALUE")
fi

runuser -u planner -- env "\${MIGRATE_ENV[@]}" npm run db:migrate
runuser -u planner -- env \\
  HUSKY=0 \\
  DATABASE_URL="$DATABASE_URL_VALUE" \\
  NODE_ENV="$node_env_value" \\
  API_DB_RLS_MODE="$api_db_rls_mode_value" \\
  npm run db:security:check

WEB_AUTH_PROVIDER="$(grep '^WEB_AUTH_PROVIDER=' /etc/planner/planner.env | cut -d= -f2- || true)"
if [ -z "$WEB_AUTH_PROVIDER" ]; then
  API_AUTH_MODE_VALUE="$(grep '^API_AUTH_MODE=' /etc/planner/planner.env | cut -d= -f2- || true)"
  if [ "$API_AUTH_MODE_VALUE" = "jwt" ]; then
    WEB_AUTH_PROVIDER="planner"
  else
    WEB_AUTH_PROVIDER="disabled"
  fi
fi

runuser -u planner -- env \\
  VITE_API_BASE_URL=${shellQuote(`https://${config.domain}`)} \\
  VITE_AUTH_PROVIDER="$WEB_AUTH_PROVIDER" \\
  npm run build

cp ${shellQuote(`${config.remoteRoot}/deploy/systemd/planner-api.service`)} /etc/systemd/system/planner-api.service
cp ${shellQuote(`${config.remoteRoot}/deploy/systemd/planner-task-reminders.service`)} /etc/systemd/system/planner-task-reminders.service
cp ${shellQuote(`${config.remoteRoot}/deploy/caddy/Caddyfile`)} /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl restart planner-api
wait_for_url ${shellQuote(`http://127.0.0.1:3001${config.healthPath}`)}
runuser -u planner -- env \\
  HUSKY=0 \\
  DATABASE_URL="$DATABASE_URL_VALUE" \\
  SMOKE_API_BASE_URL=http://127.0.0.1:3001 \\
  SMOKE_CLEANUP_DATABASE=1 \\
  npm run smoke:api:prod

TASK_REMINDERS_RUNTIME_VALUE="$(read_env_value API_TASK_REMINDERS_RUNTIME)"
if [ -z "$TASK_REMINDERS_RUNTIME_VALUE" ]; then
  TASK_REMINDERS_RUNTIME_VALUE="api"
fi

if [ "$TASK_REMINDERS_RUNTIME_VALUE" = "worker" ]; then
  systemctl enable planner-task-reminders
  systemctl restart planner-task-reminders
  systemctl is-active --quiet planner-task-reminders
else
  systemctl stop planner-task-reminders || true
  systemctl disable planner-task-reminders || true
  systemctl reset-failed planner-task-reminders || true
fi

caddy fmt --overwrite /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
wait_for_url ${shellQuote(`https://${config.domain}${config.healthPath}`)}
`

  await runWithInput('ssh', [config.remoteHost, 'bash', '-se'], remoteScript)
}

function readEnv(name, fallback) {
  const value = process.env[name]

  return value && value.trim().length > 0 ? value : fallback
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

async function run(command, args) {
  const resolvedCommand = resolveCommand(command)
  console.log(`[deploy] ${command} ${args.join(' ')}`)

  await new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
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

async function runWithInput(command, args, input) {
  const resolvedCommand = resolveCommand(command)
  console.log(`[deploy] ${command} ${args.join(' ')}`)

  await new Promise((resolve, reject) => {
    const child = spawn(resolvedCommand, args, {
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
