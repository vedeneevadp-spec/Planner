import {
  getSupabaseRuntimeDatabaseUrl,
  npmCommand,
  runCommand,
} from './supabase-utils.mjs'

const mode = process.argv[2]

if (mode !== 'dev' && mode !== 'start') {
  throw new Error('Expected "dev" or "start" as the first argument.')
}

const env = {
  ...process.env,
  API_AUTH_MODE: 'supabase',
  API_STORAGE_DRIVER: 'postgres',
  DATABASE_URL: getSupabaseRuntimeDatabaseUrl(),
}

await runCommand(npmCommand(), ['run', '-w', 'apps/api', mode], {
  env,
})
