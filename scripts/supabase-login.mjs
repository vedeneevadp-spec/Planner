import { npxCommand, requireEnv, runCommand } from './supabase-utils.mjs'

await runCommand(
  npxCommand(),
  ['supabase', 'login', '--token', requireEnv('SUPABASE_ACCESS_TOKEN')],
  {
    env: process.env,
  },
)
