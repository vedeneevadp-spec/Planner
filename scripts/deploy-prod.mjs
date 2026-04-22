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
    await run('npm', ['run', 'check'])
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
  --skip-checks  Do not run npm run check before deploy.
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

cd ${shellQuote(config.remoteRoot)}

chown -R planner:planner ${shellQuote(config.remoteRoot)} ${shellQuote(config.iconRemoteDirectory)}

runuser -u planner -- env HUSKY=0 npm ci --include=dev

runuser -u planner -- env \\
  VITE_API_BASE_URL=${shellQuote(`https://${config.domain}`)} \\
  VITE_SUPABASE_URL="$(grep '^SUPABASE_URL=' /etc/planner/planner.env | cut -d= -f2-)" \\
  VITE_SUPABASE_PUBLISHABLE_KEY="$(grep '^SUPABASE_PUBLISHABLE_KEY=' /etc/planner/planner.env | cut -d= -f2-)" \\
  npm run build

cp ${shellQuote(`${config.remoteRoot}/deploy/systemd/planner-api.service`)} /etc/systemd/system/planner-api.service
cp ${shellQuote(`${config.remoteRoot}/deploy/caddy/Caddyfile`)} /etc/caddy/Caddyfile

systemctl daemon-reload
systemctl restart planner-api
wait_for_url ${shellQuote(`http://127.0.0.1:3001${config.healthPath}`)}
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
