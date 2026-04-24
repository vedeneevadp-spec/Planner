import type { PlannerApiConfig } from '@/shared/config/planner-api'

export function hasLegacyPlannerSessionOverrides(
  config: PlannerApiConfig,
): boolean {
  return Boolean(config.actorUserIdOverride && config.workspaceIdOverride)
}

export function canBootstrapPlannerSession(input: {
  accessToken: string | null
  config: PlannerApiConfig
  isAuthEnabled: boolean
}): boolean {
  if (input.isAuthEnabled) {
    return Boolean(input.accessToken)
  }

  return Boolean(
    input.accessToken || hasLegacyPlannerSessionOverrides(input.config),
  )
}
