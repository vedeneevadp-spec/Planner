const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/
const RSYNC_FILTER_PATTERN_METACHARACTERS = new Set(['\\', '*', '?', '[', ']'])

export function createReleaseLayout(remoteRoot, commit) {
  const normalizedRoot = normalizeRemoteRoot(remoteRoot)
  const normalizedCommit = String(commit).trim().toLowerCase()

  if (!FULL_COMMIT_PATTERN.test(normalizedCommit)) {
    throw new Error(`Unexpected deploy commit: ${commit}`)
  }

  const releasesRoot = `${normalizedRoot}/releases`
  const sharedRoot = `${normalizedRoot}/shared`

  return {
    backupsDirectory: `${sharedRoot}/backups`,
    currentLink: `${normalizedRoot}/current`,
    lockFile: `${normalizedRoot}/.deploy.lock`,
    releaseDirectory: `${releasesRoot}/${normalizedCommit}`,
    releaseId: normalizedCommit,
    releasesRoot,
    remoteRoot: normalizedRoot,
    sharedRoot,
    stateDirectory: `${sharedRoot}/state`,
  }
}

export function parseReleaseRetention(value) {
  const retention = Number(value)

  if (!Number.isSafeInteger(retention) || retention < 2 || retention > 20) {
    throw new Error('DEPLOY_RELEASE_RETENTION must be an integer from 2 to 20.')
  }

  return retention
}

export function createProjectSyncFilter(files) {
  const rules = new Set([
    'P /.git/***',
    'P /.env',
    'P /.env.local',
    'P /.env.*.local',
    'P /apps/api/.env',
    'P /apps/api/.env.local',
    'P /node_modules/***',
    'P /apps/api/node_modules/***',
    'P /apps/web/node_modules/***',
    'P /packages/contracts/node_modules/***',
  ])

  for (const file of files) {
    const normalizedFile = normalizeGitPath(file)
    const segments = normalizedFile.split('/')
    let directory = ''

    for (const segment of segments.slice(0, -1)) {
      directory += `${segment}/`
      rules.add(`+ /${escapeRsyncFilterPath(directory)}`)
    }

    rules.add(`+ /${escapeRsyncFilterPath(normalizedFile)}`)
  }

  return [...rules].sort().concat('- /***', '').join('\n')
}

function normalizeRemoteRoot(remoteRoot) {
  const value = String(remoteRoot).trim().replace(/\/+$/, '')

  if (!value.startsWith('/') || value === '' || value === '/') {
    throw new Error(
      `DEPLOY_REMOTE_ROOT must be an absolute non-root path: ${remoteRoot}`,
    )
  }

  if (value.includes('\n') || value.includes('\r')) {
    throw new Error('DEPLOY_REMOTE_ROOT must not contain line breaks.')
  }

  return value
}

function normalizeGitPath(file) {
  if (
    file.length === 0 ||
    file.startsWith('/') ||
    /[\r\n]/u.test(file) ||
    file.split('/').includes('..')
  ) {
    throw new Error(`Unexpected tracked file path: ${file}`)
  }

  return file
}

function escapeRsyncFilterPath(value) {
  let escapedValue = ''

  for (const character of value) {
    escapedValue += RSYNC_FILTER_PATTERN_METACHARACTERS.has(character)
      ? `\\${character}`
      : character
  }

  return escapedValue
}
