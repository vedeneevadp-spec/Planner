import { constants as fsConstants } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import {
  getSupabaseProjectUrl,
  getSupabasePublishableKey,
} from './supabase-utils.mjs'

const DEFAULT_SUPABASE_ENV_FILE = '.env.supabase.local'

export async function resolveMobileWebBuildEnv({
  apiUrl,
  envFile = process.env.MOBILE_ENV_FILE ?? DEFAULT_SUPABASE_ENV_FILE,
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
  const supabaseAuthConfig = resolveSupabaseAuthConfig()

  if (!supabaseAuthConfig && !hasLegacyOverrides) {
    throw new Error(
      [
        'Missing mobile auth build configuration.',
        'Provide VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY,',
        `or keep ${envFile} with SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.`,
        'For internal builds you can also use VITE_API_ACCESS_TOKEN',
        'or VITE_ACTOR_USER_ID together with VITE_WORKSPACE_ID.',
      ].join(' '),
    )
  }

  if (supabaseAuthConfig) {
    buildEnv.VITE_SUPABASE_PUBLISHABLE_KEY = supabaseAuthConfig.publishableKey
    buildEnv.VITE_SUPABASE_URL = supabaseAuthConfig.url
  }

  return {
    env: buildEnv,
    loadedEnvFile,
  }
}

function resolveSupabaseAuthConfig() {
  const explicitUrl = readNonEmptyEnv('VITE_SUPABASE_URL')
  const explicitPublishableKey = readNonEmptyEnv(
    'VITE_SUPABASE_PUBLISHABLE_KEY',
  )

  if (explicitUrl || explicitPublishableKey) {
    if (!explicitUrl || !explicitPublishableKey) {
      throw new Error(
        'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be configured together for mobile builds.',
      )
    }

    return {
      publishableKey: explicitPublishableKey,
      url: explicitUrl,
    }
  }

  const hasSupabaseEnv = Boolean(
    readNonEmptyEnv('SUPABASE_URL') ||
    readNonEmptyEnv('SUPABASE_PROJECT_REF') ||
    readNonEmptyEnv('SUPABASE_PUBLISHABLE_KEY') ||
    readNonEmptyEnv('SUPABASE_ANON_KEY'),
  )

  if (!hasSupabaseEnv) {
    return null
  }

  return {
    publishableKey: getSupabasePublishableKey(),
    url: getSupabaseProjectUrl(),
  }
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
