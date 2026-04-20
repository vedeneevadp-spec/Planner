import { npxCommand, requireEnv, runCommand } from './supabase-utils.mjs'

await runCommand(
  npxCommand(),
  [
    'supabase',
    'link',
    '--project-ref',
    requireEnv('SUPABASE_PROJECT_REF'),
    '--password',
    requireEnv('SUPABASE_DB_PASSWORD'),
    '--skip-pooler',
    '--yes',
  ],
  {
    env: process.env,
  },
)
