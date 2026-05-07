import { z } from 'zod'

const LOCAL_DEVELOPMENT_DEFAULTS = {
  apiBaseUrl: 'http://127.0.0.1:3001',
} as const

const plannerApiConfigSchema = z
  .object({
    apiAccessToken: z.string().min(1).optional(),
    actorUserIdOverride: z.string().min(1).optional(),
    apiBaseUrl: z.string().url(),
    supabasePublishableKey: z.string().min(1).optional(),
    supabaseRealtimeEnabled: z.boolean().optional(),
    supabaseUrl: z.string().url().optional(),
    workspaceIdOverride: z.string().min(1).optional(),
  })
  .refine(
    (value) =>
      (Boolean(value.supabaseUrl) && Boolean(value.supabasePublishableKey)) ||
      (!value.supabaseUrl && !value.supabasePublishableKey),
    {
      message:
        'VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY must be configured together.',
      path: ['supabaseUrl'],
    },
  )

export type PlannerApiConfig = z.infer<typeof plannerApiConfigSchema>

function readEnvValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function readOptionalEnvValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readOptionalBooleanEnvValue(value: unknown): boolean {
  return typeof value === 'string' && /^(1|true|yes)$/i.test(value.trim())
}

export const plannerApiConfig: PlannerApiConfig = plannerApiConfigSchema.parse({
  apiAccessToken: readOptionalEnvValue(import.meta.env.VITE_API_ACCESS_TOKEN),
  actorUserIdOverride: readOptionalEnvValue(import.meta.env.VITE_ACTOR_USER_ID),
  apiBaseUrl: readEnvValue(
    import.meta.env.VITE_API_BASE_URL,
    LOCAL_DEVELOPMENT_DEFAULTS.apiBaseUrl,
  ),
  supabasePublishableKey: readOptionalEnvValue(
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  ),
  supabaseRealtimeEnabled: readOptionalBooleanEnvValue(
    import.meta.env.VITE_SUPABASE_REALTIME_ENABLED,
  ),
  supabaseUrl: readOptionalEnvValue(import.meta.env.VITE_SUPABASE_URL),
  workspaceIdOverride: readOptionalEnvValue(import.meta.env.VITE_WORKSPACE_ID),
})

export function hasSupabaseBrowserAuthConfig(
  config: PlannerApiConfig,
): config is PlannerApiConfig & {
  supabasePublishableKey: string
  supabaseUrl: string
} {
  return Boolean(config.supabaseUrl && config.supabasePublishableKey)
}

export function getPlannerSessionOverrideHeaders(options: {
  accessToken?: string | undefined
  actorUserId?: string | undefined
  workspaceId?: string | undefined
} = {}): HeadersInit | undefined {
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
