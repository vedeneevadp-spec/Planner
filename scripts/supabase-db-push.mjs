import {
  getSupabaseDirectDatabaseUrl,
  npxCommand,
  runCommand,
} from './supabase-utils.mjs'

await runCommand(
  npxCommand(),
  [
    'supabase',
    'db',
    'push',
    '--db-url',
    getSupabaseDirectDatabaseUrl(),
    '--include-all',
    '--yes',
  ],
  {
    env: process.env,
  },
)
