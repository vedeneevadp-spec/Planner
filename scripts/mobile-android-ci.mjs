import { npmCommand, runCommand } from './command-utils.mjs'

const ciEnv = {
  ...process.env,
  MOBILE_ENV_FILE: '',
  VITE_API_BASE_URL: process.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3001',
  VITE_AUTH_PROVIDER: process.env.VITE_AUTH_PROVIDER ?? 'planner',
}

delete ciEnv.VITE_ACTOR_USER_ID
delete ciEnv.VITE_API_ACCESS_TOKEN
delete ciEnv.VITE_WORKSPACE_ID

await runCommand(npmCommand(), ['run', 'mobile:sync:android'], { env: ciEnv })
await runCommand(npmCommand(), ['run', 'mobile:android:test'], { env: ciEnv })
await runCommand(npmCommand(), ['run', 'mobile:android:assemble'], {
  env: ciEnv,
})
await runCommand(npmCommand(), ['run', 'mobile:android:budget'], { env: ciEnv })
