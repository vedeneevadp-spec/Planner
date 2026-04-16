import {
  getSupabaseDirectDatabaseUrl,
  nodeCommand,
  runCommand,
} from './supabase-utils.mjs'

const env = {
  ...process.env,
  DATABASE_URL: getSupabaseDirectDatabaseUrl(),
}

await runCommand(nodeCommand(), ['./scripts/db-migrate.mjs'], {
  env,
})
