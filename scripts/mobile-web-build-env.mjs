import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const DEFAULT_AUTH_ENV_FILE = '.env.production.local'

export async function resolveMobileWebBuildEnv({
  apiUrl,
  envFile = process.env.MOBILE_ENV_FILE ?? DEFAULT_AUTH_ENV_FILE,
  repoRoot = process.cwd(),
} = {}) {
  const loadedEnvFile = await loadEnvFileIfPresent({
    envFile,
    repoRoot,
  })
  const buildEnv = {
    ...process.env,
    ...(apiUrl ? { VITE_API_BASE_URL: apiUrl } : {}),
  }
  const hasLegacyOverrides = Boolean(
    readNonEmptyEnv('VITE_API_ACCESS_TOKEN') ||
    (readNonEmptyEnv('VITE_ACTOR_USER_ID') &&
      readNonEmptyEnv('VITE_WORKSPACE_ID')),
  )
  const authProvider = resolveAuthProvider()

  if (!authProvider && !hasLegacyOverrides) {
    throw new Error(
      [
        'Missing mobile auth build configuration.',
        'Provide VITE_AUTH_PROVIDER=planner for Chaotika Auth,',
        `or keep ${envFile} with WEB_AUTH_PROVIDER=planner/API_AUTH_MODE=jwt.`,
        'For internal builds you can also use VITE_API_ACCESS_TOKEN',
        'or VITE_ACTOR_USER_ID together with VITE_WORKSPACE_ID.',
      ].join(' '),
    )
  }

  if (authProvider) {
    buildEnv.VITE_AUTH_PROVIDER = authProvider
  }

  return {
    env: buildEnv,
    loadedEnvFile,
  }
}

function resolveAuthProvider() {
  const explicitProvider = readNonEmptyEnv('VITE_AUTH_PROVIDER')

  if (explicitProvider) {
    return explicitProvider
  }

  const webProvider = readNonEmptyEnv('WEB_AUTH_PROVIDER')

  if (webProvider) {
    return webProvider
  }

  return readNonEmptyEnv('API_AUTH_MODE') === 'jwt' ? 'planner' : null
}

async function loadEnvFileIfPresent({ envFile, repoRoot }) {
  if (typeof envFile !== 'string' || envFile.trim().length === 0) {
    return null
  }

  const resolvedEnvFilePath = path.resolve(repoRoot, envFile)

  if (!(await pathExists(resolvedEnvFilePath))) {
    return null
  }

  const envEntries = parseDotEnv(await readFile(resolvedEnvFilePath, 'utf8'))

  for (const [key, value] of Object.entries(envEntries)) {
    if (readNonEmptyEnv(key)) {
      continue
    }

    process.env[key] = value
  }

  return resolvedEnvFilePath
}

function parseDotEnv(content) {
  const entries = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()

    if (line.length === 0 || line.startsWith('#')) {
      continue
    }

    const separatorIndex = line.indexOf('=')

    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const value = normalizeEnvValue(line.slice(separatorIndex + 1))

    if (key.length > 0) {
      entries[key] = value
    }
  }

  return entries
}

function normalizeEnvValue(rawValue) {
  const trimmedValue = rawValue.trim()

  if (
    (trimmedValue.startsWith('"') && trimmedValue.endsWith('"')) ||
    (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
  ) {
    return trimmedValue.slice(1, -1)
  }

  return trimmedValue
}

async function pathExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}

function readNonEmptyEnv(name) {
  const value = process.env[name]

  return typeof value === 'string' && value.trim().length > 0 ? value : null
}
