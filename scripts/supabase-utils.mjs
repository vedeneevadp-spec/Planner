import { spawn } from 'node:child_process'

function resolveCommand(baseName) {
  return process.platform === 'win32' ? `${baseName}.cmd` : baseName
}

export function requireEnv(name) {
  const value = process.env[name]

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }

  return value
}

function fillDatabasePassword(urlTemplate) {
  if (!urlTemplate.includes('__SUPABASE_DB_PASSWORD__')) {
    return urlTemplate
  }

  return urlTemplate.replaceAll(
    '__SUPABASE_DB_PASSWORD__',
    encodeURIComponent(requireEnv('SUPABASE_DB_PASSWORD')),
  )
}

export function getSupabaseDirectDatabaseUrl() {
  return fillDatabasePassword(requireEnv('SUPABASE_DB_URL'))
}

export function getSupabaseRuntimeDatabaseUrl() {
  const runtimeUrl =
    process.env.SUPABASE_RUNTIME_DATABASE_URL ??
    process.env.SUPABASE_SESSION_POOLER_URL

  if (runtimeUrl && runtimeUrl.trim().length > 0) {
    return fillDatabasePassword(runtimeUrl)
  }

  return getSupabaseDirectDatabaseUrl()
}

export function getSupabaseProjectUrl() {
  const explicitUrl = process.env.SUPABASE_URL

  if (explicitUrl && explicitUrl.trim().length > 0) {
    return explicitUrl.replace(/\/$/, '')
  }

  const projectRef = requireEnv('SUPABASE_PROJECT_REF')

  return `https://${projectRef}.supabase.co`
}

export function getSupabasePublishableKey() {
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY

  if (publishableKey && publishableKey.trim().length > 0) {
    return publishableKey
  }

  throw new Error(
    'Missing required environment variable: SUPABASE_PUBLISHABLE_KEY or SUPABASE_ANON_KEY',
  )
}

export async function runCommand(command, args, options = {}) {
  const child = spawn(command, args, {
    env: options.env ?? process.env,
    stdio: 'inherit',
  })

  await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed with exit code ${code ?? 'unknown'}`))
    })
  })
}

export function nodeCommand() {
  return process.execPath
}

export function npmCommand() {
  return resolveCommand('npm')
}

export function npxCommand() {
  return resolveCommand('npx')
}
