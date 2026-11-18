// Replaced at build time by scripts/build-api.mjs with the root package.json
// version. In source mode (tsx dev, tests) it is not defined.
declare const __PLANNER_APP_VERSION__: string | undefined

export function resolveAppVersion(env: NodeJS.ProcessEnv): string {
  if (typeof __PLANNER_APP_VERSION__ === 'string') {
    return __PLANNER_APP_VERSION__
  }

  return env.PLANNER_APP_VERSION ?? env.npm_package_version ?? 'dev'
}
