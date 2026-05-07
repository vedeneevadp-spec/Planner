import { z } from 'zod'

const LOCAL_DEVELOPMENT_DEFAULTS = {
  apiBaseUrl: 'http://127.0.0.1:3001',
} as const

const plannerApiConfigSchema = z.object({
  apiAccessToken: z.string().min(1).optional(),
  actorUserIdOverride: z.string().min(1).optional(),
  apiBaseUrl: z.string().url(),
  authProvider: z.enum(['disabled', 'planner']),
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
  apiAccessToken: readOptionalEnvValue(import.meta.env.VITE_API_ACCESS_TOKEN),
  actorUserIdOverride: readOptionalEnvValue(import.meta.env.VITE_ACTOR_USER_ID),
  apiBaseUrl: readEnvValue(
    import.meta.env.VITE_API_BASE_URL,
    LOCAL_DEVELOPMENT_DEFAULTS.apiBaseUrl,
  ),
  authProvider:
    readOptionalEnvValue(import.meta.env.VITE_AUTH_PROVIDER) ?? 'disabled',
  workspaceIdOverride: readOptionalEnvValue(import.meta.env.VITE_WORKSPACE_ID),
})

export function getPlannerSessionOverrideHeaders(
  options: {
    accessToken?: string | undefined
    actorUserId?: string | undefined
    workspaceId?: string | undefined
  } = {},
): HeadersInit | undefined {
  const headers: Record<string, string> = {}

  const resolvedAccessToken =
    options.accessToken ?? plannerApiConfig.apiAccessToken
  const resolvedActorUserId =
    options.actorUserId ?? plannerApiConfig.actorUserIdOverride
  const resolvedWorkspaceId =
    options.workspaceId ?? plannerApiConfig.workspaceIdOverride

  if (resolvedAccessToken) {
    headers.authorization = `Bearer ${resolvedAccessToken}`
  }

  if (resolvedWorkspaceId) {
    headers['x-workspace-id'] = resolvedWorkspaceId
  }

  if (!resolvedAccessToken && resolvedActorUserId && resolvedWorkspaceId) {
    headers['x-actor-user-id'] = resolvedActorUserId
  }

  return Object.keys(headers).length > 0 ? headers : undefined
}
