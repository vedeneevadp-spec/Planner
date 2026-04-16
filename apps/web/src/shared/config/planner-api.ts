import { z } from 'zod'

const LOCAL_DEVELOPMENT_DEFAULTS = {
  apiBaseUrl: 'http://127.0.0.1:3001',
} as const

const plannerApiConfigSchema = z.object({
  actorUserIdOverride: z.string().min(1).optional(),
  apiBaseUrl: z.string().url(),
  workspaceIdOverride: z.string().min(1).optional(),
})

export type PlannerApiConfig = z.infer<typeof plannerApiConfigSchema>

function readEnvValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function readOptionalEnvValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export const plannerApiConfig: PlannerApiConfig = plannerApiConfigSchema.parse({
  actorUserIdOverride: readOptionalEnvValue(import.meta.env.VITE_ACTOR_USER_ID),
  apiBaseUrl: readEnvValue(
    import.meta.env.VITE_API_BASE_URL,
    LOCAL_DEVELOPMENT_DEFAULTS.apiBaseUrl,
  ),
  workspaceIdOverride: readOptionalEnvValue(import.meta.env.VITE_WORKSPACE_ID),
})

export function getPlannerSessionOverrideHeaders(): HeadersInit | undefined {
  if (
    plannerApiConfig.actorUserIdOverride &&
    plannerApiConfig.workspaceIdOverride
  ) {
    return {
      'x-actor-user-id': plannerApiConfig.actorUserIdOverride,
      'x-workspace-id': plannerApiConfig.workspaceIdOverride,
    }
  }

  return undefined
}
